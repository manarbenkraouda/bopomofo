"use client";

import { PitchChart } from "@/components/PitchChart";
import { useCountUp } from "@/components/quiz/Feedback";
import { type SpeechResult } from "@/lib/api";
import { TONE_NAME } from "@/lib/zhuyin";
import { RULE_NAME, saidZhuyin } from "./cards";

function Badge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg text-muted">{label} –</span>;
  return (
    <span className={"text-[11px] px-1.5 py-0.5 rounded " + (ok ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad")}>
      {label} {ok ? "✓" : "✗"}
    </span>
  );
}

/** What the check heard, syllable by syllable. The pitch chart and the tone guide are folded.
 * hide: the expected text is the answer (a number shown in digits), so a miss shows only which syllables and parts were
 * wrong, and what was heard. */
export function ResultView({
  result,
  onHear,
  hide = false,
}: {
  result: SpeechResult;
  onHear: (char: string) => void;
  hide?: boolean;
}) {
  const sy = result.syllables;
  const tone = sy.filter((s) => s.tone_ok).length;
  const sounds = sy.filter((s) => s.heard && s.initial_ok !== false && s.final_ok !== false).length;
  const shown = useCountUp(result.score);
  return (
    <div className="card p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap">
        <div
          className={
            "text-4xl font-semibold tabular-nums " +
            (result.score >= 85 ? "text-ok" : result.score >= 60 ? "text-rough" : "text-bad")
          }
        >
          {shown}
        </div>
        <div className="text-muted">
          tones{" "}
          <b className="text-ink">
            {tone}/{sy.length}
          </b>{" "}
          · sounds{" "}
          <b className="text-ink">
            {sounds}/{sy.length}
          </b>
        </div>
        {!hide && <div className="text-xs text-muted sm:ml-auto">Tap a syllable to hear it</div>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
        {sy.map((s, i) => {
          const ok = s.heard && s.tone_ok && s.initial_ok !== false && s.final_ok !== false;
          return (
            <button
              key={i}
              onClick={() => !hide && onHear(s.expected.char)}
              disabled={hide}
              className={
                "text-left rounded-xl border p-3 " +
                (hide ? "" : "hover:shadow-sm ") +
                (ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5")
              }
            >
              <div className="flex items-center gap-2 cjk">
                {hide ? (
                  <span className="text-lg text-muted">Syllable {i + 1}</span>
                ) : (
                  <>
                    <span className="text-2xl">{s.expected.char}</span>
                    <span className="text-accent">{s.expected.zhuyin}</span>
                  </>
                )}
                <span className="ml-auto text-sm">
                  {ok ? <span className="text-ok">✓</span> : <span className="text-bad">✗</span>}
                </span>
              </div>
              <div className="text-xs text-muted mt-1 cjk">
                {!hide && s.expected.surface_tone !== s.expected.tone && (
                  <>
                    written {s.expected.zhuyin} · say <b className="text-accent">{saidZhuyin(s.expected)}</b>
                    {s.expected.rule ? " (" + RULE_NAME[s.expected.rule] + ")" : ""} ·{" "}
                  </>
                )}
                heard <b className="text-ink">{s.heard?.zhuyin ?? "—"}</b>
              </div>
              {!hide && s.rule_error === "literal" && (
                <div className="mt-2 text-xs font-semibold text-bad">
                  You read the written tone. The {RULE_NAME[s.rule ?? ""] ?? "tone rule"} changes it here.
                </div>
              )}
              {!hide && s.rule_error === "over" && (
                <div className="mt-2 text-xs font-semibold text-bad">
                  The {RULE_NAME[s.rule ?? ""]} does not apply here: keep the written tone.
                </div>
              )}
              {!ok && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  <Badge ok={s.heard ? s.initial_ok : false} label="initial" />
                  <Badge ok={s.heard ? s.final_ok : false} label="final" />
                  <Badge ok={s.tone_ok} label="tone" />
                </div>
              )}
              {!hide && s.messages.length > 0 && (
                <ul className="mt-2 text-xs leading-snug list-disc pl-4 cjk">
                  {s.messages.map((m, k) => (
                    <li key={k}>{m}</li>
                  ))}
                </ul>
              )}
              {s.tone_source === "pitch" && (
                <div className="text-[11px] text-muted mt-1">Tone estimated from your voice.</div>
              )}
              {s.tone_source === "model+pitch" && (
                <div className="text-[11px] text-muted mt-1">
                  Low falling tone 3 (Taiwan style), from your pitch range.
                </div>
              )}
              {s.uncertain && !s.tone_ok && !s.rule_error && (
                <div className="text-[11px] text-rough mt-1">
                  Hard to hear: it sounded between tone {s.model_tone} and tone {s.pitch_tone}.
                </div>
              )}
            </button>
          );
        })}
      </div>
      {result.extra.length > 0 && (
        <div className="text-sm text-muted cjk">Extra sounds heard: {result.extra.map((e) => e.zhuyin).join(" ")}</div>
      )}
      {!hide && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Pitch curve</summary>
          <div className="mt-2 text-xs text-muted mb-1">
            Your pitch (black) against the target tone shapes (colored bands), per syllable
          </div>
          <PitchChart result={result} />
        </details>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Tone guide</summary>
        <ul className="mt-2 grid sm:grid-cols-2 gap-1">
          {[1, 2, 3, 4, 5].map((t) => (
            <li key={t}>{TONE_NAME[t]}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
