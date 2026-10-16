"use client";
import { useClerk, useUser } from "@clerk/nextjs";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type BopomofoLevel, type Level, type Reason } from "@/lib/api";
import { setGoalMinutes } from "@/lib/session";
import { playSfx } from "@/lib/sfx";
import { deviceZone, offsetLabel, timeIn, zoneLabel } from "@/lib/timezones";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { Burst } from "@/components/quiz/Feedback";
import { TimezonePicker } from "@/components/settings/TimezonePicker";
import { BoboPose } from "@/components/mascot/Bobo";

/**
 * The onboarding after sign-up: one question per screen, a progress bar, Back, and a fixed Continue bar on a phone.
 * The answers go to the profile (the sentence writer and the coach read them) and to the settings (time zone, goal).
 * Keyboard: Enter continues, Esc goes back, 1-6 pick an answer.
 */

const STEPS = ["welcome", "name", "why", "level", "bopomofo", "goal", "timezone", "mic", "done"] as const;
type Step = (typeof STEPS)[number];
const QUESTIONS = STEPS.length - 2; // welcome and done are not questions

type Draft = {
  name: string;
  reasons: Reason[];
  level: Level | null;
  bopomofo: BopomofoLevel | null;
  goal: number | null;
  timezone: string;
};
const DRAFT_KEY = "zhuyin.onboarding";

const REASONS: { id: Reason; icon: string; label: string; sub: string }[] = [
  { id: "travel", icon: "旅", label: "Travel in Taiwan", sub: "Order food, ask the way, meet people" },
  { id: "family", icon: "家", label: "Family and friends", sub: "Talk with the people you love" },
  { id: "live", icon: "住", label: "Live in Taiwan", sub: "Now, or soon" },
  { id: "work", icon: "工", label: "Work or studies", sub: "Colleagues, classes, exams" },
  { id: "culture", icon: "劇", label: "Shows, music, and games", sub: "Enjoy them in Mandarin" },
  { id: "fun", icon: "腦", label: "For fun", sub: "Keep my mind sharp" },
];
const LEVELS: { id: Level; bars: number; label: string; sub: string }[] = [
  { id: "new", bars: 1, label: "I'm new to Mandarin", sub: "Start from the first sound" },
  { id: "words", bars: 2, label: "I know some common words", sub: "你好, 謝謝, 我是…" },
  { id: "everyday", bars: 3, label: "I can talk about everyday topics", sub: "Food, work, plans, the weather" },
  { id: "fluent", bars: 4, label: "I can talk about most topics", sub: "I want to read and sound right" },
];
const BOPOMOFO: { id: BopomofoLevel; icon: string; label: string; sub: string }[] = [
  { id: "none", icon: "？", label: "Not yet", sub: "Start with ㄅ ㄆ ㄇ ㄈ" },
  { id: "some", icon: "ㄅㄆ", label: "I know some symbols", sub: "I can read a few of them" },
  { id: "reads", icon: "ㄅㄆㄇ", label: "I can read it", sub: "Take me to the practice" },
];
const GOALS: { min: number; label: string; icon: string }[] = [
  { min: 10, label: "Casual", icon: "🌱" },
  { min: 15, label: "Regular", icon: "🔥" },
  { min: 20, label: "Serious", icon: "⚡" },
  { min: 30, label: "Intense", icon: "🏆" },
];

const slide = {
  enter: (d: number) => ({ opacity: 0, x: 36 * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -36 * d }),
};

type Mic = "idle" | "asking" | "granted" | "denied" | "unsupported" | "skipped";

export function Onboarding() {
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [step, setStep] = useState<Step>("welcome");
  const [dir, setDir] = useState(1);
  const [d, setD] = useState<Draft>({
    name: "",
    reasons: [],
    level: null,
    bopomofo: null,
    goal: null,
    timezone: "UTC",
  });
  const [picking, setPicking] = useState(false);
  const [mic, setMic] = useState<Mic>("idle");
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState(false); // the placement test comes next (everyday and fluent levels)
  const [error, setError] = useState("");
  const restored = useRef(false);
  const i = STEPS.indexOf(step);

  // Restore a draft (a reload in the middle), and leave at once when the onboarding is already done.
  useEffect(() => {
    let draft: (Draft & { step?: Step }) | null = null;
    try {
      draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {}
    if (draft) {
      setD({
        name: draft.name ?? "",
        reasons: draft.reasons ?? [],
        level: draft.level ?? null,
        bopomofo: draft.bopomofo ?? null,
        goal: draft.goal ?? null,
        timezone: draft.timezone || deviceZone(),
      });
      if (draft.step && draft.step !== "done" && STEPS.includes(draft.step)) setStep(draft.step);
    } else {
      setD((x) => ({ ...x, timezone: deviceZone() }));
    }
    restored.current = true;
    api
      .me()
      .then((m) => {
        if (m.onboarded) {
          router.replace(m.placement === "due" ? "/placement" : "/");
          return;
        }
        setD((x) => ({ ...x, name: x.name || m.name, timezone: m.timezone_set ? m.timezone : x.timezone }));
      })
      .catch(() => {});
    if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) setMic("unsupported");
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => setMic((m) => (p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : m)))
      .catch(() => {});
  }, [router]);
  useEffect(() => {
    if (!d.name && user?.firstName) setD((x) => (x.name ? x : { ...x, name: user.firstName ?? "" }));
  }, [user, d.name]);
  useEffect(() => {
    if (restored.current && step !== "done") sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, step }));
  }, [d, step]);

  const go = (to: Step) => {
    setDir(STEPS.indexOf(to) >= i ? 1 : -1);
    setError("");
    setPicking(false);
    setStep(to);
  };
  const next = () => go(STEPS[Math.min(i + 1, STEPS.length - 1)]);
  const back = () => {
    if (picking) setPicking(false);
    else if (i > 0 && step !== "done") go(STEPS[i - 1]);
  };
  const pick = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    playSfx("tick");
    setD((x) => ({ ...x, [k]: v }));
  };
  const toggleReason = (r: Reason) => {
    playSfx("tick");
    setD((x) => ({ ...x, reasons: x.reasons.includes(r) ? x.reasons.filter((y) => y !== r) : [...x.reasons, r] }));
  };

  async function finish() {
    if (!d.level || !d.bopomofo || !d.goal || !d.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const me = await api.onboard({
        name: d.name.trim(),
        reasons: d.reasons,
        level: d.level,
        bopomofo: d.bopomofo,
        goal_min: d.goal,
        timezone: d.timezone,
      });
      setTest(me.placement === "due");
      setGoalMinutes(d.goal);
      sessionStorage.removeItem(DRAFT_KEY);
      playSfx("right");
      go("done");
    } catch (e) {
      playSfx("wrong");
      setError((e as Error).message);
    }
    setSaving(false);
  }

  function askMic() {
    setMic("asking");
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        s.getTracks().forEach((t) => t.stop());
        setMic("granted");
        playSfx("right");
      })
      .catch(() => setMic("denied"));
  }

  // The main button of each screen.
  const primary: { label: string; ok: boolean; run: () => void } = {
    welcome: { label: "Get started", ok: true, run: next },
    name: { label: "Continue", ok: !!d.name.trim(), run: next },
    why: { label: d.reasons.length ? "Continue" : "Skip", ok: true, run: next },
    level: { label: "Continue", ok: !!d.level, run: next },
    bopomofo: { label: "Continue", ok: !!d.bopomofo, run: next },
    goal: { label: "Continue", ok: !!d.goal, run: next },
    timezone: { label: "Continue", ok: !!d.timezone, run: next },
    mic:
      mic === "idle" || mic === "asking"
        ? { label: mic === "asking" ? "Waiting for the browser…" : "Allow microphone", ok: mic === "idle", run: askMic }
        : { label: saving ? "Saving…" : "Finish", ok: !saving, run: finish },
    done: test
      ? { label: "Take the placement test", ok: true, run: () => router.replace("/placement") }
      : { label: "Start learning", ok: true, run: () => router.replace("/") },
  }[step];

  // Number keys pick an answer on the screens with a list.
  const options: (() => void)[] =
    step === "why"
      ? REASONS.map((r) => () => toggleReason(r.id))
      : step === "level"
        ? LEVELS.map((l) => () => pick("level", l.id))
        : step === "bopomofo"
          ? BOPOMOFO.map((b) => () => pick("bopomofo", b.id))
          : step === "goal"
            ? GOALS.map((g) => () => pick("goal", g.min))
            : [];
  const keys = useRef({ primary, options, back });
  keys.current = { primary, options, back };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return; // a focused button clicks itself
      const k = keys.current;
      if (e.key === "Enter" && !e.repeat) {
        e.preventDefault();
        if (k.primary.ok) k.primary.run();
      } else if (e.key === "Escape") {
        e.preventDefault();
        k.back();
      } else if (!typing && /^[1-9]$/.test(e.key)) k.options[Number(e.key) - 1]?.();
    };
    // After a tap or a click, the button lets go of the focus, so Enter continues instead of pressing it again.
    const drop = () =>
      setTimeout(() => {
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      }, 0);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", drop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", drop);
    };
  }, []);

  const question = i > 0 && step !== "done";
  const secondary =
    step === "mic" && (mic === "idle" || mic === "asking")
      ? {
          label: "Not now",
          run: () => {
            setMic("skipped");
            finish();
          },
        }
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <header className="pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-3 md:h-16 md:px-6">
            {question ? (
              <>
                <button className="icon-btn !h-10 !w-10 text-xl" onClick={back} aria-label="Back" title="Back (Esc)">
                  ←
                </button>
                <div
                  className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={QUESTIONS}
                  aria-valuenow={i}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-500"
                    style={{ width: (100 * i) / QUESTIONS + "%" }}
                  />
                  <div
                    className="absolute left-2 top-[3px] h-1 rounded-full bg-white/25 transition-all duration-500"
                    style={{ width: "calc(" + (100 * i) / QUESTIONS + "% - 1rem)" }}
                  />
                </div>
                <span className="w-10 text-right text-xs font-semibold tabular-nums text-muted">
                  {i}/{QUESTIONS}
                </span>
              </>
            ) : (
              <span className="h-10" />
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-5 pb-[calc(var(--ab-space,0px)+1.25rem)] pt-2 md:pt-6">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={step}
                custom={dir}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }}
                className="flex flex-1 flex-col"
              >
                {step === "welcome" && (
                  <Welcome
                    email={user?.primaryEmailAddress?.emailAddress}
                    onSignOut={() => signOut({ redirectUrl: "/sign-in" })}
                  />
                )}

                {step === "name" && (
                  <Screen
                    icon="名"
                    title="What should we call you?"
                    sub="Your sentences are about your own life, in the first person."
                  >
                    <input
                      autoFocus
                      className="input w-full !rounded-2xl !py-3.5 text-lg"
                      placeholder="Your first name"
                      maxLength={40}
                      value={d.name}
                      autoComplete="given-name"
                      aria-label="Your first name"
                      onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))}
                    />
                    <p className="px-1 text-sm text-muted">
                      You can add more facts later in your profile: your job, your city, your hobbies.
                    </p>
                  </Screen>
                )}

                {step === "why" && (
                  <Screen
                    icon="心"
                    title="Why are you learning Mandarin?"
                    sub="Pick all that apply. Your sentences and plans follow them."
                  >
                    {REASONS.map((r, n) => (
                      <Option
                        key={r.id}
                        n={n + 1}
                        multi
                        selected={d.reasons.includes(r.id)}
                        onClick={() => toggleReason(r.id)}
                        icon={<span className="cjk text-lg">{r.icon}</span>}
                        label={r.label}
                        sub={r.sub}
                      />
                    ))}
                  </Screen>
                )}

                {step === "level" && (
                  <Screen
                    icon="級"
                    title="How much Mandarin do you know?"
                    sub="Your first sentences match your level. You can change it any time."
                  >
                    {LEVELS.map((l, n) => (
                      <Option
                        key={l.id}
                        n={n + 1}
                        selected={d.level === l.id}
                        onClick={() => pick("level", l.id)}
                        icon={<Bars n={l.bars} on={d.level === l.id} />}
                        label={l.label}
                        sub={l.sub}
                      />
                    ))}
                  </Screen>
                )}

                {step === "bopomofo" && (
                  <Screen
                    icon="ㄅ"
                    title="Do you know Bopomofo?"
                    sub="注音, the alphabet of Taiwan: 37 symbols and 5 tones."
                  >
                    {BOPOMOFO.map((b, n) => (
                      <Option
                        key={b.id}
                        n={n + 1}
                        selected={d.bopomofo === b.id}
                        onClick={() => pick("bopomofo", b.id)}
                        icon={<span className="cjk text-[15px] tracking-tighter">{b.icon}</span>}
                        label={b.label}
                        sub={b.sub}
                      />
                    ))}
                  </Screen>
                )}

                {step === "goal" && (
                  <Screen
                    icon="時"
                    title="Pick a daily goal"
                    sub="Minutes of active practice. The clock stops when you take a break."
                  >
                    <div className="card divide-y divide-line overflow-hidden">
                      {GOALS.map((g, n) => {
                        const on = d.goal === g.min;
                        return (
                          <button
                            key={g.min}
                            onClick={() => pick("goal", g.min)}
                            aria-pressed={on}
                            className={
                              "flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors " +
                              (on ? "bg-accent-soft/50" : "hover:bg-raise")
                            }
                          >
                            <span className="text-xl" aria-hidden>
                              {g.icon}
                            </span>
                            <span className={"flex-1 font-semibold " + (on ? "text-accent" : "")}>{g.label}</span>
                            <span className="tabular-nums text-muted">{g.min} min a day</span>
                            <Kbd className="max-md:!hidden">{n + 1}</Kbd>
                            <Check on={on} />
                          </button>
                        );
                      })}
                    </div>
                    <p className="px-1 text-sm text-muted">You can change it any time in Settings.</p>
                  </Screen>
                )}

                {step === "timezone" && (
                  <Screen
                    icon="地"
                    title="Where do you practice?"
                    sub="Your day starts at midnight in this time zone. Your streak and your daily goal follow it."
                  >
                    {picking ? (
                      <TimezonePicker
                        value={d.timezone}
                        onPick={(z) => {
                          pick("timezone", z);
                          setPicking(false);
                        }}
                      />
                    ) : (
                      <ZoneCard zone={d.timezone} onChange={() => setPicking(true)} />
                    )}
                  </Screen>
                )}

                {step === "mic" && <MicScreen mic={mic} />}

                {step === "done" && <Done d={d} mic={mic} test={test} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <div className="mx-auto w-full max-w-lg px-5 md:pb-8 md:pt-4">
          <ActionBar tone={error ? "bad" : null} title={error ? "Not saved" : undefined} detail={error || undefined}>
            {error && <p className="hidden w-full text-center text-sm text-bad md:block">{error}</p>}
            {secondary && (
              <button className="btn justify-center md:flex-1 md:!py-3" onClick={secondary.run} disabled={saving}>
                {secondary.label}
              </button>
            )}
            <button
              className={"btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"}
              onClick={primary.run}
              disabled={!primary.ok}
            >
              {primary.label}
              <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          </ActionBar>
        </div>
      </div>
    </MotionConfig>
  );
}

/** A question: the app's icon tile speaks it in a bubble, the answers come below. */
function Screen({
  icon,
  title,
  sub,
  children,
}: {
  icon: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="cjk grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent text-2xl text-white shadow-lg md:h-14 md:w-14 md:text-3xl">
          {icon}
        </span>
        <div className="card relative min-w-0 flex-1 px-4 py-3">
          <span
            aria-hidden
            className="absolute -left-[7px] top-4 h-3 w-3 rotate-45 border-b border-l border-line bg-card"
          />
          <h1 className="text-lg font-semibold leading-snug md:text-xl">{title}</h1>
          <p className="mt-0.5 text-sm text-muted">{sub}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function Option({
  n,
  selected,
  onClick,
  icon,
  label,
  sub,
  multi,
}: {
  n: number;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  multi?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={
        "tile flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition md:p-3.5 " +
        (selected
          ? "border-accent bg-accent-soft/40"
          : "border-line bg-card hover:-translate-y-0.5 hover:border-accent/60")
      }
    >
      <span
        className={
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors " +
          (selected ? "bg-accent text-white" : "bg-accent-soft text-accent")
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{label}</span>
        {sub && <span className="block text-sm text-muted">{sub}</span>}
      </span>
      <Kbd className="max-md:!hidden">{n}</Kbd>
      <Check on={selected} square={multi} />
    </button>
  );
}

function Check({ on, square }: { on: boolean; square?: boolean }) {
  return (
    <span
      className={
        (square ? "rounded-md" : "rounded-full") +
        " grid h-6 w-6 shrink-0 place-items-center border-2 text-xs font-bold transition-colors " +
        (on ? "zq-pop border-accent bg-accent text-white" : "border-line")
      }
    >
      {on ? "✓" : ""}
    </span>
  );
}

function Bars({ n, on }: { n: number; on: boolean }) {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className="w-[5px] rounded-sm"
          style={{
            height: 5 + b * 4,
            background: b <= n ? (on ? "#fff" : "var(--accent)") : on ? "rgba(255,255,255,.35)" : "var(--line)",
          }}
        />
      ))}
    </span>
  );
}

const FLOAT = [
  { s: "ㄅ", x: "-9.5rem", y: "-3.5rem", d: 0 },
  { s: "ㄆ", x: "7.5rem", y: "-5rem", d: 0.4 },
  { s: "ㄇ", x: "-7rem", y: "4.5rem", d: 0.8 },
  { s: "ㄈ", x: "8.5rem", y: "3rem", d: 1.2 },
  { s: "ˇ", x: "-2rem", y: "-7rem", d: 0.6 },
  { s: "ˋ", x: "3rem", y: "6.5rem", d: 1 },
];

function Welcome({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <div className="relative grid h-56 w-full place-items-center [@media(max-height:760px)]:h-44">
        {FLOAT.map((f) => (
          <motion.span
            key={f.s}
            aria-hidden
            className="cjk absolute text-3xl text-accent/70"
            style={{ left: "calc(50% + " + f.x + ")", top: "calc(50% + " + f.y + ")" }}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.2, delay: f.d, repeat: Infinity, ease: "easeInOut" }}
          >
            {f.s}
          </motion.span>
        ))}
        <BoboPose
          pose="welcome"
          className="zq-pop [&_img]:h-56 [&_img]:w-auto [@media(max-height:760px)]:[&_img]:h-44"
          priority
        />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold leading-tight md:text-4xl">
          Learn Mandarin
          <br />
          the Taiwan way
        </h1>
        <p className="mx-auto max-w-sm text-muted">
          Read, hear, write, and say Bopomofo, with a check of every syllable and every tone.
        </p>
      </div>
      <div className="grid w-full max-w-sm grid-cols-4 gap-2">
        {[
          ["讀", "Read"],
          ["聽", "Hear"],
          ["寫", "Write"],
          ["說", "Speak"],
        ].map(([c, l]) => (
          <div key={l} className="card flex flex-col items-center gap-1 py-3">
            <span className="cjk text-xl text-accent">{c}</span>
            <span className="text-xs font-semibold text-muted">{l}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Seven quick questions, about a minute.
        {email && (
          <>
            {" "}
            Signed in as {email}.{" "}
            <button className="font-semibold text-accent hover:underline" onClick={onSignOut}>
              Not you?
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/** The chosen zone with its clock now, and the time left before the next day starts there. */
function ZoneCard({ zone, onChange }: { zone: string; onChange: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const { city, region } = zoneLabel(zone);
  const time = timeIn(zone, now);
  const [h, m] = time.split(":").map(Number);
  const left = 24 * 60 - (h * 60 + m);
  return (
    <div className="card relative overflow-hidden p-5">
      <span
        aria-hidden
        className="cjk pointer-events-none absolute -bottom-8 -right-2 select-none text-[150px] leading-none text-accent opacity-[.07]"
      >
        地
      </span>
      <div className="relative">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent">
          {zone === deviceZone() ? "Found on this device" : "Your time zone"}
        </div>
        <div className="mt-1 truncate text-3xl font-semibold">{city}</div>
        <div className="truncate text-muted">{region}</div>
        <div className="mt-4 flex items-end gap-3">
          <span className="text-5xl font-semibold tabular-nums">{time}</span>
          <span className="pb-1.5 font-medium text-muted">{offsetLabel(zone, now)}</span>
        </div>
        {Number.isFinite(left) && (
          <div className="mt-1 text-sm text-muted">
            A new day starts here in {Math.floor(left / 60)} h {String(left % 60).padStart(2, "0")} min.
          </div>
        )}
        <button className="btn mt-4" onClick={onChange}>
          Change time zone
        </button>
      </div>
    </div>
  );
}

function MicScreen({ mic }: { mic: Mic }) {
  const ok = mic === "granted";
  const text = ok
    ? "The microphone is ready."
    : mic === "denied"
      ? "The browser blocks the microphone. You can allow it later in the site settings, when you start Speaking."
      : mic === "unsupported"
        ? "This browser cannot record. Speaking and Reading need Chrome, Edge, Safari, or Firefox."
        : "Your browser asks for the microphone next. The app uses it only while you record.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
      <div className="relative inline-flex items-center justify-center">
        <span
          key={mic}
          className={
            "cjk grid h-32 w-32 place-items-center rounded-full text-6xl text-white shadow-2xl transition-colors " +
            (ok ? "zq-pop bg-ok" : "bg-accent " + (mic === "idle" ? "recording" : ""))
          }
        >
          {ok ? "✓" : "說"}
        </span>
        {ok && <Burst count={12} distance={110} />}
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold md:text-3xl">Let the app hear you</h1>
        <p className="mx-auto max-w-sm text-muted">
          Speaking and Reading check every syllable you say: the initial, the final, and the tone.
        </p>
      </div>
      <p
        className={
          "rounded-full px-4 py-1.5 text-sm font-medium " +
          (ok
            ? "bg-ok/15 text-ok"
            : mic === "denied" || mic === "unsupported"
              ? "bg-rough/15 text-rough"
              : "bg-raise text-muted")
        }
      >
        {text}
      </p>
    </div>
  );
}

function Done({ d, mic, test }: { d: Draft; mic: Mic; test: boolean }) {
  const zone = zoneLabel(d.timezone);
  const rows: [string, string, string][] = [
    ["時", "Daily goal", (d.goal ?? 0) + " min a day"],
    ["地", "Time zone", zone.city + " · " + offsetLabel(d.timezone)],
    ["級", "Level", LEVELS.find((l) => l.id === d.level)?.label ?? ""],
    [
      "ㄅ",
      "Start with",
      d.bopomofo === "reads" ? "Practice" : d.bopomofo === "some" ? "A symbol review" : "The symbols, from ㄅ",
    ],
    ["說", "Microphone", mic === "granted" ? "Ready" : "Asked when you record"],
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <div className="relative inline-flex items-center justify-center">
        <BoboPose pose="celebrate" className="zq-pop w-44 md:w-52" priority />
        <Burst />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold md:text-3xl">You&apos;re all set, {d.name.trim()}!</h1>
        <p className="mx-auto max-w-sm text-muted">
          {test
            ? "I’m Bobo (波波), your coach. You already speak Mandarin, so let’s find your level first: a test of the symbols and your voice, about 10 minutes."
            : "I’m Bobo (波波), your coach. I’m writing your first plan from your answers. It is ready in about a minute."}
        </p>
      </div>
      <div className="card w-full divide-y divide-line overflow-hidden text-left">
        {rows.map(([icon, label, value]) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3">
            <span className="cjk grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm text-accent">
              {icon}
            </span>
            <span className="shrink-0 text-sm text-muted">{label}</span>
            <span className="ml-auto min-w-0 text-right font-medium leading-snug">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
