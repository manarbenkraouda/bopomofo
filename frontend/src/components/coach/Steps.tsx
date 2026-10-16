"use client";

import { BoboSays } from "@/components/mascot/Bobo";
import { Kbd } from "@/components/shell/Kbd";
import { type CoachState, type CoachStep, type Finding } from "@/lib/api";
import { focusChips, share, SKIP, SKIPPED, STEP_ICON, STEP_KIND, SYMBOL_STEPS } from "./stepMeta";

export function StepRow({
  s,
  i,
  active,
  onSelect,
}: {
  s: CoachStep;
  i: number;
  active: boolean;
  onSelect: () => void;
}) {
  const done = s.status === "done";
  const skipped = s.status === "skipped";
  return (
    <button
      onClick={onSelect}
      aria-current={active}
      className={
        "tile flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition md:p-3.5 " +
        (active ? "border-accent bg-accent-soft/40 " : "border-line bg-card hover:border-accent/50 ") +
        (skipped ? "opacity-55" : "")
      }
    >
      <span
        className={
          "cjk grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl " +
          (done
            ? "bg-ok text-white"
            : skipped
              ? "bg-line text-muted"
              : active
                ? "bg-accent text-white"
                : "bg-accent-soft text-accent")
        }
      >
        {done ? "✓" : STEP_ICON[s.type]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted">
          {STEP_KIND[s.type]} · {s.minutes} min{skipped ? " · skipped" : done ? " · done" : ""}
        </span>
        <span
          className={
            "cjk block truncate font-semibold leading-snug " + (skipped ? "line-through decoration-muted/60" : "")
          }
        >
          {s.title}
        </span>
        {!skipped && (
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <i
                className={"block h-full rounded-full " + (done ? "bg-ok" : "bg-accent")}
                style={{ width: share(s) + "%" }}
              />
            </span>
            <span className="text-[11px] font-semibold tabular-nums text-muted">
              {s.progress}/{s.target}
            </span>
          </span>
        )}
      </span>
      <Kbd className="max-md:!hidden">{i + 1}</Kbd>
    </button>
  );
}

export function StepDetail({
  s,
  i,
  alphabet,
  findings,
  onStart,
  onSkip,
  onEvidence,
}: {
  s: CoachStep;
  i: number;
  alphabet: CoachState["alphabet"];
  findings: Finding[];
  onStart: () => void;
  onSkip: (r: keyof typeof SKIP) => void;
  onEvidence: () => void;
}) {
  const done = s.status === "done";
  const skipped = s.status === "skipped";
  const symbolStep = SYMBOL_STEPS.has(s.type) && !!s.params.syms?.length;
  const chips = focusChips(s).filter((c) => !(symbolStep && c === s.params.syms?.join(" ")));
  const cited = findings.filter((f) => s.finding_ids.includes(f.id)).length;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-xs text-muted">
          Step {i + 1} · {STEP_KIND[s.type]} · about {s.minutes} min
          {skipped && s.skip_reason ? " · skipped: " + (SKIPPED[s.skip_reason] || s.skip_reason) : ""}
        </div>
        <h2 className="cjk mt-1 text-xl font-semibold leading-snug md:text-2xl">{s.title}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.why}</p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold">{done ? "Target reached" : skipped ? "Skipped" : "Progress"}</span>
          <span className="tabular-nums text-muted">
            <b className="text-ink">{s.progress}</b> of {s.target}
            {s.tried > 0 && <> · {Math.round((100 * s.right) / s.tried)}% right</>}
          </span>
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-line">
          <div
            className={"h-full rounded-full transition-all duration-500 " + (done ? "bg-ok" : "bg-accent")}
            style={{ width: share(s) + "%" }}
          />
        </div>
        <div className="mt-1 text-xs text-muted">The step ends when you reach the target, not on a date.</div>
      </div>

      {s.status === "open" && (
        <div className="flex flex-col gap-2.5 max-md:hidden">
          <button className="btn btn-accent w-fit !rounded-xl !px-5 !py-3 text-base font-semibold" onClick={onStart}>
            <span className="cjk">{STEP_ICON[s.type]}</span> Start this step <Kbd>Enter</Kbd>
          </button>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="mr-1">Not right for you?</span>
            <button className="btn !px-2.5 !py-1 text-xs" onClick={() => onSkip("too_hard")}>
              Too hard <Kbd>H</Kbd>
            </button>
            <button className="btn !px-2.5 !py-1 text-xs" onClick={() => onSkip("too_easy")}>
              Too easy <Kbd>E</Kbd>
            </button>
            <button className="btn !px-2.5 !py-1 text-xs" onClick={() => onSkip("not_now")}>
              Not now <Kbd>N</Kbd>
            </button>
          </div>
        </div>
      )}

      {s.note && (
        <BoboSays>
          <b className="text-accent">Bobo:</b> {s.note.text}
        </BoboSays>
      )}

      {symbolStep && <StepSymbols syms={s.params.syms!} alphabet={alphabet} />}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="chip cjk !cursor-default !px-2.5 !py-0.5 text-xs">
              {c}
            </span>
          ))}
        </div>
      )}

      {s.items && s.items.length > 0 && (
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {s.items.map((x) => (
            <div key={x.text} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="cjk min-w-0 flex-1 truncate text-base">{x.text}</span>
              <span className="text-xs tabular-nums text-muted">{x.tries ? "best " + x.best : "new"}</span>
              <span
                className={
                  "w-9 text-right text-xs font-semibold tabular-nums " +
                  (x.passes >= (s.params.reps ?? 1) ? "text-ok" : "")
                }
              >
                {x.passes}/{s.params.reps}
              </span>
            </div>
          ))}
        </div>
      )}

      {s.params.deck && (
        <div>
          <div className="flex flex-wrap gap-1">
            {s.params.deck.map((z) => (
              <span key={z} className="cjk rounded-md border border-line px-1.5 text-sm">
                {z}
              </span>
            ))}
          </div>
          {s.params.deck_why && <div className="mt-1.5 text-xs text-muted">{s.params.deck_why}</div>}
        </div>
      )}

      {(cited > 0 || s.review) && (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
          {cited > 0 && (
            <button className="w-fit text-accent hover:underline" onClick={onEvidence}>
              Based on {cited} finding{cited > 1 ? "s" : ""} from your stats →
            </button>
          )}
          {s.review && <div>Reviewer: {s.review}</div>}
        </div>
      )}
    </div>
  );
}

/** The symbols of a symbol step, large, each with its repetitions before tests from memory. */
function StepSymbols({ syms, alphabet }: { syms: string[]; alphabet: CoachState["alphabet"] }) {
  const info = new Map((alphabet?.symbols ?? []).map((x) => [x.sym, x]));
  const reps = alphabet?.learn_reps ?? 10;
  return (
    <div>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-6 xl:grid-cols-8">
        {syms.map((sym) => {
          const x = info.get(sym);
          const known = x?.state === "known";
          const n = Math.min(reps, x?.reps ?? 0);
          return (
            <div
              key={sym}
              title={known ? "known" : n + "/" + reps + " repetitions"}
              className={
                "cjk relative grid aspect-square place-items-center overflow-hidden rounded-xl border text-2xl " +
                (known ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-raise")
              }
            >
              {sym}
              {!known && (
                <i className="absolute bottom-0 left-0 h-1 bg-accent" style={{ width: (100 * n) / reps + "%" }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-xs text-muted">
        The bar fills with right repetitions. Tests from memory start after {reps}.
      </div>
    </div>
  );
}
