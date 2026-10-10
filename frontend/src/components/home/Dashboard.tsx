"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Challenge, type CoachState, type Summary } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { usePref } from "@/lib/prefs";
import { LAST_KEY, MODES, routeFor, type RouteInfo } from "@/lib/routes";
import { goalMinutes, useToday } from "@/lib/session";
import { Caps, Kbd } from "@/components/shell/Kbd";
import { focusChips, STEP_ICON } from "@/components/coach/Coach";

// The backend groups answers by area (older dictation answers are counted as dictation too).
const AREA_OF: Record<string, string> = { "/reading": "reading", "/listening": "listening", "/dictation": "dictation", "/speaking": "speaking", "/writing": "writing" };
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Dashboard() {
  const router = useRouter();
  const today = useToday();
  const last = routeFor(usePref(LAST_KEY, "/reading"));
  const [sum, setSum] = useState<Summary | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [coach, setCoach] = useState<CoachState | null>(null);
  useEffect(() => {
    api.summary().then(setSum).catch(() => {});
    api.challenges().then((r) => setChallenges(r.challenges)).catch(() => {});
    api.coach().then(setCoach).catch(() => {});
  }, []);
  // While the coach builds a plan, check again until it is ready.
  useEffect(() => {
    if (!coach?.generating || coach.steps.some((s) => s.status === "open")) return;
    const t = setTimeout(() => api.coach().then(setCoach).catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, [coach]);
  const step = coach?.steps.find((s) => s.status === "open") ?? null;
  const coachShown = !!coach && (!!step || coach.generating);
  const row1 = coachShown ? " lg:row-start-2" : " lg:row-start-1";

  useHotkeys("home", [
    { keys: ["Enter"], label: "Coach step: " + (step?.title ?? ""), run: () => step && router.push(step.href), when: !!step },
    { keys: step ? ["KeyC"] : ["Enter", "KeyC"], label: "Continue: " + last.label, run: () => router.push(last.href) },
    ...MODES.map((m, i) => ({ keys: ["Digit" + DIGITS[i], "Numpad" + DIGITS[i]], label: m.label, run: () => router.push(m.href), bar: false })),
    { keys: [], label: "Open a mode", show: ["1–" + MODES.length] },
    ...challenges.map((c, i) => ({ keys: [["KeyQ", "KeyW", "KeyE", "KeyR"][i]], label: "Challenge: " + c.title, run: () => router.push(c.href), bar: false })),
    { keys: [], label: "Challenges", show: ["Q", "W", "E", "R"], when: challenges.length > 0 },
  ]);

  const goal = goalMinutes();
  const minutes = Math.floor(today.seconds / 60);
  const pct = Math.min(1, today.seconds / (goal * 60));
  const acc = today.cards ? Math.round((100 * today.ok) / today.cards) : null;
  const weak = sum ? Object.entries(sum.symbols).filter(([, v]) => v.n >= 2).sort((a, b) => (b[1].err + 1) / (b[1].n + 2) - (a[1].err + 1) / (a[1].n + 2)).slice(0, 10) : [];
  const practice = MODES.filter((m) => m.area === "practice");
  const study = MODES.filter((m) => m.area === "study");

  return (
    // Phone: goal and Continue first, then the modes, then the stats. Desktop: goal and stats side by side above the modes.
    <div className="grid flex-1 content-start gap-5 md:gap-6 lg:grid-cols-[1.25fr_1fr]">
      {coach && coachShown && <CoachCard st={coach} />}
        <div className={"card relative flex flex-col items-center gap-5 overflow-hidden p-5 sm:flex-row sm:gap-7 md:p-6 lg:col-start-1" + row1}>
          <div className="pointer-events-none absolute -bottom-16 -right-4 select-none cjk text-[170px] leading-none text-accent opacity-[.06]">注音</div>
          <Ring pct={pct} done={today.goalHit}>
            <div className="text-3xl font-semibold tabular-nums">{minutes}</div>
            <div className="text-xs text-muted">of {goal} min</div>
          </Ring>
          <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
            <div>
              <div className="text-center text-sm text-muted sm:text-left">{today.goalHit ? "Daily goal reached. Keep the combo going!" : minutes ? "Keep going: " + (goal - minutes) + " min to your daily goal." : "Ready for today's session?"}</div>
              <div className="mt-2 grid grid-cols-4 gap-3">
                <Stat value={sum ? String(sum.day_streak) : "–"} label="day streak" icon="🔥" />
                <Stat value={String(today.cards)} label="cards today" />
                <Stat value={acc === null ? "–" : acc + "%"} label="right" />
                <Stat value={"×" + today.best} label="best combo" icon="⚡" />
              </div>
            </div>
            <button onClick={() => router.push(last.href)} className={"btn w-full justify-center !rounded-xl !px-5 !py-3.5 text-base font-semibold active:translate-y-[3px] active:shadow-none sm:w-fit " + (step ? "" : "btn-accent shadow-[0_4px_0_color-mix(in_srgb,var(--accent)_60%,#000)]")}>
              <span className="cjk">{last.icon}</span> Continue: {last.label} <Kbd className="max-md:!hidden">{step ? "C" : "Enter"}</Kbd>
            </button>
          </div>
        </div>

        <div className={"card order-last grid gap-5 p-5 sm:grid-cols-2 lg:order-none lg:col-start-2" + row1}>
          <div>
            <div className="mb-3 text-sm font-semibold">Tone accuracy <span className="font-normal text-muted">(speaking)</span></div>
            {sum && Object.keys(sum.tones).length ? [1, 2, 3, 4, 5].map((t) => {
              const v = sum.tones[String(t)];
              if (!v) return null;
              const p = Math.round((100 * (v.n - v.err)) / v.n);
              return (
                <div key={t} className="mb-2 flex items-center gap-2 text-sm">
                  <span className="w-14 text-muted">{t === 5 ? "Neutral" : "Tone " + t}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-line"><div className={"h-full " + (p >= 80 ? "bg-ok" : p >= 60 ? "bg-rough" : "bg-bad")} style={{ width: p + "%" }} /></div>
                  <span className="w-10 text-right tabular-nums">{p}%</span>
                </div>
              );
            }) : <div className="text-sm text-muted">Record some sentences to see your tone accuracy.</div>}
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold">Symbols to practice</div>
            {weak.length ? (
              <div className="flex flex-wrap gap-1.5">
                {weak.map(([k, v]) => (
                  <Link key={k} href={"/dictation?syms=" + encodeURIComponent(k)} title={Math.round((100 * v.err) / v.n) + "% errors in " + v.n + " tries"} className="flex flex-col items-center rounded-lg border border-line px-2 py-1 hover:border-accent">
                    <span className="cjk text-2xl leading-tight">{k}</span>
                    <span className="text-[10px] text-muted">{Math.round((100 * v.err) / v.n)}%</span>
                  </Link>
                ))}
              </div>
            ) : <div className="text-sm text-muted">Practice writing to find your weak symbols.</div>}
          </div>
        </div>
      {challenges.length > 0 && (
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xs uppercase tracking-wide text-muted">Today&apos;s challenges</h2>
            <span className="text-xs text-muted">· {challenges.filter((c) => c.done).length}/{challenges.length} done</span>
            <Link href="/stats" className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline">All stats <Kbd className="max-md:!hidden">G</Kbd><Kbd className="max-md:!hidden">T</Kbd></Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {challenges.map((c, i) => (
              <Link key={c.id} href={c.href} title={c.why} className={"card tile relative flex flex-col gap-2 p-3.5 transition hover:-translate-y-0.5 " + (c.done ? "!border-ok/60 bg-ok/10" : "hover:border-accent")}>
                <div className="flex items-start gap-2">
                  <span className="cjk flex-1 text-sm font-semibold leading-snug">{c.title}</span>
                  {c.done ? <span className="font-bold text-ok">✓</span> : <Kbd className="max-md:!hidden">{"QWER"[i]}</Kbd>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-line"><div className={"h-full rounded " + (c.done ? "bg-ok" : "bg-accent")} style={{ width: (100 * c.progress) / c.target + "%" }} /></div>
                  <span className="text-xs tabular-nums text-muted">{c.progress}/{c.target}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="lg:col-span-2">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Practice</h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-5">
          {practice.map((m) => <Tile key={m.href} m={m} n={MODES.indexOf(m) + 1} sum={sum} todayCount={today.areas[AREA_OF[m.href] ?? ""]} current={m.href === last.href} />)}
        </div>
      </section>
      <section className="lg:col-span-2">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Study</h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {study.map((m) => <Tile key={m.href} m={m} n={MODES.indexOf(m) + 1} sum={sum} wide extra={m.href === "/sentences" && sum ? sum.sentences + " saved sentences" : undefined} current={m.href === last.href} />)}
        </div>
      </section>
    </div>
  );
}

function Tile({ m, n, sum, todayCount, wide, extra, current }: { m: RouteInfo; n: number; sum: Summary | null; todayCount?: number; wide?: boolean; extra?: string; current?: boolean }) {
  const st = sum?.areas[AREA_OF[m.href] ?? ""];
  const p = st && st.total ? Math.round((100 * st.ok) / st.total) : null;
  return (
    <Link href={m.href} className={"card tile group relative flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-accent md:p-5 " + (wide ? "sm:flex-row sm:items-center" : "") + (current ? " border-accent/50" : "")}>
      <Kbd className="absolute right-4 top-4 !h-6 !min-w-6 text-xs">{n}</Kbd>
      <span className="cjk grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-2xl text-accent transition group-hover:scale-110">{m.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold md:text-lg">{m.label}</div>
        <div className="line-clamp-2 text-xs text-muted md:text-sm">{m.desc}</div>
        {(st || todayCount || extra) && (
          <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted">
            {p !== null && <div className="h-1.5 overflow-hidden rounded bg-line"><div className="h-full bg-ok" style={{ width: p + "%" }} /></div>}
            <div>{[todayCount ? todayCount + " today" : "", st ? st.total + " total" : "", p !== null ? p + "% right" : "", extra ?? ""].filter(Boolean).join(" · ")}</div>
          </div>
        )}
      </div>
    </Link>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon?: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{icon && <span className="mr-1 text-lg">{icon}</span>}{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Ring({ pct, done, children }: { pct: number; done: boolean; children: React.ReactNode }) {
  const r = 54, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-32 w-32 shrink-0 place-items-center md:h-36 md:w-36">
      <svg viewBox="0 0 128 128" className="absolute inset-0 -rotate-90">
        <circle cx={64} cy={64} r={r} fill="none" strokeWidth={10} style={{ stroke: "var(--line)" }} />
        <circle cx={64} cy={64} r={r} fill="none" strokeWidth={10} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ stroke: done ? "var(--ok)" : "var(--accent)", transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="text-center">{children}</div>
    </div>
  );
}

/** The coach's next step, first on Home: what to practice now and why. */
function CoachCard({ st }: { st: CoachState }) {
  const router = useRouter();
  const step = st.steps.find((s) => s.status === "open") ?? null;
  const ms = st.milestones.filter((m) => m.status === "active").slice(0, 3);
  return (
    <section className="card relative overflow-hidden border-accent/50 p-5 md:p-6 lg:col-span-2 lg:row-start-1">
      <div className="pointer-events-none absolute -right-3 -top-8 select-none cjk text-[130px] leading-none text-accent opacity-[.07]">練</div>
      <div className="relative grid gap-5 md:grid-cols-[1.4fr_1fr] md:gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="font-semibold uppercase tracking-wide text-accent">Coach</span>
            {step && <span>step {st.steps.indexOf(step) + 1} of {st.steps.length}</span>}
            <Link href="/coach" className="ml-auto flex items-center gap-1 text-accent hover:underline">Plan <Caps caps={["G", "C"]} className="max-md:!hidden" /></Link>
          </div>
          {step ? (
            <>
              <div className="mt-2 flex items-start gap-3">
                <span className="cjk grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent text-2xl text-white">{STEP_ICON[step.type]}</span>
                <div className="min-w-0">
                  <div className="text-lg font-semibold leading-snug md:text-xl">{step.title}</div>
                  <p className="mt-1 line-clamp-3 text-sm text-muted">{step.why}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{focusChips(step).map((c) => <span key={c} className="chip cjk !cursor-default !px-2 !py-0.5 text-xs">{c}</span>)}</div>
              <div className="mt-3 flex items-center gap-1">
                {st.steps.map((s) => <span key={s.id} className={"h-1.5 flex-1 rounded-full " + (s.status === "done" ? "bg-ok" : s.status === "skipped" ? "bg-muted/40" : s.id === step.id ? "bg-accent" : "bg-line")} />)}
              </div>
              <button onClick={() => router.push(step.href)} className="btn btn-accent mt-4 w-full justify-center !rounded-xl !px-5 !py-3.5 text-base font-semibold shadow-[0_4px_0_color-mix(in_srgb,var(--accent)_60%,#000)] active:translate-y-[3px] active:shadow-none sm:w-fit">
                Start step · {step.progress}/{step.target} <Kbd className="max-md:!hidden">Enter</Kbd>
              </button>
            </>
          ) : (
            <div className="mt-3 flex items-center gap-3 text-sm text-muted">
              <span className="cjk grid h-10 w-10 animate-pulse place-items-center rounded-xl bg-accent-soft text-xl text-accent">練</span>
              The coach is building your plan from your stats: {st.stage || "starting"}…
            </div>
          )}
        </div>
        {ms.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wide text-muted">Milestones</div>
            {ms.map((m) => (
              <div key={m.id} title={m.why}>
                <div className="flex items-center gap-2 text-sm"><span className="cjk flex-1 truncate">{m.title}</span><span className="text-xs tabular-nums text-muted">{m.criterion.unit === "alphabet" ? m.n + "/37" : m.value ?? "–"}</span></div>
                <div className="relative mt-1 h-2 rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent" style={{ width: Math.min(100, m.value ?? 0) + "%" }} />
                  <div className="absolute -top-0.5 h-3 w-0.5 bg-ink" style={{ left: m.criterion.min_acc + "%" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

