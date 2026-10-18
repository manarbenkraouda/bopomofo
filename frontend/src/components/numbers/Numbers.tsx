"use client";
// Numbers: hear a number and pick its digits (listen), or see a number and say it out loud (speak).
// Numbers are not Bopomofo, but a learner needs them every day: prices, times, phone numbers, dates.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ttsUrl, type Health, type SpeechResult } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, useFocus, type Focus } from "@/lib/focus";
import { ANSWER_KEYS, ANSWER_LETTERS, cycleKeys, useHotkeys, type Hotkey } from "@/lib/hotkeys";
import { useLevels } from "@/lib/levels";
import { band, choices, digits, errorOf, hanzi, NUMBER_ZHUYIN, randomBand, randomIn } from "@/lib/numbers";
import { playSfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { holdHint, useHoldMic, type Clip } from "@/lib/useHoldMic";
import { PHONE, useViewport } from "@/lib/useFit";
import { PlayButton } from "@/components/PlayButton";
import { Burst, FxFrame, fxClass, StatusPill } from "@/components/quiz/Feedback";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { ResultView } from "@/components/speaking/ResultView";

type Mode = "listen" | "speak";
const MODES: Mode[] = ["listen", "speak"];
const MODE_LABEL: Record<Mode, string> = { listen: "Listen", speak: "Speak" };
// The speech check passes a spoken answer from this score, the same as the backend (stats.log_number_speech).
const PASS = 80;

/** The next number: from the focus numbers first, then from the focus bands, then from any band. Never the same twice in a row. */
function pick(focus: Focus, last: number | null): number {
  for (let i = 0; i < 20; i++) {
    const others = focus.nums.filter((x) => x !== last);
    // With focus numbers, some questions still come from their bands, so a short list does not loop.
    const n =
      others.length && (!focus.bands.length || Math.random() < 0.7)
        ? others[Math.floor(Math.random() * others.length)]
        : randomIn(randomBand(focus.bands.length ? focus.bands : [...new Set(focus.nums.map(band))]));
    if (n !== last) return n;
  }
  return randomIn(randomBand());
}

/** The characters of a number with their written Bopomofo. */
function Reading({ n, big }: { n: number; big?: boolean }) {
  return (
    <div className={"cjk flex flex-wrap justify-center gap-x-2 gap-y-1 " + (big ? "text-4xl" : "text-2xl")}>
      {[...hanzi(n)].map((c, i) => (
        <span key={i} className="flex flex-col items-center leading-tight">
          <span>{c}</span>
          <span className="text-accent text-xs tracking-wider">{NUMBER_ZHUYIN[c]}</span>
        </span>
      ))}
    </div>
  );
}

export function Numbers() {
  const modeParam = useSearchParams().get("mode");
  const [mode, setMode] = useState<Mode>(() => (modeParam === "speak" ? "speak" : "listen"));
  useEffect(() => {
    if ((MODES as string[]).includes(modeParam ?? "")) setMode(modeParam as Mode);
  }, [modeParam]);
  // Only the modes of the learner's level: a locked mode (also from a link) falls back to the first open one.
  const { open, known } = useLevels();
  const modes = MODES.filter((m) => open("numbers/" + m));
  const openKey = modes.join(",");
  useEffect(() => {
    if (known && modes.length && !modes.includes(mode)) setMode(modes[0]);
  }, [known, openKey, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const chips =
    modes.length > 1
      ? modes.map((m) => (
          <button key={m} className="chip" data-active={mode === m} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))
      : null;
  const keys = cycleKeys("Mode", modes.length ? modes : MODES, mode, setMode, modes.length > 1);
  return mode === "speak" ? <Speak chips={chips} hotkeys={keys} /> : <Listen chips={chips} hotkeys={keys} />;
}

type Q = { n: number; options: number[] };

function Listen({ chips, hotkeys }: { chips: React.ReactNode; hotkeys: Hotkey[] }) {
  const focus = useFocus();
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const last = useRef<number | null>(null);

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    const n = pick(focus, last.current);
    last.current = n;
    setQ({ n, options: choices(n) });
    setPicked(null);
    shownAt.current = now();
    replays.current = 0;
    playAudio(ttsUrl(hanzi(n)));
  }, [focus]);

  useEffect(() => {
    next();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (advance.current) clearTimeout(advance.current);
    },
    [],
  );

  const choose = useCallback(
    (o: number) => {
      if (!q || picked !== null) return;
      setPicked(o);
      const ok = o === q.n;
      const error = errorOf(q.n, o);
      setScore((s) => ({ n: s.n + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
      // Save the number picked, so the stats can show which numbers are heard instead (14 for 40, 205 for 250).
      api.event({
        area: "numbers",
        mode: "listen",
        item: String(q.n),
        ok,
        first_try: ok,
        ms: since(shownAt.current),
        replays: replays.current,
        units: [
          {
            kind: "number",
            expected: String(q.n),
            actual: String(o),
            ok,
            ctx: band(q.n),
            extra: { hanzi: hanzi(q.n), error },
          },
        ],
        details: {
          options: q.options,
          picked: o,
          hanzi: hanzi(q.n),
          focus: focus.active ? focus.label : undefined,
        },
      });
      playSfx(ok ? "right" : "wrong");
      // Move on by itself: after 1 s when right, after 2.5 s when wrong (time to read the number and hear it again).
      advance.current = setTimeout(next, ok ? 1000 : 2500);
    },
    [q, picked, next, focus],
  );

  const replay = () => {
    if (!q) return;
    if (picked === null) replays.current += 1;
    else if (advance.current) clearTimeout(advance.current);
    playAudio(ttsUrl(hanzi(q.n)));
  };

  useHotkeys("numbers", [
    ...ANSWER_KEYS.map((keys, i) => ({
      keys,
      label: "Answer " + (i + 1),
      run: () => q && choose(q.options[i]),
      when: !!q && picked === null && i < q.options.length,
      bar: false,
    })),
    { keys: [], label: "Answer", show: ["1-4", "/", "A S D F"], when: !!q && picked === null },
    { keys: ["Space"], label: "Hear again", run: replay, when: !!q },
    { keys: ["Enter", "KeyN"], label: "Next", run: next, when: picked !== null },
    ...hotkeys,
  ]);

  const right = q !== null && picked === q.n;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex gap-2 items-center flex-wrap">
        {chips}
        <FocusChip focus={focus} />
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}% of{" "}
          {score.n}
        </div>
      </div>
      {q && (
        <div
          className={
            "card stage border-2 p-8 flex flex-1 flex-col items-center justify-center gap-6 md:gap-7 transition-colors duration-300 " +
            (picked === null ? "border-line" : right ? "border-ok bg-ok/5" : "border-bad/60 bg-bad/5")
          }
        >
          <StatusPill
            status={picked === null ? "listening" : right ? "right" : "wrong"}
            label={picked === null ? "Listen, then choose" : right ? "Correct!" : "Not quite"}
          />
          <PlayButton big src={ttsUrl(hanzi(q.n))} title="Play again (Space)" />
          <div className="text-muted">Which number do you hear?</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
            {q.options.map((o, i) => {
              const isRight = picked !== null && o === q.n;
              const isWrong = picked === o && o !== q.n;
              return (
                <button
                  key={o}
                  onClick={() => choose(o)}
                  className={
                    "tile relative rounded-2xl border-2 px-4 pb-5 pt-9 text-center transition " +
                    (picked === o ? fxClass(isRight ? "right" : "wrong") : "") +
                    " " +
                    (isRight
                      ? "border-ok bg-ok/10"
                      : isWrong
                        ? "border-bad bg-bad/10"
                        : picked !== null
                          ? "border-line bg-card opacity-60"
                          : "border-line bg-card hover:border-accent hover:-translate-y-0.5")
                  }
                >
                  {isRight && picked === o && <Burst count={12} distance={90} />}
                  <span className="absolute left-3 top-3 flex gap-1">
                    <Kbd>{i + 1}</Kbd>
                    <Kbd>{ANSWER_LETTERS[i]}</Kbd>
                  </span>
                  <div className="text-3xl md:text-4xl font-semibold tabular-nums break-all">{digits(o)}</div>
                  {picked !== null && (isRight || isWrong) && (
                    <div className="cjk text-sm text-muted mt-1">{hanzi(o)}</div>
                  )}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className="max-md:hidden">
              <Reading n={q.n} big />
            </div>
          )}
          {picked !== null && (
            <ActionBar
              mobileOnly
              tone={right ? "ok" : "bad"}
              title={right ? "Correct!" : "Not quite"}
              detail={<span className="cjk text-2xl">{digits(q.n) + " · " + hanzi(q.n)}</span>}
            >
              <button
                className={
                  "btn ab-primary " + (right ? "!bg-ok !border-ok !text-white" : "!bg-bad !border-bad !text-white")
                }
                onClick={next}
              >
                Continue
              </button>
            </ActionBar>
          )}
        </div>
      )}
    </div>
  );
}

function Speak({ chips, hotkeys }: { chips: React.ReactNode; hotkeys: Hotkey[] }) {
  const focus = useFocus();
  const phone = useViewport().w < PHONE;
  const [n, setN] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [helped, setHelped] = useState(false);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState("");
  const [fxKey, setFxKey] = useState(0);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const last = useRef<number | null>(null);
  const current = useRef({ n: null as number | null, helped: false, tries: 0 });

  useEffect(() => {
    let stop = false;
    const poll = () =>
      api
        .health()
        .then((h) => {
          if (stop) return;
          setHealth(h);
          if (h.speech_model === "loading") setTimeout(poll, 2000);
        })
        .catch(() => !stop && setHealth("down"));
    poll();
    return () => {
      stop = true;
    };
  }, []);

  const next = useCallback(() => {
    const x = pick(focus, last.current);
    last.current = x;
    current.current = { n: x, helped: false, tries: 0 };
    setN(x);
    setResult(null);
    setHelped(false);
    setTries(0);
    setError("");
  }, [focus]);
  useEffect(() => {
    next();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const passed = result !== null && result.score >= PASS;

  const onClip = useCallback(async (c: Clip) => {
    const cur = current.current;
    if (cur.n === null) return;
    const asked = cur.n;
    setChecking(true);
    setError("");
    try {
      const r = await api.speech(c.wav, hanzi(asked), "numbers", {
        help: cur.helped,
        tryN: cur.tries,
        number: asked,
      });
      if (current.current.n !== asked) return;
      const ok = r.score >= PASS;
      // The score counts the first try of each number only, like the stats.
      if (cur.tries === 0)
        setScore((s) => ({
          n: s.n + 1,
          ok: s.ok + (ok && !cur.helped ? 1 : 0),
          streak: ok && !cur.helped ? s.streak + 1 : 0,
        }));
      current.current = { ...cur, tries: cur.tries + 1 };
      setTries(cur.tries + 1);
      setResult(r);
      setFxKey((k) => k + 1);
      playSfx(ok ? "right" : r.score >= 60 ? "close" : "wrong");
    } catch (e) {
      setError("The check failed: " + (e as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);

  const modelReady = health !== null && health !== "down" && health.speech_model === "ready";
  const hold = useHoldMic({
    active: modelReady,
    maxS: 10,
    onClip: (c) => void onClip(c),
    onDiscard: (why) => setError(holdHint(why, "R", phone)),
  });
  const canHold = modelReady && !checking && n !== null;

  // Hearing the number before the first pass counts as help, like "Hear the answer" in Reading.
  const cheat = () => {
    if (n === null) return;
    if (!passed) {
      current.current = { ...current.current, helped: true };
      setHelped(true);
    }
    playAudio(ttsUrl(hanzi(n)));
  };
  const hear = (char: string) => playAudio(ttsUrl(char));

  useHotkeys("numbers-speak", [
    {
      keys: ["KeyR"],
      label: "Hold to speak",
      run: () => void hold.press(),
      up: () => void hold.release(),
      when: canHold || hold.holding,
    },
    { keys: ["Space"], label: helped || passed ? "Hear it again" : "Hear the answer", run: cheat, when: n !== null },
    { keys: ["Enter"], label: "Next", run: next, when: passed && !checking },
    { keys: ["KeyN"], label: "Skip", run: next, when: !checking && !hold.holding },
    ...hotkeys,
  ]);

  const status = hold.holding
    ? "hearing"
    : checking
      ? "checking"
      : result
        ? passed
          ? "right"
          : result.score >= 60
            ? "close"
            : "wrong"
        : modelReady
          ? "listening"
          : "idle";
  const border =
    status === "right"
      ? "border-ok bg-ok/5"
      : status === "wrong"
        ? "border-bad/60 bg-bad/5"
        : status === "close"
          ? "border-rough/70"
          : status === "hearing"
            ? "border-accent/50"
            : "border-line";
  const label =
    status === "hearing"
      ? "Speak, then let go"
      : status === "right"
        ? "Correct!"
        : status === "close" || status === "wrong"
          ? "Not quite, try again"
          : status === "listening"
            ? phone
              ? "Hold the button and say it"
              : "Hold R and say it"
            : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex gap-2 items-center flex-wrap">
        {chips}
        <FocusChip focus={focus} />
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}%
          first try of {score.n}
        </div>
      </div>

      {health === "down" && (
        <div className="card p-3 text-sm text-bad">Can&apos;t connect right now. Please try again in a moment.</div>
      )}
      {health && health !== "down" && health.speech_model !== "ready" && (
        <div className="card p-3 text-sm text-rough">
          {health.speech_model === "loading"
            ? "The speech check is getting ready (a few seconds)…"
            : "The speech check is not available right now. Please try again later."}
        </div>
      )}

      {n !== null && (
        <div
          className={
            "card stage border-2 p-8 flex flex-1 flex-col items-center justify-center gap-5 transition-colors duration-300 " +
            border
          }
        >
          <StatusPill status={status} label={label} />
          <FxFrame status={status} level={hold.level} attempt={fxKey}>
            <div
              className={
                "font-semibold tabular-nums leading-none select-none px-6 text-center break-all " +
                (String(n).length > 5 ? "text-[clamp(56px,11vw,128px)]" : "text-[clamp(80px,18vh,200px)]") +
                (status === "right" ? " text-ok" : "")
              }
              aria-label={"Say this number: " + n}
            >
              {digits(n)}
            </div>
          </FxFrame>
          <div className="min-h-16 flex flex-col items-center justify-center text-center gap-1">
            {helped || result ? <Reading n={n} big /> : <div className="text-muted">Say this number in Mandarin.</div>}
            {helped && !passed && <div className="text-xs text-muted">Heard first: this one counts as help.</div>}
          </div>

          {result && (
            <div className="w-full max-w-2xl">
              <ResultView result={result} onHear={hear} />
            </div>
          )}

          <ActionBar
            tone={status === "right" ? "ok" : status === "close" ? "close" : status === "wrong" ? "bad" : null}
          >
            {hold.holding && (
              <div className="w-28 h-1.5 rounded bg-line overflow-hidden max-md:!hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: Math.round(hold.level * 100) + "%" }}
                />
              </div>
            )}
            {passed ? (
              <button className="btn ab-primary !bg-ok !border-ok !text-white" onClick={next}>
                Next <Kbd>Enter</Kbd>
              </button>
            ) : (
              <button
                {...hold.bind}
                disabled={!canHold && !hold.holding}
                aria-label="Hold to speak"
                className={
                  "btn ab-primary !rounded-full !px-6 !py-3 text-base " +
                  (hold.holding ? "btn-accent recording" : "btn-primary")
                }
              >
                {hold.holding ? (
                  "● Recording… let go to check"
                ) : checking ? (
                  "Checking…"
                ) : hold.state === "opening" ? (
                  "Starting the mic…"
                ) : (
                  <>
                    ● Hold to speak <Kbd>R</Kbd>
                  </>
                )}
              </button>
            )}
            <button className="btn" onClick={cheat}>
              {helped || passed ? "Hear it again" : "Hear the answer"} <Kbd>Space</Kbd>
            </button>
            {!passed && (
              <button className="btn text-muted" onClick={next} disabled={checking} title="Another number">
                {tries ? "Next number" : "Skip"} <Kbd>N</Kbd>
              </button>
            )}
          </ActionBar>
          {(error || hold.error) && <div className="text-bad text-sm">{error || hold.error}</div>}
        </div>
      )}
    </div>
  );
}
