"use client";

import { TimezonePicker } from "@/components/settings/TimezonePicker";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { api, type Reason } from "@/lib/api";
import { setGoalMinutes } from "@/lib/session";
import { playSfx } from "@/lib/sfx";
import { deviceZone } from "@/lib/timezones";
import { useClerk, useUser } from "@clerk/nextjs";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Done } from "./Done";
import { MicScreen } from "./MicScreen";
import { Bars, Check, Option, Screen } from "./Options";
import { BOPOMOFO, GOALS, LEVELS, QUESTIONS, REASONS, STEPS, type Draft, type Mic, type Step } from "./questions";
import { Welcome } from "./Welcome";
import { ZoneCard } from "./ZoneCard";

const DRAFT_KEY = "zhuyin.onboarding";

const slide = {
  enter: (d: number) => ({ opacity: 0, x: 36 * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -36 * d }),
};

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
