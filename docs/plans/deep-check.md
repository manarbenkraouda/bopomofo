# Async deep check for speech misses that were probably right

## Summary

After a speaking answer that is not fully right, the server gives the work to a separate low-priority worker process. The worker checks every missed part again with forced CTC alignment on the model output of the live check. It also checks tones again with pitch. It does not run the speech model again, so there is no second copy of the 3.86 GB model and no shared lock. The audio and model output are in memory only and are discarded after the check.

The mode is set by `DEEP_CHECK=off|shadow|apply`, with a default of `shadow`.

- **Shadow mode:** the check stores verdicts only.
- **Apply mode:** the check fixes units, scores, events and levels. The learner sees "A previous answer was corrected after further analysis, good job!", on the card or later as a toast.

## Key changes

### Keep the model output from the live check

- In `asr.Recognizer._decode`, also return the log-softmax of the logits that are already computed, as `log_probs` (float32). `scoring.analyze` puts it in `res["_lp"]`.
- `/api/speech/analyze` removes `_lp` from `res` before `log_speaking` and before the response, so it is never stored or sent.
- Move `symbols._ctc` and `_vocab_groups` into a new pure module, `app/ctc.py`. It imports numpy only, and `symbols.py` imports from it. Add `ctc_viterbi(seq, blank) -> list[(f0, f1)]`, which gives the frame span of each unit for the best path.

### Queue and worker (new `app/deep_check.py`)

- A `queue.Queue(maxsize=20)` and one dispatcher daemon thread that start in `startup`. The dispatcher sends one job at a time to a `ProcessPoolExecutor(max_workers=1)` with the `spawn` start method.
- The worker initializer lowers the process priority: `SetPriorityClass(BELOW_NORMAL)` through ctypes on Windows, and `os.nice(10)` on Linux. The worker gets the vocabulary from the initializer.
- The worker runs pure code from `app/deep_check_core.py`. That module imports only `ctc`, `pitch` and `zhuyin`, and never `asr`, `db` or `onnxruntime`.
- A job times out after 30 s and is stored with status `error`. If the pool breaks, the dispatcher creates a new one.
- **Shutdown:** set a stop flag, give the dispatcher at most 15 s to drain, then call `pool.shutdown(cancel_futures=True)`. All of this happens before `db.wait_background`.
- **Trigger (in `/api/speech/analyze`, after `log_speaking`):** queue a job if `DEEP_CHECK != off`, the score is below 100, and at least one initial, final or tone part is wrong. This applies in every speaking mode: sentence, syllable, custom and rule.
  - The job holds `user_id`, `event_id`, `audio`, `_lp`, the result syllables, the pitch semitones and `ref`, and the learner's typed `mic_pairs`.
  - The put is `put_nowait`. A full queue gives `deep_check: "skipped"`. Otherwise the response has `deep_check: "queued"`.
- The dispatcher writes the result in the main process, as the job's user (`db.as_user`).

### Deep check method (`deep_check_core.check(job)`)

- **Token sequence of a syllable:** the initial token, or `j` for a syllable with no initial that starts with ㄧ, ㄨ or ㄩ (only when it explains the audio better). Then the final token: `ㄭ+` for ㄓㄔㄕㄖ with no final, `ㄭ-` for ㄗㄘㄙ with no final, and `ㄦ` or `r` for ㄦ. For sound checks, use groups that merge all tones (as in `symbols`).
- **Sound parts (initial or final):** for each wrong part at position k, compute the CTC score of the whole expected sentence (`L_exp`). Compare it with the same sentence where only that part is replaced by the heard value, each neighbour in the confusion table (b/p, d/t, g/k, z/c/s, zh/ch/sh, j/q/x, n/l, m/b, n/d, en/eng, in/ing, an/ang, ㄛ/ㄨㄛ), or the syllable deleted if the syllable was not heard.
- The part is a false miss if `L_exp − L_candidate ≥ −margin` for every candidate: `margin = 3.0` nats for nasal pairs (m/b, n/d, n/l) and for the learner's typed mic pairs, `margin = 1.0` for all other pairs.
- **Tone parts:** in the expected sentence, swap the tone digit of syllable k through 1–5. Softmax the 5 CTC scores to get tone probabilities. Get the frame span of syllable k from `ctc_viterbi`, and classify the pitch again on that span with `pitch.classify`. Fixed when the probability of an accepted tone (surface tone or `alt_tones`) is ≥ 0.5 and the pitch tone is accepted or unclear; `unsure` when the pitch gives a different tone.
- **Score after the check:** the same rule as `scoring` (3 parts per syllable). Item verdict: `false_miss` if the score after is ≥ 80 and the score before was below 80; `partial` if some parts were fixed but the item is still not fully right; `real_miss` if no part was fixed.

### Storage (migration `0006_deep_checks.sql`)

- Table `deep_checks`: `id`, `user_id DEFAULT app_user()`, `event_id` (unique, `REFERENCES events ON DELETE CASCADE`), `ts`, `status` (`done|error`), `verdict` (`false_miss|partial|real_miss`), `score_before`, `score_after`, `parts JSONB`, `mode` (`shadow|apply`), `applied BOOLEAN DEFAULT false`, `version TEXT`. FORCE RLS, the `own_rows` policy, and an index on `(user_id, ts)`.

### Applying in apply mode (in one transaction)

- Skip the event if it has units with source `typed` or `pair_fix`, or if `applied` is already true. Typed checks always win.
- For each fixed part, call `typed_fix._fix_unit(..., "deep_check", {"heard", "delta"})` on the matching unit. A fixed tone also fixes the `sandhi` unit at the same position. When all graded parts at a position are right, the `syllable` unit is set right too.
- `_rescore_event`: set `events.score` to `score_after`; if it is ≥ 80, set `ok=1` and `first_try` with the same rule as `recount`; write `details.deep_fix = {before, after}`.
- Then `typed_fix._rebuild_levels`, set `applied = true`, and `coach.refresh()`.
- Notice for each `false_miss`: kind `deep_fix`, title "Answer corrected", text "A previous answer was corrected after further analysis, good job!". Unseen `deep_fix` notices are merged into one: "N previous answers were corrected after further analysis, good job!". The existing notice pipeline delivers it.
- Old shadow verdicts are not applied when `DEEP_CHECK` changes to `apply`.

### API and UI

- `POST /api/speech/analyze` adds `deep_check: "queued"|"skipped"|"off"`.
- `GET /api/speech/deep-check/{event_id}` returns `{status, verdict, applied, score_after, notice_id}`, or 404 while pending or when no check runs.
- `SpeakingPractice`: if `deep_check` is `"queued"`, poll every 2 s, at most 8 times, and stop when the card changes. For an applied `false_miss`, show "This was right after a closer check. Your score is now N.", set the result score, and mark the notice seen.
- Stats (apply mode): "Answers corrected after analysis: N" and the top 3 fixed pairs (`stats.deep_check`).
- Coach: `deep_fixes` (pairs with 3 or more applied fixes) and one COMMON rule: do not plan drills for these pairs because of microphone misses.

### Accuracy before apply mode

- `backend/tools/eval_deep_check.py`: fixtures mode (analyze and deep check on labelled clips) and DB mode (shadow verdicts on syllable cards that later got a typed Pinyin check: precision and recall per pair).
- Rule for the change to apply: precision ≥ 0.9 on at least 30 typed confirmations, and no clearly wrong fixture changed to right. Check local and VPS runtimes separately.

## Assumptions

- No audio and no model output is stored. Jobs are lost on a restart or a crash.
- Margins (1.0 and 3.0 nats) and the tone limit 0.5 are starting values. Shadow data will tune them.
- The spaced repetition schedule on the client stays as recorded, the same as for typed fixes.
- Shadow mode shows nothing to the learner.
- No second ASR model and no denoising. Reading quiz clips are not in scope.
