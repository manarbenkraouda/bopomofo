"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, type CoachState, type CoachStep, type Finding, type Milestone } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { ActionBar } from "@/components/shell/ActionBar";
import { Caps, Kbd } from "@/components/shell/Kbd";
import { StoryPlayer } from "@/components/story/StoryPlayer";

export const STEP_ICON: Record<string, string> = { speak_sentences: "說", speak_sounds: "說", listen_tones: "聽", listen_sounds: "聽", read_symbols: "讀", write_symbols: "默", write_syllables: "寫" };
const STEP_KIND: Record<string, string> = {
  speak_sentences: "Speaking · sentences", speak_sounds: "Speaking · sounds", listen_tones: "Listening · tones", listen_sounds: "Listening · sounds",
  read_symbols: "Reading", write_symbols: "Dictation", write_syllables: "Writing · syllables",
};
const DOMAIN: Record<string, string> = { tones_listening: "Tones by ear", tones_speaking: "Spoken tones", sounds: "Sounds", symbols: "Symbols", sentences: "Sentences" };
const SKIP = { too_hard: "too hard", too_easy: "too easy", not_now: "not now" } as const;

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

export function Coach() {
  const router = useRouter();
  const [st, setSt] = useState<CoachState | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(0);
  const [allFindings, setAllFindings] = useState(false);
  const [now, setNow] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
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
  const newPlan = () => api.coachPlan("The learner asked for a new plan now.").then(setSt).catch((e: Error) => setErr(e.message));
  const hasStory = !!st?.plan?.has_story;
  // "How do we know?": open the story, or write it first for a plan that has none.
  const story = () => {
    if (!st?.plan || st.generating) return;
    if (hasStory) setStoryOpen(true);
    else api.writeStory(st.plan.id).then(setSt).catch((e: Error) => setErr(e.message));
  };

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
    { keys: ["KeyF"], label: allFindings ? "Fewer findings" : "All findings", run: () => setAllFindings((v) => !v), bar: false },
    { keys: ["KeyP"], label: "New plan", run: newPlan, when: !!st && !st.generating },
    { keys: ["KeyW"], label: hasStory ? "How do we know?" : "Write the story", run: story, when: !!st?.plan && !st.generating },
  ], { active: !storyOpen });

  if (!st) return <div className="grid flex-1 place-items-center text-muted">{err || "Loading the coach…"}</div>;
  const plan = st.plan;
  const done = steps.filter((s) => s.status !== "open").length;
  const findings = plan?.findings ?? [];
  const elapsed = st.generating && now ? Math.max(0, Math.round(now - st.started)) : 0;
  const lead = open ? cur : firstOpen >= 0 ? steps[firstOpen] : null;
  const writing = !!st.writing_story && st.writing_story === plan?.id;

  return (
    <div className="grid flex-1 content-start gap-5 lg:grid-cols-[1.45fr_1fr] lg:gap-6">
      {err && <div className="card border-bad/60 p-3 text-sm text-bad lg:col-span-2">{err}</div>}
      {storyOpen && plan && hasStory && (
        <StoryPlayer planId={plan.id} onClose={() => setStoryOpen(false)} onStart={() => { setStoryOpen(false); start(lead ?? undefined); }} />
      )}

      {st.generating && !st.building_next && !writing && (
        <section className="card flex items-center gap-4 p-5 lg:col-span-2">
          <span className="cjk grid h-12 w-12 shrink-0 animate-pulse place-items-center rounded-2xl bg-accent text-2xl text-white">練</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">The coach is building your next plan…</div>
            <div className="text-sm text-muted">{st.stage || "Starting"} · {elapsed}s</div>
            <div className="mt-2 text-xs text-muted">Analysts read every area of your stats, a planner writes the steps, a writer and a picker prepare the exact sentences and syllables, and a reviewer checks the result. This takes about a minute.</div>
          </div>
        </section>
      )}

      {plan && (
        <section className="card relative overflow-hidden p-5 md:p-6 lg:col-span-2">
          <div className="pointer-events-none absolute -bottom-10 -right-2 select-none cjk text-[150px] leading-none text-accent opacity-[.06]">練習</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-semibold uppercase tracking-wide text-accent">{plan.status === "active" ? "Your plan" : plan.status === "done" ? "Plan finished" : "Previous plan"}</span>
            <span>built {ago(plan.ts)}</span>
            {plan.source === "llm" ? (
              <span title={Object.entries(plan.calls.stages).map(([k, v]) => v + " " + k).join(", ") + " · " + Object.keys(plan.calls.models).join(", ")}>
                {plan.calls.count} coach decisions · {plan.calls.seconds ?? "–"}s · {"$" + plan.calls.cost.toFixed(3)}
              </span>
            ) : <span className="text-rough" title={plan.error ?? ""}>Built by rules: the coach model was not available</span>}
            <span>{done}/{steps.length} steps done</span>
            <span>{plan.new_answers} answers since</span>
          </div>
          {plan.headline ? (
            <p className="relative mt-3 max-w-3xl text-xl font-semibold leading-snug md:text-2xl">{plan.headline}</p>
          ) : (
            <p className="relative mt-3 line-clamp-2 max-w-3xl text-sm text-muted" title={plan.diagnosis}>
              {st.generating ? "The coach is writing a short summary of this plan…" : plan.diagnosis}
            </p>
          )}
          <div className="relative mt-4 flex flex-wrap items-center gap-2">
            {lead && (
              <button onClick={() => start(lead)} className="btn btn-accent !rounded-xl !px-5 !py-3 text-base font-semibold max-md:!hidden">
                <span className="cjk">{STEP_ICON[lead.type]}</span> Start: {lead.title} <Kbd>Enter</Kbd>
              </button>
            )}
            <button onClick={story} disabled={st.generating} className="btn story-btn !rounded-xl !py-2.5 font-semibold">
              <span aria-hidden>✦</span> {writing ? "Writing the story…" : hasStory ? "How do we know?" : "Write the story"} <Kbd className="max-md:!hidden">W</Kbd>
            </button>
            <button onClick={newPlan} disabled={st.generating} className="btn">New plan <Kbd className="max-md:!hidden">P</Kbd></button>
            {plan.stale && <span className="text-xs text-rough">{plan.new_answers} answers since this plan: a new plan reads them all.</span>}
            {st.building_next && <span className="text-xs text-muted">The next plan is being prepared: {st.stage}…</span>}
            {st.next_ready && <span className="text-xs text-ok">The next plan is ready. It starts when this one ends.</span>}
          </div>
        </section>
      )}

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">Steps <span className="normal-case tracking-normal">· they end when you reach the target, not on a date</span></h2>
        {steps.map((s, i) => <StepCard key={s.id} s={s} i={i} active={i === sel} onSelect={() => setSel(i)} onStart={() => start(s)} onSkip={skip} />)}
        {!steps.length && !st.generating && <div className="card p-5 text-sm text-muted">No plan yet. Press <Kbd>P</Kbd> to build one.</div>}
      </section>

      <aside className="flex min-w-0 flex-col gap-5">
        <Alphabet a={st.alphabet} />
        <Milestones list={st.milestones} />
        {findings.length > 0 && (
          <div className="card p-4 md:p-5">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">What the stats show</h2>
              <span className="text-xs text-muted">{findings.length} findings</span>
              <button className="ml-auto text-xs text-accent hover:underline" onClick={() => setAllFindings((v) => !v)}>{allFindings ? "Fewer" : "All"} <Kbd className="max-md:!hidden">F</Kbd></button>
            </div>
            <div className="flex flex-col gap-3">
              {findings.slice(0, allFindings ? 40 : 5).map((f) => <FindingRow key={f.id} f={f} cited={!!cur?.finding_ids.includes(f.id)} />)}
            </div>
            {allFindings && plan && (
              <div className="mt-4 grid gap-3 text-xs">
                <List title="Strengths" items={plan.strengths} cls="text-ok" />
                <List title="Not known yet" items={plan.unknown} cls="text-rough" />
                <List title="Too early" items={plan.too_advanced} cls="text-muted" />
              </div>
            )}
          </div>
        )}
        {st.notes.length > 0 && (
          <div className="card p-4 md:p-5">
            <h2 className="mb-3 text-sm font-semibold">Coach notes</h2>
            <div className="flex flex-col gap-2.5">
              {st.notes.slice(0, 8).map((n) => (
                <div key={n.id} className="text-sm">
                  <span className="mr-1.5 text-xs text-muted">{ago(n.ts)} · {n.kind.replace("checkpoint:", "check: ")}</span>{n.text}
                </div>
              ))}
            </div>
          </div>
        )}
        {st.history.length > 1 && (
          <div className="card p-4 md:p-5">
            <h2 className="mb-3 text-sm font-semibold">Previous plans</h2>
            <div className="flex flex-col gap-2">
              {st.history.filter((h) => h.id !== plan?.id).slice(0, 6).map((h) => (
                <div key={h.id} className="flex items-start gap-3 text-sm" title={h.headline ?? h.diagnosis}>
                  <span className={"mt-0.5 shrink-0 rounded-md px-1.5 text-xs font-semibold " + (h.status === "done" ? "bg-ok/15 text-ok" : "bg-line text-muted")}>{h.done}/{h.steps}</span>
                  <span className="line-clamp-2 flex-1 text-muted">{h.headline ?? h.diagnosis}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(h.ts)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="px-1 text-xs text-muted">
          Coach model: {st.coach_model} · today {st.usage.today_calls} calls ({"$" + st.usage.today_cost.toFixed(3)}) · all time {st.usage.calls} calls ({"$" + st.usage.cost.toFixed(2)})
        </div>
      </aside>

      <ActionBar mobileOnly>
        {open ? (
          <>
            <button className="btn" onClick={() => skip("too_hard")}>Too hard</button>
            <button className="btn" onClick={() => skip("too_easy")}>Too easy</button>
            <button className="btn btn-accent ab-primary" onClick={() => start(cur)}><span className="cjk">{STEP_ICON[cur.type]}</span> Start: {cur.title}</button>
          </>
        ) : lead ? (
          <button className="btn btn-accent ab-primary" onClick={() => start(lead)}>Start: {lead.title}</button>
        ) : (
          <button className="btn ab-primary" onClick={newPlan} disabled={st.generating}>{st.generating ? "Building your next plan…" : "New plan"}</button>
        )}
      </ActionBar>
    </div>
  );
}

function StepCard({ s, i, active, onSelect, onStart, onSkip }: {
  s: CoachStep; i: number; active: boolean; onSelect: () => void; onStart: () => void; onSkip: (r: keyof typeof SKIP) => void;
}) {
  const pct = Math.min(100, (100 * s.progress) / Math.max(1, s.target));
  const done = s.status === "done";
  const skipped = s.status === "skipped";
  const chips = focusChips(s);
  return (
    <div onClick={onSelect} className={"card tile relative flex cursor-pointer gap-3.5 p-4 transition md:gap-4 " + (active ? "!border-accent ring-2 ring-accent/25 " : "hover:border-accent/50 ") + (skipped ? "opacity-60" : "")}>
      <div className="flex flex-col items-center gap-1.5">
        <span className={"cjk grid h-12 w-12 place-items-center rounded-2xl text-2xl " + (done ? "bg-ok text-white" : skipped ? "bg-line text-muted" : "bg-accent-soft text-accent")}>{done ? "✓" : STEP_ICON[s.type]}</span>
        <Kbd className="max-md:!hidden">{i + 1}</Kbd>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{STEP_KIND[s.type]} · about {s.minutes} min{skipped && s.skip_reason ? " · skipped: " + SKIP[s.skip_reason as keyof typeof SKIP] : ""}</div>
        <div className="text-base font-semibold leading-snug md:text-lg">{s.title}</div>
        <p className="mt-1 text-sm text-muted">{s.why}</p>
        {chips.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{chips.map((c) => <span key={c} className="chip cjk !cursor-default !px-2 !py-0.5 text-xs">{c}</span>)}</div>}
        <div className="mt-3 flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line"><div className={"h-full rounded-full transition-all duration-500 " + (done ? "bg-ok" : "bg-accent")} style={{ width: pct + "%" }} /></div>
          <span className="text-xs font-semibold tabular-nums">{s.progress}/{s.target}</span>
          {s.tried > 0 && <span className="text-xs tabular-nums text-muted">{Math.round((100 * s.right) / s.tried)}% of {s.tried}</span>}
        </div>
        {s.note && <div className="mt-2.5 rounded-xl bg-raise px-3 py-2 text-sm"><b className="text-accent">Coach:</b> {s.note.text}</div>}
        {active && (
          <div className="mt-3 flex flex-col gap-2.5 text-sm">
            {s.items && s.items.length > 0 && (
              <div className="flex flex-col gap-1">
                {s.items.map((x) => (
                  <div key={x.text} className="flex items-center gap-2">
                    <span className="cjk flex-1 truncate">{x.text}</span>
                    <span className="text-xs tabular-nums text-muted">{x.tries ? "best " + x.best + " · last " + x.last : "not recorded"}</span>
                    <span className={"w-10 text-right text-xs font-semibold tabular-nums " + (x.passes >= (s.params.reps ?? 1) ? "text-ok" : "")}>{x.passes}/{s.params.reps}</span>
                  </div>
                ))}
              </div>
            )}
            {s.params.deck && (
              <div>
                <div className="flex flex-wrap gap-1">{s.params.deck.map((z) => <span key={z} className="cjk rounded-md border border-line px-1.5 text-sm">{z}</span>)}</div>
                {s.params.deck_why && <div className="mt-1 text-xs text-muted">{s.params.deck_why}</div>}
              </div>
            )}
            {s.review && <div className="text-xs text-muted"><b>Reviewer:</b> {s.review}</div>}
            {s.status === "open" && (
              <div className="flex flex-wrap gap-2 max-md:hidden">
                <button className="btn btn-accent" onClick={(e) => { e.stopPropagation(); onStart(); }}>Start <Kbd>Enter</Kbd></button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); onSkip("too_hard"); }}>Too hard <Kbd>H</Kbd></button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); onSkip("too_easy"); }}>Too easy <Kbd>E</Kbd></button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); onSkip("not_now"); }}>Not now <Kbd>N</Kbd></button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Milestones({ list }: { list: Milestone[] }) {
  if (!list.length) return null;
  return (
    <div className="card p-4 md:p-5">
      <h2 className="mb-3 text-sm font-semibold">Milestones <span className="font-normal text-muted">· measured on your latest answers</span></h2>
      <div className="flex flex-col gap-4">
        {list.map((m) => {
          const c = m.criterion;
          const score = c.unit === "score";
          const alpha = c.unit === "alphabet";
          const v = m.value ?? 0;
          return (
            <div key={m.id} title={m.why}>
              <div className="flex items-start gap-2">
                <span className="cjk flex-1 text-sm font-semibold leading-snug">{m.title}</span>
                {m.status === "achieved" ? <span className="font-bold text-ok">✓</span>
                  : <span className="text-xs tabular-nums text-muted">{alpha ? m.n + "/37" : (m.value ?? "–") + (score ? "" : "%")}</span>}
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-line">
                <div className={"h-full rounded-full " + (m.status === "achieved" ? "bg-ok" : v >= c.min_acc ? "bg-ok/70" : "bg-accent")} style={{ width: Math.min(100, v) + "%" }} />
                <div className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink" style={{ left: c.min_acc + "%" }} title={"Goal " + c.min_acc} />
              </div>
              <div className="mt-1 text-xs text-muted">
                {m.status === "achieved" ? "Reached " + ago(m.done_ts ?? m.ts) : alpha ? m.n + " of 37 symbols known" : m.n < c.window ? m.n + " of " + c.window + " answers so far" : "on the last " + c.window + " answers"}
                {!alpha && <>{" · "}{c.area} {score ? "score" : c.unit}{c.expected.length ? " " + c.expected.join(" ") : ""}</>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FindingRow({ f, cited }: { f: Finding; cited: boolean }) {
  return (
    <div className={"rounded-xl border p-3 " + (cited ? "border-accent/60 bg-accent-soft/40" : "border-line")}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">{DOMAIN[f.domain] ?? f.domain}</span>
        <span title={"severity " + f.severity + "/5"} className="tracking-tighter text-accent">{"●".repeat(f.severity)}<span className="text-line">{"●".repeat(5 - f.severity)}</span></span>
        <span title="How sure the coach is, from the number of answers">sure {f.confidence}/5</span>
      </div>
      <div className="mt-1 text-sm">{f.problem}</div>
      {f.context && <div className="mt-0.5 text-xs text-muted">{f.context}</div>}
      {f.items.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{f.items.slice(0, 10).map((x) => <span key={x} className="cjk rounded-md bg-raise px-1.5 text-xs">{x}</span>)}</div>}
    </div>
  );
}

function List({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className={"mb-1 font-semibold " + cls}>{title}</div>
      <ul className="flex flex-col gap-1 text-muted">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** The 37 symbols: known, seen but not known yet, never practiced. The ring marks the next group the coach teaches.
 * The bar under a symbol fills with right repetitions; tests from memory start when it is full. */
function Alphabet({ a }: { a: CoachState["alphabet"] }) {
  if (!a || a.known_count >= 37) return null;
  const cls = { known: "border-ok/60 bg-ok/15 text-ok", learning: "border-rough/60 bg-rough/10", new: "border-line text-muted" };
  return (
    <div className="card p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Alphabet</h2>
        <span className="text-xs text-muted">{a.known_count} of 37 known{a.gate ? " · it comes first in every plan" : ""} · {a.learn_reps} repetitions, then tests from memory</span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {a.symbols.map((s) => (
          <Link key={s.sym} href={"/reading?syms=" + encodeURIComponent(s.sym) + (s.phase === "repeat" ? "&learn=1" : "")}
            title={s.state + " · " + Math.min(s.reps, a.learn_reps) + "/" + a.learn_reps + " repetitions" + (s.answers ? " · from memory: said " + (s.say ?? "–") + " · written " + (s.write ?? "–") + (s.pick ? " · picked " + s.pick : "") : s.reps ? "" : " · never practiced")}
            className={"cjk relative grid aspect-square place-items-center overflow-hidden rounded-md border text-base transition hover:scale-110 " + cls[s.state] + (a.next_group.includes(s.sym) ? " ring-2 ring-accent" : "")}>
            {s.sym}
            {s.phase !== "known" && s.reps > 0 && (
              <i className="absolute bottom-0 left-0 h-1 bg-accent" style={{ width: Math.min(100, (100 * s.reps) / a.learn_reps) + "%" }} />
            )}
          </Link>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ok" />known</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rough" />seen, not known yet</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-line" />new</span>
        <span><i className="mr-1 inline-block h-1 w-3 rounded-sm bg-accent align-middle" />repetitions</span>
        <span className="text-accent">ring: next to learn</span>
      </div>
    </div>
  );
}


export function CoachLink() {
  return <Link href="/coach" className="flex items-center gap-1 text-xs text-accent hover:underline">Open the coach <Caps caps={["G", "C"]} className="max-md:!hidden" /></Link>;
}

