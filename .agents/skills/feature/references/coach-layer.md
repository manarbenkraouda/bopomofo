# Coach layer

Files: the backend/app/coach/ package, frontend/src/components/coach/Coach.tsx, frontend/src/components/shell/StepBanner.tsx,
frontend/src/lib/api/types/coach.ts (CoachStep, StepType), backend/tests/test_coach.py.

Where each name lives in backend/app/coach/:

| Module | Names |
|---|---|
| settings.py | TYPES, DEFAULT_TARGET, MEASURES, NEEDS_ALPHABET, ALPHABET_GATE, LEARN_REPS, SYLLABLES_FILE, LIVE |
| prompts.py | DOMAINS, ANALYZE, PLAN, ALPHABET_RULE, ALPHABET_MILESTONE_RULE, level_rule() |
| digest.py | digest() |
| gates.py | alphabet_status(), alphabet_gate(), needs_alphabet(), rules_status(), rules_gate() |
| validate.py | tones(), syms(), pairs(), integer(), text() |
| cleaning.py | clean_step(), clean_milestone(), focus_of() |
| decks.py | syllables(), syllable_history(), candidates(), deck_problems(), focus_check() |
| progress.py | hit(), step_progress(), baseline(), href(), milestone_progress() |
| pipeline.py | pipeline(), write_sentences(), pick_deck(), milestone_menu(), apply_review() |
| fallback.py | rules_plan() |
| planner.py | build(), start() |
| practice.py | checkpoint(), apply_checkpoint(), debrief(), refresh(), skip() |

A feature reaches the coach in three ways. Do each one that applies.

## 1. Evidence: what the analysts see

- MEASURES: add one entry per new area or mode ("area" or "area/mode"): what the mode measures, and whether it needs the
  alphabet. digest() sends it next to the numbers. Without it, the model draws conclusions from a mode that does not measure
  them (the tone quiz was once read as "knows the symbols").
- digest(): add a slice for the domain, for example "characters": {"skills": ..., "confusions": ..., "contexts": ...,
  "never_practiced": ...}. Build it from item_stats rows (row()), expected → produced tables from new units only
  (legacy = 0), accuracy per context (see the speaking tone contexts), and coverage (what was never practiced). Keep it
  small, weakest first: about 25 to 40 rows.
- Add the new kind to the "skills" filter in digest(). It feeds _skills, milestone_menu, and rules_plan.
- DOMAINS: add the domain with one sentence that says what the analyst looks at. The pipeline makes one ANALYZE call per
  domain, in parallel.
- The other slices update without changes: overview.areas uses stats.AREAS, and pace uses all events.

## 2. Action: a step type

- Prerequisites are rules in code, not model decisions. alphabet_status() and alphabet_gate() are the pattern: a
  deterministic measure of the foundation, a threshold (ALPHABET_GATE), steps that the app inserts first, step types that wait
  (NEEDS_ALPHABET), a line in the PLAN prompt (ALPHABET_RULE), and a milestone that the model cannot drop. If the new feature
  needs a foundation (for example, characters need the radicals), add a gate the same way. If it shows Bopomofo, add its step
  types to NEEDS_ALPHABET.
- Learn before you test. A new item starts with repetition: the app shows the answer on purpose (params.learn, URL ?learn=1),
  every right repetition counts for the step, and the answer is saved with details.learn so it is not read as a test. Tests
  from memory start only after LEARN_REPS right repetitions of the item. While a gate is active, milestones that test the
  gated items are removed (needs_alphabet() and ALPHABET_MILESTONE_RULE): the gate milestone tracks them. A new foundation
  (radicals, characters) needs the same three parts: a repetition mode, a repetition count per item, and a recall phase.
- TYPES[type] = area. DEFAULT_TARGET[type], unless the target is derived (speak_sentences: reps × sentences).
- PLAN prompt: add the type with its params JSON and what "done" means.
- clean_step: check every param against known values (see validate.tones and validate.syms), and return None when the step cannot be
  measured.
- hit(step, unit): which units inside the step count. step_progress: a special case when progress is per item (see
  speak_sentences). baseline: the 30-day comparison for the debrief.
- href(step): the mode URL with the focus params and &step=. The mode must read those params: add a new param to Focus
  and useFocus in frontend/src/lib/focus.tsx, to the list in useClearHref, and to FOCUS_KEYS in StepBanner.tsx, so the
  learner can apply a checkpoint change.
- Model-chosen content follows pick_deck and write_sentences. The backend computes the candidates (see candidates() and
  syllable_history()). The model picks from them. A deterministic checker (see deck_problems and focus_check) rejects bad
  output and sends the problems back, for at most 3 attempts. Save the result in params.
- apply_checkpoint: add the new params to the subset rules. A checkpoint can only shrink the focus, and a quiz must not
  become guessable (a listening quiz keeps at least 2 tones).
- rules_plan: map the weak items of the new kind to the step type, for when the model fails.
- Milestones: clean_milestone accepts the units tone, initial, final, symbol, and score. Add the new kind there and in
  milestone_progress (exact or "contains" matching).
- Frontend: StepType and CoachStep["params"] in lib/api/types/coach.ts; STEP_ICON, STEP_KIND, DOMAIN, and focusChips in coach/stepMeta.ts; the
  Coach route text in lib/routes.ts if it lists the step types.

## 2b. The story: headline and "How do we know?" (backend/app/story/)

Every plan has a headline (max 2 sentences, no numbers) and an animated story of 5 to 9 cards. The model writes cards
from a catalog of blocks and never types a number: it refers to facts by key, and story/validation.py fills the values in.

- Facts: add the new feature's numbers to story_facts() (accuracy per item, the main confusions as mix.<area>.<kind>.<a>><b>,
  counts, and a series when a trend matters). Facts come from the saved digest only; if a number is not in coach.digest.digest(),
  add it there (or in story_stats()) first. Give each fact a plain label: the model reads it.
- Mode names: add the new area or mode to story.MODE_LABEL.
- Blocks: use the existing blocks when they can show the data (bars for items side by side, confusion for mix-ups,
  symbol_grid for the alphabet, sparkline for a trend). A new block needs all three: an entry in story.CATALOG (props and
  limits; the prompt and the checks come from it), a BlockSpec type in components/story/types.ts, and a component in
  components/story/blocks/ registered in BLOCKS (components/story/registry.tsx). Data that is not one number (a grid, a
  list) goes in story_context(). Animate with motion/react, and keep "reduce motion" working (MotionConfig handles it).
- rules_cards(): add a fixed card when the feature is a main part of the learner's work, so the story without a model
  still shows it.
- Test: a fact appears with the right value, and a card that uses it passes clean_card().

## 3. Check it

- test_coach.py: clean_step accepts good params and rejects bad ones; step_progress counts only answers inside the step
  that match the focus; the checker rejects incomplete content.
- One live coach.build() on a copy of the database: the new domain gives findings, and the planner can choose the step type.
  Look at the coach_calls table for errors, time, and cost.

## Example: Traditional characters

This is a sketch of the mapping, not a specification.

- Area "characters"; modes "recognize" (pick the meaning), "read" (say or pick the Bopomofo), "write" (write it by hand).
- Units: kind "char", expected 學, actual 覺 (the look-alike that was picked). A reading unit: expected ㄒㄩㄝˊ, actual
  ㄐㄩㄝˊ, ctx 學. Handwriting reuses writtenUnits (the symbol, stroke, and order units).
- Stats: accuracy per character; look-alike confusions; errors by radical, stroke count, and frequency band; readings that
  fail on the tone or on the initial; characters never seen. A challenge "Read 學 覺 right 6 times"; Train links to
  /characters?chars=學,覺.
- Coach: a digest slice and DOMAINS["characters"]; step types read_chars {chars, target} and write_chars; candidates from the
  character list with history; a checker that keeps every character known and confusable pairs together; milestone unit
  "char". The sentence writer can get a "chars" focus, so new sentences contain the target characters.

