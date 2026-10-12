"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Challenge, type CoachState, type Levels, type Profile } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { usePref } from "@/lib/prefs";
import { missingFacts, PROFILE_KEYS, PROFILE_LABELS, useProfile } from "@/lib/profile";
import { LAST_KEY, routeFor } from "@/lib/routes";
import { goalMinutes, useToday } from "@/lib/session";
import { EXERCISE_DESC, exerciseOf, useLevels } from "@/lib/levels";
import { Caps, Kbd } from "@/components/shell/Kbd";
import { focusChips, STEP_ICON } from "@/components/coach/Coach";
import { BoboFace, BoboPose, poseFor, VMark } from "@/components/mascot/Bobo";
import { GoalBar, Stars } from "@/components/levels/LevelUi";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const NEW_DAYS = 3 * 86400;

type Ex = { key: string; label: string; href: string; level: number; isNew: boolean };

/**
 * Home, built around the level path: Bobo's next step first, then the level and its goals, today's goal,
 * the open exercises, and the exercises of the next level as locked teasers. Nothing else, so a new learner sees a short, clear start.
 */
export function Dashboard() {
  const router = useRouter();
  const today = useToday();
  const { lv, routeOpen } = useLevels();
  const lastPref = routeFor(usePref(LAST_KEY, "/reading"));
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [coach, setCoach] = useState<CoachState | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const profile = useProfile();
  useEffect(() => {
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
  // A new learner without a plan, and with facts still missing: welcome them and ask for the rest of the profile first.
  const gaps = profile ? missingFacts(profile) : [];
  const welcome = !!coach && !coach.plan && !coach.generating && gaps.length > 0;
  const coachShown = !welcome && !!coach && (!!step || coach.generating);
  const fillProfile = () => router.push("/profile" + (gaps[0] ? "?fact=" + gaps[0] : ""));
  const buildNow = () => {
    setBuilding(true); setBuildError("");
    api.coachPlan("First plan for this learner. They chose to start before the profile was complete.")
      .then(setCoach).catch((e: Error) => setBuildError(e.message)).finally(() => setBuilding(false));
  };

  // Read the clock after mount: a render-time Date.now() blocks the prerender of "/".
  const [now, setNow] = useState(0);
  useEffect(() => { const t = setTimeout(() => setNow(Date.now() / 1000)); return () => clearTimeout(t); }, []);
  const open: Ex[] = lv ? lv.levels.filter((l) => l.unlocked).flatMap((l) => l.opens.map((o) => ({
    ...o, level: l.n, isNew: now > 0 && l.n > 1 && !!l.unlocked_ts && now - l.unlocked_ts < NEW_DAYS && !Object.keys(lv.stars?.[o.key] ?? {}).length,
  }))) : [];
  const next = lv?.next ?? null;
  // "Continue" goes back to the last practice screen, when it is still open; else to the first exercise.
  const last = routeOpen(lastPref.href) && lastPref.area === "practice" ? { label: lastPref.label, href: lastPref.href, icon: lastPref.icon }
    : open[0] ? { label: open[0].label, href: open[0].href, icon: routeFor(open[0].href.split("?")[0]).icon } : null;
  const shownChallenges = challenges.filter((c) => { const ex = exerciseOf(c.href); return !lv || !ex || lv.exercises.includes(ex); });

  useHotkeys("home", [
    { keys: ["Enter"], label: "Complete my profile", run: fillProfile, when: welcome },
    { keys: ["KeyB"], label: "Build my plan now", run: buildNow, when: welcome && !building },
    { keys: ["Enter"], label: "Bobo's step: " + (step?.title ?? ""), run: () => step && router.push(step.href), when: !!step },
    { keys: step || welcome ? ["KeyC"] : ["Enter", "KeyC"], label: "Continue: " + (last?.label ?? ""), run: () => last && router.push(last.href), when: !!last },
    ...open.slice(0, 9).map((m, i) => ({ keys: ["Digit" + DIGITS[i], "Numpad" + DIGITS[i]], label: m.label, run: () => router.push(m.href), bar: false })),
    { keys: [], label: "Open an exercise", show: ["1–" + Math.min(9, open.length)], when: open.length > 0 },
    { keys: ["KeyV"], label: "My levels", run: () => router.push("/levels") },
    ...shownChallenges.map((c, i) => ({ keys: [["KeyQ", "KeyW", "KeyE", "KeyR"][i]], label: "Challenge: " + c.title, run: () => router.push(c.href), bar: false })),
    { keys: [], label: "Challenges", show: ["Q", "W", "E", "R"].slice(0, shownChallenges.length), when: shownChallenges.length > 0 },
  ]);

  const goal = goalMinutes();
  const minutes = Math.floor(today.seconds / 60);
  const pct = Math.min(1, today.seconds / (goal * 60));

  return (
    <div className="grid flex-1 content-start gap-5 md:gap-6 lg:grid-cols-[1.4fr_1fr]">
      {welcome && profile && <WelcomeCard profile={profile} building={building} error={buildError} onFill={fillProfile} onBuild={buildNow} />}
      {coach && coachShown && <CoachCard st={coach} />}

      {lv && <LevelCard lv={lv} />}

      <div className="card relative flex items-center gap-5 overflow-hidden p-5 md:p-6">
        <Ring pct={pct} done={today.goalHit}>
          <div className="text-2xl font-semibold tabular-nums">{minutes}</div>
          <div className="text-xs text-muted">of {goal} min</div>
        </Ring>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="text-sm text-muted">{today.goalHit ? "Daily goal reached. Keep the combo going!" : minutes ? "Keep going: " + (goal - minutes) + " min to your daily goal." : "Ready for today's session?"}</div>
          {last && (
            <button onClick={() => router.push(last.href)} className={"btn w-full justify-center !rounded-xl !px-4 !py-3 font-semibold active:translate-y-[3px] active:shadow-none " + (step || welcome ? "" : "btn-accent shadow-[0_4px_0_color-mix(in_srgb,var(--accent)_60%,#000)]")}>
              <span className="cjk">{last.icon}</span> Continue: {last.label} <Kbd className="max-md:!hidden">{step || welcome ? "C" : "Enter"}</Kbd>
            </button>
          )}
        </div>
        <BoboPose key={today.goalHit ? "tea" : last?.href} pose={today.goalHit ? "bubbletea" : poseFor(routeFor(last?.href.split("?")[0] ?? "/"))} className="zq-pop hidden w-20 shrink-0 self-end sm:block" />
      </div>

      <section className="lg:col-span-2">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-xs uppercase tracking-wide text-muted">Your exercises</h2>
          <Link href="/levels" className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline">All levels <Kbd className="max-md:!hidden">V</Kbd></Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {lv && open.map((m, i) => <Tile key={m.key} m={m} n={i + 1} lv={lv} current={m.href.split("?")[0] === last?.href.split("?")[0]} />)}
          {next?.opens.map((o) => (
            <Link key={o.key} href="/levels" className="card tile flex flex-col gap-2 border-dashed p-4 opacity-55 transition hover:opacity-90 md:p-5" title={"Opens at level " + next.n + ": " + next.title}>
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-line text-lg">🔒</span>
              <div className="font-semibold">{o.label}</div>
              <div className="text-xs text-muted">Level {next.n}: {next.title}</div>
            </Link>
          ))}
          {!lv && <div className="col-span-full py-6 text-center text-sm text-muted">Loading your exercises…</div>}
        </div>
      </section>

      {shownChallenges.length > 0 && (
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xs uppercase tracking-wide text-muted">Today&apos;s challenges</h2>
            <span className="text-xs text-muted">· {shownChallenges.filter((c) => c.done).length}/{shownChallenges.length} done</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shownChallenges.map((c, i) => (
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
    </div>
  );
}

/** The level card: where the learner is, the goals that open the next level, and the alphabet chapters at level 1. */
function LevelCard({ lv }: { lv: Levels }) {
  const cur = lv.levels.find((l) => l.current) ?? lv.levels[0];
  const last = lv.level >= lv.max_level;
  return (
    <Link href="/levels" className="card relative block overflow-hidden p-5 transition hover:border-accent md:p-6">
      <div className="pointer-events-none absolute -bottom-10 -right-2 select-none cjk text-[120px] leading-none text-accent opacity-[.06]">級</div>
      <div className="relative flex items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-2xl font-bold text-white shadow">{lv.level}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">Level {lv.level} of {lv.max_level}</div>
          <div className="text-xl font-semibold leading-snug">{lv.title}</div>
          {!last && lv.next && <div className="mt-0.5 text-sm text-muted">Next: level {lv.next.n}, {lv.next.title} · {cur.progress}%</div>}
        </div>
      </div>
      {!last && (
        <div className="relative mt-4 flex flex-col gap-3">
          {cur.goals.map((g) => <GoalBar key={g.key} g={g} missing={false} />)}
        </div>
      )}
      {lv.level === 1 && (
        <div className="relative mt-4 flex gap-2">
          {lv.chapters.map((c) => (
            <div key={c.key} className={"flex-1 rounded-lg border px-2 py-1.5 text-xs " + (c.open ? "border-line" : "border-dashed border-line opacity-50")}>
              <div className="font-semibold">{c.open ? "" : "🔒 "}{c.title}</div>
              <div className="tabular-nums text-muted">{c.open ? c.accurate + "/" + c.of + " accurate" : "locked"}</div>
            </div>
          ))}
        </div>
      )}
      {lv.drops.length > 0 && <div className="relative mt-3 text-xs text-muted">↻ {lv.drops.length} known {lv.drops.length === 1 ? "item needs" : "items need"} a review. Bobo adds it to your plan.</div>}
    </Link>
  );
}

/** An open exercise: its stars so far, and NEW for a few days after it opens. */
function Tile({ m, n, lv, current }: { m: Ex; n: number; lv: Levels; current: boolean }) {
  const items = Object.values(lv.stars?.[m.key] ?? {});
  const knownN = items.filter((s) => s.stars >= 3).length;
  const accurate = items.filter((s) => s.stars >= 2).length;
  const r = routeFor(m.href.split("?")[0]);
  return (
    <Link href={m.href} className={"card tile group relative flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-accent md:p-5" + (current ? " border-accent/50" : "")}>
      {n <= 9 && <Kbd className="absolute right-4 top-4 !h-6 !min-w-6 text-xs max-md:!hidden">{n}</Kbd>}
      {m.isNew && <span className="absolute left-3 top-3 rounded-full bg-ok px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>}
      <span className="cjk grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-2xl text-accent transition group-hover:scale-110">{r.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold md:text-lg">{m.label}</div>
        <div className="line-clamp-2 text-xs text-muted md:text-sm">{EXERCISE_DESC[m.key] ?? r.desc}</div>
        {items.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <Stars n={knownN ? 3 : accurate ? 2 : 1} />
            <span className="tabular-nums">{knownN ? knownN + " known" : accurate ? accurate + " accurate" : items.length + " seen"}</span>
          </div>
        )}
      </div>
    </Link>
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

// Example sentences of the welcome card. The learner's facts fill the blanks; a missing fact shows as a dashed blank to fill.
const SAMPLES: (string | { key: string; blank: string })[][] = [
  ["My name is ", { key: "name", blank: "your name" }, ", and I live in ", { key: "lives_in", blank: "your city" }, "."],
  ["I work as ", { key: "job", blank: "your job" }, ", and I love ", { key: "food", blank: "your favorite food" }, "."],
  ["I come from ", { key: "hometown", blank: "your hometown" }, ", and I speak ", { key: "languages", blank: "your languages" }, "."],
];
const short = (v: string) => (v.length > 28 ? v.slice(0, 27).trimEnd() + "…" : v);

/** The first screen after the onboarding: a warm welcome, why the profile matters, and the way to complete it before the first plan. */
function WelcomeCard({ profile, building, error, onFill, onBuild }: {
  profile: Profile; building: boolean; error: string; onFill: () => void; onBuild: () => void;
}) {
  const gaps = missingFacts(profile);
  const total = PROFILE_KEYS.length, have = total - gaps.length;
  const name = (profile.name ?? "").trim().split(/\s+/)[0];
  const shown = gaps.slice(0, 6);
  return (
    <section className="card relative overflow-hidden border-accent/50 p-5 md:p-7 lg:col-span-2 lg:row-start-1">
      <div className="pointer-events-none absolute -bottom-14 left-[30%] select-none cjk text-[150px] leading-none text-accent opacity-[.05]">歡迎</div>
      <div className="relative grid gap-6 md:grid-cols-[1.3fr_1fr] md:gap-10">
        <div className="relative min-w-0">
          <BoboPose pose="welcome" className="float-right -mt-2 ml-3 w-24 sm:w-32 lg:w-36" priority />
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">Welcome to bopomofo</div>
          <h2 className="mt-2 text-2xl font-semibold leading-tight md:text-3xl">
            {name ? "Welcome, " + name + "!" : "Welcome!"} <span className="cjk text-accent">歡迎</span>
          </h2>
          <p className="mt-2 max-w-xl text-[15px] text-muted">
            I’m Bobo (波波), your coach. I write your practice sentences about your own life: your city, your work, the people you love.
            Tell me a little more about you, and I build your first plan around you.
          </p>
          <div className="mt-4 flex flex-col gap-1.5 rounded-xl bg-bg/60 p-3.5 text-[15px] leading-relaxed">
            <div className="text-xs text-muted">Soon you will say sentences like these in Mandarin:</div>
            {SAMPLES.map((parts, i) => (
              <div key={i}>
                {parts.map((x, j) => {
                  if (typeof x === "string") return <span key={j}>{x}</span>;
                  const v = (profile[x.key] ?? "").trim();
                  return v
                    ? <mark key={j} className="rounded bg-accent-soft px-1 text-accent">{short(v)}</mark>
                    : <Link key={j} href={"/profile?fact=" + x.key} className="rounded border border-dashed border-accent/60 px-1.5 text-accent hover:bg-accent-soft">{x.blank}</Link>;
                })}
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button onClick={onFill} className="btn btn-accent w-full justify-center !rounded-xl !px-5 !py-3.5 text-base font-semibold shadow-[0_4px_0_color-mix(in_srgb,var(--accent)_60%,#000)] active:translate-y-[3px] active:shadow-none sm:w-fit">
              Complete my profile <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
            <button onClick={onBuild} disabled={building} className="btn w-full justify-center !rounded-xl !px-4 !py-3 sm:w-fit">
              {building ? "Starting your plan…" : "Build my plan now"} <Kbd className="max-md:!hidden">B</Kbd>
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-3 md:border-l md:border-line md:pl-8">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">Your profile</span>
            <span className="text-sm tabular-nums text-muted">{have} of {total} facts</span>
          </div>
          <div className="flex gap-1" aria-hidden="true">
            {PROFILE_KEYS.map((k) => <span key={k} className={"h-2 flex-1 rounded-full " + (gaps.includes(k) ? "bg-line" : "bg-accent")} />)}
          </div>
          <p className="text-sm text-muted">Your first plan waits for these facts. It takes a few minutes, and you can change any fact later.</p>
          <div className="flex flex-wrap gap-1.5">
            {shown.map((k) => (
              <Link key={k} href={"/profile?fact=" + k} className="chip flex items-center gap-1 !border-dashed text-sm hover:!border-accent hover:text-accent">
                <span className="text-accent">+</span> {PROFILE_LABELS[k]}
              </Link>
            ))}
            {gaps.length > shown.length && <span className="self-center text-sm text-muted">and {gaps.length - shown.length} more</span>}
          </div>
          <p className="mt-auto text-xs text-muted">Nothing is invented about you: Bobo uses only the facts you write.</p>
        </div>
      </div>
    </section>
  );
}


/** Bobo's next step, first on Home: what to practice now and why. */
function CoachCard({ st }: { st: CoachState }) {
  const router = useRouter();
  const step = st.steps.find((s) => s.status === "open") ?? null;
  const ms = st.milestones.filter((m) => m.status === "active").slice(0, 3);
  return (
    <section className="card relative overflow-hidden border-accent/50 p-5 md:p-6 lg:col-span-2 lg:row-start-1">
      <VMark className="-right-6 -top-10 w-56" />
      <div className="relative grid gap-5 md:grid-cols-[1.4fr_1fr] md:gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted">
            <BoboFace size={28} /><span className="font-semibold uppercase tracking-wide text-accent">Bobo</span>
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
              <BoboPose pose="thinking" className="w-14" bob />
              Bobo is preparing your plan: {st.stage || "getting started"}…
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
