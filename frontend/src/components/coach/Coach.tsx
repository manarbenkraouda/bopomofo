"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CoachState, type CoachStep, type Finding, type Milestone } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { missingFacts, useProfile } from "@/lib/profile";
import { useViewport } from "@/lib/useFit";
import { ActionBar } from "@/components/shell/ActionBar";
import { Caps, Kbd } from "@/components/shell/Kbd";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import { useAiQuota } from "@/components/quota/AiQuota";
import { BoboFace, BoboPackshot, BoboPose, BoboSays, VMark } from "@/components/mascot/Bobo";

export const STEP_ICON: Record<string, string> = { speak_sentences: "說", speak_sounds: "說", listen_tones: "聽", listen_sounds: "聽", read_symbols: "讀", recognize_symbols: "認", write_symbols: "默", write_syllables: "寫" };
const STEP_KIND: Record<string, string> = {
  speak_sentences: "Speaking · sentences", speak_sounds: "Speaking · sounds", listen_tones: "Listening · tones", listen_sounds: "Listening · sounds",
  read_symbols: "Reading", recognize_symbols: "Recognize · silent", write_symbols: "Dictation", write_syllables: "Writing · syllables",
};
const DOMAIN: Record<string, string> = { tones_listening: "Tones by ear", tones_speaking: "Spoken tones", sounds: "Sounds", symbols: "Symbols", sentences: "Sentences" };
const SKIP = { too_hard: "too hard", too_easy: "too easy", not_now: "not now" } as const;
/** Why a step was skipped: the learner's reason, or "locked" when its exercise is not unlocked yet. */
const SKIPPED: Record<string, string> = { ...SKIP, locked: "not unlocked yet" };
const SYMBOL_STEPS = new Set(["read_symbols", "recognize_symbols", "write_symbols"]);

/** Short labels for the focus of a step: tones, symbols, deck size, sentences. */
export function focusChips(s: CoachStep): string[] {
  const p = s.params;
  const out: string[] = [];
  if (p.tones?.length) out.push(p.tones.map((t) => (t === 5 ? "neutral tone" : "tone " + t)).join(" / "));
  if (p.syms?.length) out.push(p.syms.join(" "));
  if (p.focus?.pairs?.length) out.push("pairs " + p.focus.pairs.join(", "));
  if (p.deck?.length) out.push(p.deck.length + " picked syllables");
  if (p.texts?.length) out.push(p.texts.length + " sentences × " + p.reps + " at " + p.min_score + "+");
  return out;
}

const ago = (ts: number) => {
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
};
const share = (s: CoachStep) => Math.min(100, (100 * s.progress) / Math.max(1, s.target));

type More = "goals" | "alphabet" | "evidence" | "notes" | "history";

/**
 * The coach page. The plan comes first: its headline, a track of the steps, and the selected step in detail.
 * What the plan is based on (goals, alphabet, findings, notes, past plans) is one tabbed section below it.
 */
export function Coach() {
  const { quota, blocked: aiBlocked } = useAiQuota();
  const profile = useProfile();
  const profileGaps = profile ? missingFacts(profile).length : 0;
  const router = useRouter();
  const [st, setSt] = useState<CoachState | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(0);
  const [more, setMore] = useState<More | null>(null);
  const [allFindings, setAllFindings] = useState(false);
  const [now, setNow] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const moreRef = useRef<HTMLElement>(null);
  const { w } = useViewport();
  const wide = w >= 1024;
  const load = useCallback(() => api.coach().then((s) => { setSt(s); setErr(""); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  // Quick polls while the coach builds a plan, slow polls after (checkpoint notes arrive in the background).
  useEffect(() => { const t = setTimeout(load, st?.generating ? 2500 : 20000); return () => clearTimeout(t); }, [st, load]);
  useEffect(() => {
    if (!st?.generating) return;
    const tick = () => setNow(Date.now() / 1000);
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [st?.generating]);

  const steps = st?.steps ?? [];
  const firstOpen = steps.findIndex((s) => s.status === "open");
  const planId = st?.plan?.id;
  // A new plan selects its first open step.
  useEffect(() => { setSel(Math.max(0, firstOpen)); }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = steps[sel];
  const open = cur?.status === "open";
  const start = (s?: CoachStep) => { if (s && s.status === "open") router.push(s.href); };
  const skip = (reason: keyof typeof SKIP) => { if (cur && open) api.skipStep(cur.id, reason).then(setSt).catch((e: Error) => setErr(e.message)); };
  const newPlan = () => { if (quota && !aiBlocked) api.coachPlan("The learner asked for a new plan now.").then(setSt).catch((e: Error) => setErr(e.message)); };
  const hasStory = !!st?.plan?.has_story;
  // "How do we know?": open the story, or write it first for a plan that has none.
  const story = () => {
    if (!st?.plan || st.generating) return;
    if (hasStory) setStoryOpen(true);
    else if (quota && !aiBlocked) api.writeStory(st.plan.id).then(setSt).catch((e: Error) => setErr(e.message));
  };
  const showMore = (m: More) => { setMore(m); requestAnimationFrame(() => moreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  useHotkeys("coach", [
    { keys: ["Enter"], label: "Start the step", run: () => start(open ? cur : steps[firstOpen]), when: firstOpen >= 0 },
    ...steps.map((s, i) => ({ keys: ["Digit" + (i + 1), "Numpad" + (i + 1)], label: "Start: " + s.title, run: () => start(s), when: s.status === "open", bar: false })),
    { keys: [], label: "Start step 1-" + steps.length, show: ["1–" + steps.length], when: steps.length > 1 },
    { keys: ["ArrowDown", "KeyJ"], label: "Next step", run: () => setSel((i) => Math.min(steps.length - 1, i + 1)), when: steps.length > 1, bar: false, repeat: true },
    { keys: ["ArrowUp", "KeyK"], label: "Previous step", run: () => setSel((i) => Math.max(0, i - 1)), when: steps.length > 1, bar: false, repeat: true },
    { keys: [], label: "Select", show: ["↑", "↓"], when: steps.length > 1 },
    { keys: ["KeyH"], label: "Too hard", run: () => skip("too_hard"), when: open },
    { keys: ["KeyE"], label: "Too easy", run: () => skip("too_easy"), when: open },
    { keys: ["KeyN"], label: "Not now", run: () => skip("not_now"), when: open },
    { keys: ["KeyF"], label: "Show the evidence", run: () => showMore("evidence"), when: !!st?.plan?.findings.length, bar: false },
    { keys: ["KeyP"], label: "New plan", run: newPlan, when: !!st && !st.generating && !!quota && !aiBlocked },
    { keys: ["KeyW"], label: hasStory ? "How do we know?" : "Write the story", run: story, when: !!st?.plan && !st.generating && (hasStory || (!!quota && !aiBlocked)) },
  ], { active: !storyOpen });

  if (!st) return <div className="grid flex-1 place-items-center text-muted">{err || <span className="flex flex-col items-center gap-3"><BoboFace size={64} pulse />Bobo is on the way…</span>}</div>;
  const plan = st.plan;
  const elapsed = st.generating && now ? Math.max(0, Math.round(now - st.started)) : 0;
  const lead = open ? cur : firstOpen >= 0 ? steps[firstOpen] : null;
  const writing = !!st.writing_story && st.writing_story === plan?.id;
  const detail = cur && (
    <StepDetail s={cur} i={sel} alphabet={st.alphabet} findings={plan?.findings ?? []}
      onStart={() => start(cur)} onSkip={skip} onEvidence={() => showMore("evidence")} />
  );

  return (
    <div className="flex flex-1 flex-col gap-5 md:gap-6">
      {err && <div className="card flex items-center gap-3 border-bad/60 p-3 text-sm text-bad"><BoboPose pose="encourage" className="w-12" />{err}</div>}
      {storyOpen && plan && hasStory && (
        <StoryPlayer planId={plan.id} onClose={() => setStoryOpen(false)} onStart={() => { setStoryOpen(false); start(lead ?? undefined); }} />
      )}

      {st.generating && !st.building_next && !writing && (
        <section className="card flex items-center gap-4 p-5">
          <BoboPose pose="thinking" className="w-16" bob />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Bobo is building your next plan…</div>
            <div className="text-sm text-muted">{st.stage || "Starting"} · {elapsed}s · about a minute</div>
          </div>
        </section>
      )}

      {plan && (
        <PlanHeader st={st} sel={sel} onSelect={setSel} onStory={story} onNewPlan={newPlan} writing={writing} />
      )}

      {steps.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-6">
          <section aria-label="Steps" className="flex min-w-0 flex-col gap-2">
            {steps.map((s, i) => (
              <div key={s.id} id={"step-" + s.id} className="flex scroll-mt-2 flex-col gap-2">
                <StepRow s={s} i={i} active={i === sel} onSelect={() => {
                  setSel(i);
                  // Narrow screens: the step above closes, so bring the opened step to the top.
                  if (!wide) requestAnimationFrame(() => document.getElementById("step-" + s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }} />
                {!wide && i === sel && <div className="card p-4 md:p-5">{detail}</div>}
              </div>
            ))}
          </section>
          {wide && cur && <aside className="card sticky top-0 p-6">{detail}</aside>}
        </div>
      )}
      {!steps.length && !st.generating && (
        <div className="card relative flex flex-col items-center gap-5 overflow-hidden p-6 sm:flex-row sm:items-center md:p-8">
          <VMark className="-bottom-24 -right-10 w-72" />
          <BoboPackshot className="w-40 shrink-0 md:w-52" priority />
          <div className="relative flex flex-col items-start gap-3">
          <div className="text-xl font-semibold">Hi, I&apos;m Bobo! <span className="cjk text-accent">波波</span></div>
          <p className="text-sm text-muted">I&apos;m a Formosan black bear, and your coach. I read your answers and build a short plan of steps for you.</p>
          {profileGaps > 0 && (
            <p className="text-sm text-muted">
              Your first plan waits for your profile, so its sentences talk about your life.{" "}
              <Link href="/profile" className="text-accent hover:underline">Complete your profile ({profileGaps} facts missing)</Link>
            </p>
          )}
          <button className="btn btn-accent" onClick={newPlan} disabled={!quota || aiBlocked}>{aiBlocked ? "AI is recharging" : "Build my plan"} <Kbd className="max-md:!hidden">P</Kbd></button>
          </div>
        </div>
      )}

      <AboutPlan st={st} cur={cur} tab={more} setTab={setMore} allFindings={allFindings} setAllFindings={setAllFindings} innerRef={moreRef} />

      <ActionBar mobileOnly>
        {open ? (
          <>
            <button className="btn" onClick={() => skip("too_hard")}>Too hard</button>
            <button className="btn" onClick={() => skip("too_easy")}>Too easy</button>
            <button className="btn btn-accent ab-primary" onClick={() => start(cur)}><span className="cjk">{STEP_ICON[cur.type]}</span> Start step {sel + 1}</button>
          </>
        ) : lead ? (
          <button className="btn btn-accent ab-primary" onClick={() => start(lead)}>Start: {lead.title}</button>
        ) : (
          <button className="btn ab-primary" onClick={newPlan} disabled={st.generating || !quota || aiBlocked}>{aiBlocked ? "AI is recharging" : st.generating ? "Building your next plan…" : "New plan"}</button>
        )}
      </ActionBar>
    </div>
  );
}

// ---------- The plan ----------

function PlanHeader({ st, sel, onSelect, onStory, onNewPlan, writing }: {
  st: CoachState; sel: number; onSelect: (i: number) => void; onStory: () => void; onNewPlan: () => void; writing: boolean;
}) {
  const { quota, blocked: aiBlocked } = useAiQuota();
  const plan = st.plan!;
  const steps = st.steps;
  const done = steps.filter((s) => s.status === "done").length;
  const left = steps.filter((s) => s.status === "open").reduce((a, s) => a + s.minutes, 0);
  const finished = steps.length > 0 && !steps.some((s) => s.status === "open");
  return (
    <section className="card relative overflow-hidden p-5 md:p-7">
      <VMark className="-bottom-16 -right-8 w-72" />
      {/* Phone: headline, progress, buttons. Desktop: the buttons on the right of the headline and the progress. */}
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <BoboFace size={32} /><span className="font-semibold uppercase tracking-wide text-accent">{plan.status === "active" ? "Bobo's plan for you" : plan.status === "done" ? "Plan finished" : "Previous plan"}</span>
            <span>built {ago(plan.ts)}</span>
            {plan.source !== "llm" && <span className="text-rough" title={plan.error ?? ""}>built by rules: Bobo’s planner was not available</span>}
          </div>
          <p className="mt-3 max-w-3xl text-xl font-semibold leading-snug md:text-[1.6rem] md:leading-tight">
            {plan.headline ?? (st.generating ? "Bobo is writing a short summary of this plan…" : <span className="line-clamp-3 text-base font-normal text-muted">{plan.diagnosis}</span>)}
          </p>
        </div>
        <div className="order-3 flex flex-wrap items-center gap-2 lg:order-none lg:row-span-2 lg:flex-col lg:items-stretch">
          <button onClick={onStory} disabled={st.generating || (!plan.has_story && (!quota || aiBlocked))} className="btn story-btn justify-center !rounded-xl !px-3 !py-2.5 font-semibold md:!px-4">
            <span aria-hidden>✦</span> {writing ? "Writing the story…" : plan.has_story ? "How do we know?" : "Write the story"} <Kbd className="max-md:!hidden">W</Kbd>
          </button>
          <button onClick={onNewPlan} disabled={st.generating || !quota || aiBlocked} className="btn justify-center !rounded-xl !px-3 !py-2.5 md:!px-4">{aiBlocked ? "AI is recharging" : "New plan"} <Kbd className="max-md:!hidden">P</Kbd></button>
        </div>
        {steps.length > 0 && (
          <div className="max-w-3xl">
            <div className="flex gap-1.5" aria-label="Plan progress">
              {steps.map((s, i) => (
                <button key={s.id} onClick={() => onSelect(i)} aria-label={"Step " + (i + 1) + ": " + s.title} title={i + 1 + ". " + s.title + " · " + s.progress + "/" + s.target}
                  className={"relative h-2.5 flex-1 overflow-hidden rounded-full bg-line transition " + (i === sel ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : "hover:brightness-125")}>
                  <i className={"absolute inset-y-0 left-0 rounded-full " + (s.status === "done" ? "bg-ok" : s.status === "skipped" ? "bg-muted/40" : "bg-accent")}
                    style={{ width: (s.status === "open" ? share(s) : 100) + "%" }} />
                </button>
              ))}
            </div>
            <div className="mt-2 text-sm text-muted">
              {finished ? <span className="flex items-center gap-3"><BoboPose pose="celebrate" className="w-16" />All steps are done! Bobo builds the next plan from your new answers.</span> : done + " of " + steps.length + " steps done · about " + left + " min left"}
            </div>
          </div>
        )}
      </div>

      {(plan.stale || st.building_next || st.next_ready) && (
        <div className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {plan.stale && <span className="text-rough">{plan.new_answers} new answers since this plan. A new plan reads them all.</span>}
          {st.building_next && <span className="text-muted">Preparing the next plan: {st.stage}…</span>}
          {st.next_ready && <span className="text-ok">The next plan is ready. It starts when this one ends.</span>}
        </div>
      )}
    </section>
  );
}

function StepRow({ s, i, active, onSelect }: { s: CoachStep; i: number; active: boolean; onSelect: () => void }) {
  const done = s.status === "done";
  const skipped = s.status === "skipped";
  return (
    <button onClick={onSelect} aria-current={active}
      className={"tile flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition md:p-3.5 " +
        (active ? "border-accent bg-accent-soft/40 " : "border-line bg-card hover:border-accent/50 ") + (skipped ? "opacity-55" : "")}>
      <span className={"cjk grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl " + (done ? "bg-ok text-white" : skipped ? "bg-line text-muted" : active ? "bg-accent text-white" : "bg-accent-soft text-accent")}>
        {done ? "✓" : STEP_ICON[s.type]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted">
          {STEP_KIND[s.type]} · {s.minutes} min{skipped ? " · skipped" : done ? " · done" : ""}
        </span>
        <span className={"cjk block truncate font-semibold leading-snug " + (skipped ? "line-through decoration-muted/60" : "")}>{s.title}</span>
        {!skipped && (
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><i className={"block h-full rounded-full " + (done ? "bg-ok" : "bg-accent")} style={{ width: share(s) + "%" }} /></span>
            <span className="text-[11px] font-semibold tabular-nums text-muted">{s.progress}/{s.target}</span>
          </span>
        )}
      </span>
      <Kbd className="max-md:!hidden">{i + 1}</Kbd>
    </button>
  );
}

function StepDetail({ s, i, alphabet, findings, onStart, onSkip, onEvidence }: {
  s: CoachStep; i: number; alphabet: CoachState["alphabet"]; findings: Finding[];
  onStart: () => void; onSkip: (r: keyof typeof SKIP) => void; onEvidence: () => void;
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
          <div className={"h-full rounded-full transition-all duration-500 " + (done ? "bg-ok" : "bg-accent")} style={{ width: share(s) + "%" }} />
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
            <button className="btn !px-2.5 !py-1 text-xs" onClick={() => onSkip("too_hard")}>Too hard <Kbd>H</Kbd></button>
            <button className="btn !px-2.5 !py-1 text-xs" onClick={() => onSkip("too_easy")}>Too easy <Kbd>E</Kbd></button>
            <button className="btn !px-2.5 !py-1 text-xs" onClick={() => onSkip("not_now")}>Not now <Kbd>N</Kbd></button>
          </div>
        </div>
      )}

      {s.note && <BoboSays><b className="text-accent">Bobo:</b> {s.note.text}</BoboSays>}

      {symbolStep && <StepSymbols syms={s.params.syms!} alphabet={alphabet} />}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{chips.map((c) => <span key={c} className="chip cjk !cursor-default !px-2.5 !py-0.5 text-xs">{c}</span>)}</div>
      )}

      {s.items && s.items.length > 0 && (
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {s.items.map((x) => (
            <div key={x.text} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="cjk min-w-0 flex-1 truncate text-base">{x.text}</span>
              <span className="text-xs tabular-nums text-muted">{x.tries ? "best " + x.best : "new"}</span>
              <span className={"w-9 text-right text-xs font-semibold tabular-nums " + (x.passes >= (s.params.reps ?? 1) ? "text-ok" : "")}>{x.passes}/{s.params.reps}</span>
            </div>
          ))}
        </div>
      )}

      {s.params.deck && (
        <div>
          <div className="flex flex-wrap gap-1">{s.params.deck.map((z) => <span key={z} className="cjk rounded-md border border-line px-1.5 text-sm">{z}</span>)}</div>
          {s.params.deck_why && <div className="mt-1.5 text-xs text-muted">{s.params.deck_why}</div>}
        </div>
      )}

      {(cited > 0 || s.review) && (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
          {cited > 0 && <button className="w-fit text-accent hover:underline" onClick={onEvidence}>Based on {cited} finding{cited > 1 ? "s" : ""} from your stats →</button>}
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
            <div key={sym} title={known ? "known" : n + "/" + reps + " repetitions"}
              className={"cjk relative grid aspect-square place-items-center overflow-hidden rounded-xl border text-2xl " + (known ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-raise")}>
              {sym}
              {!known && <i className="absolute bottom-0 left-0 h-1 bg-accent" style={{ width: (100 * n) / reps + "%" }} />}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-xs text-muted">The bar fills with right repetitions. Tests from memory start after {reps}.</div>
    </div>
  );
}

// ---------- What the plan is based on ----------

function AboutPlan({ st, cur, tab, setTab, allFindings, setAllFindings, innerRef }: {
  st: CoachState; cur: CoachStep | undefined; tab: More | null; setTab: (m: More) => void;
  allFindings: boolean; setAllFindings: (f: (v: boolean) => boolean) => void; innerRef: React.RefObject<HTMLElement | null>;
}) {
  const plan = st.plan;
  const findings = plan?.findings ?? [];
  const past = st.history.filter((h) => h.id !== plan?.id);
  const a = st.alphabet;
  const tabs: { id: More; label: string; count?: string }[] = [];
  if (st.milestones.length) tabs.push({ id: "goals", label: "Goals", count: st.milestones.filter((m) => m.status === "achieved").length + "/" + st.milestones.length });
  if (a && a.known_count < 37) tabs.push({ id: "alphabet", label: "Alphabet", count: a.known_count + "/37" });
  if (findings.length) tabs.push({ id: "evidence", label: "Evidence", count: String(findings.length) });
  if (st.notes.length) tabs.push({ id: "notes", label: "Bobo's notes", count: String(st.notes.length) });
  if (past.length) tabs.push({ id: "history", label: "Past plans", count: String(past.length) });
  if (!tabs.length) return null;
  const active = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  return (
    <section ref={innerRef} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">About this plan</h2>
        <div className="chips flex gap-1.5" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={active === t.id} className="chip flex items-center gap-1.5" data-active={active === t.id} onClick={() => setTab(t.id)}>
              {t.label}{t.count && <span className="text-[11px] tabular-nums opacity-70">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="card p-4 md:p-5" role="tabpanel">
        {active === "goals" && <Milestones list={st.milestones} />}
        {active === "alphabet" && a && <Alphabet a={a} />}
        {active === "evidence" && plan && <Evidence plan={plan} cur={cur} all={allFindings} toggle={() => setAllFindings((v) => !v)} />}
        {active === "notes" && (
          <div className="flex flex-col gap-3">
            {st.notes.slice(0, 12).map((n) => (
              <div key={n.id} className="text-sm leading-relaxed">
                <div className="text-xs text-muted">{ago(n.ts)} · {n.kind.startsWith("checkpoint:") ? "checkpoint" : "after a step"}</div>
                {n.text}
              </div>
            ))}
          </div>
        )}
        {active === "history" && (
          <div className="flex flex-col gap-3">
            {past.slice(0, 8).map((h) => (
              <div key={h.id} className="flex items-start gap-3 text-sm">
                <span className={"mt-0.5 shrink-0 rounded-md px-1.5 text-xs font-semibold tabular-nums " + (h.status === "done" ? "bg-ok/15 text-ok" : "bg-line text-muted")}>{h.done}/{h.steps}</span>
                <span className="line-clamp-2 flex-1 text-muted" title={h.headline ?? h.diagnosis}>{h.headline ?? h.diagnosis}</span>
                <span className="shrink-0 text-xs text-muted">{ago(h.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Milestones({ list }: { list: Milestone[] }) {
  return (
    <div>
      <p className="mb-4 text-xs text-muted">Long goals, measured on your latest answers. The line marks the goal.</p>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {list.map((m) => {
          const c = m.criterion;
          const score = c.unit === "score";
          const alpha = c.unit === "alphabet";
          const v = alpha ? (100 * m.n) / 37 : m.value ?? 0;
          const achieved = m.status === "achieved";
          return (
            <div key={m.id} title={m.why}>
              <div className="flex items-start gap-2">
                <span className="cjk flex-1 text-sm font-semibold leading-snug">{m.title}</span>
                {achieved ? <span className="font-bold text-ok">✓</span>
                  : <span className="text-sm font-semibold tabular-nums">{alpha ? m.n + "/37" : m.value == null ? "–" : Math.round(m.value) + (score ? "" : "%")}</span>}
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-line">
                <div className={"h-full rounded-full " + (achieved ? "bg-ok" : v >= c.min_acc ? "bg-ok/70" : "bg-accent")} style={{ width: Math.min(100, v) + "%" }} />
                {!alpha && <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: c.min_acc + "%" }} title={"Goal " + c.min_acc} />}
              </div>
              <div className="mt-1 text-xs text-muted">
                {achieved ? "Reached " + ago(m.done_ts ?? m.ts) : alpha ? "symbols known" : m.n < c.window ? m.n + " of " + c.window + " answers so far" : "on the last " + c.window + " answers"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Evidence({ plan, cur, all, toggle }: { plan: NonNullable<CoachState["plan"]>; cur: CoachStep | undefined; all: boolean; toggle: () => void }) {
  // The findings behind the selected step come first.
  const list = [...plan.findings].sort((x, y) => Number(!!cur?.finding_ids.includes(y.id)) - Number(!!cur?.finding_ids.includes(x.id)) || y.severity - x.severity);
  const shown = all ? list : list.slice(0, 4);
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-3 text-xs text-muted"><BoboPose pose="investigate" className="w-14" />What Bobo found in your stats before writing the plan. Highlighted: the findings behind the selected step.</p>
      <div className="grid gap-3 md:grid-cols-2">{shown.map((f) => <FindingCard key={f.id} f={f} cited={!!cur?.finding_ids.includes(f.id)} />)}</div>
      <button className="btn w-fit !py-1.5 text-sm" onClick={toggle}>{all ? "Show less" : "Show all " + list.length + " findings, strengths, and gaps"}</button>
      {all && (plan.strengths.length > 0 || plan.unknown.length > 0 || plan.too_advanced.length > 0) && (
        <div className="grid gap-4 border-t border-line pt-4 text-sm md:grid-cols-3">
          <List title="Strengths" items={plan.strengths} cls="text-ok" />
          <List title="Not known yet" items={plan.unknown} cls="text-rough" />
          <List title="Too early for now" items={plan.too_advanced} cls="text-muted" />
        </div>
      )}
    </div>
  );
}

function FindingCard({ f, cited }: { f: Finding; cited: boolean }) {
  return (
    <div className={"rounded-xl border p-3.5 " + (cited ? "border-accent/60 bg-accent-soft/40" : "border-line")}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{DOMAIN[f.domain] ?? f.domain}</span>
        <span className="ml-auto flex gap-0.5" title={"How much it matters: " + f.severity + "/5"}>
          {[1, 2, 3, 4, 5].map((k) => <i key={k} className={"h-1.5 w-3 rounded-full " + (k <= f.severity ? "bg-accent" : "bg-line")} />)}
        </span>
      </div>
      <div className="mt-1.5 text-sm leading-relaxed">{f.problem}</div>
      {f.items.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{f.items.slice(0, 10).map((x) => <span key={x} className="cjk rounded-md bg-raise px-1.5 text-xs">{x}</span>)}</div>}
    </div>
  );
}

function List({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className={"mb-1.5 text-xs font-semibold uppercase tracking-wide " + cls}>{title}</div>
      <ul className="flex flex-col gap-1.5 text-muted">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** The 37 symbols: known, seen but not known yet, never practiced. The ring marks the next group the coach teaches.
 * The bar under a symbol fills with right repetitions; tests from memory start when it is full. */
function Alphabet({ a }: { a: NonNullable<CoachState["alphabet"]> }) {
  const cls = { known: "border-ok/60 bg-ok/15 text-ok", learning: "border-rough/60 bg-rough/10", new: "border-line text-muted" };
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        {a.known_count} of 37 known{a.gate ? ". The alphabet comes first in every plan" : ""}. Each symbol starts with {a.learn_reps} repetitions, then tests from memory. Click a symbol to practice it.
      </p>
      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(19,minmax(0,1fr))]">
        {a.symbols.map((s) => (
          <Link key={s.sym} href={"/reading?syms=" + encodeURIComponent(s.sym) + (s.phase === "repeat" ? "&learn=1" : "")}
            title={s.state + " · " + Math.min(s.reps, a.learn_reps) + "/" + a.learn_reps + " repetitions" + (s.answers ? " · from memory: said " + (s.say ?? "–") + (s.type ? " · typed " + s.type : "") + " · written " + (s.write ?? "–") + (s.pick ? " · picked " + s.pick : "") : s.reps ? "" : " · never practiced")}
            className={"cjk relative grid aspect-square place-items-center overflow-hidden rounded-lg border text-lg transition hover:scale-110 " + cls[s.state] + (a.next_group.includes(s.sym) ? " ring-2 ring-accent" : "")}>
            {s.sym}
            {s.phase !== "known" && s.reps > 0 && (
              <i className="absolute bottom-0 left-0 h-1 bg-accent" style={{ width: Math.min(100, (100 * s.reps) / a.learn_reps) + "%" }} />
            )}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ok" />known</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rough" />seen, not known yet</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-line" />new</span>
        <span className="text-accent">ring: next to learn</span>
      </div>
    </div>
  );
}

export function CoachLink() {
  return <Link href="/coach" className="flex items-center gap-1 text-xs text-accent hover:underline">Open Bobo’s plan <Caps caps={["G", "C"]} className="max-md:!hidden" /></Link>;
}
