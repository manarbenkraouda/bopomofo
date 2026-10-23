"use client";
// Numbers: hear a number and pick its digits (listen), or see a number and say it out loud (speak).
// Numbers are not Bopomofo, but a learner needs them every day: prices, times, phone numbers, dates.
// Each mode climbs a ladder of sizes (levels.number_bands in the backend): 0-10 first, then 11-99, the hundreds, the
// thousands, and 萬. A size opens when the size before it is known, so the place words come on top of known digits.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ttsUrl, type Health, type NumberRung, type SpeechResult } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, useFocus, type Focus } from "@/lib/focus";
import { ANSWER_KEYS, ANSWER_LETTERS, cycleKeys, useHotkeys, type Hotkey } from "@/lib/hotkeys";
import { useLevels } from "@/lib/levels";
import {
  band,
  BAND_LABEL,
  BAND_NAME,
  BANDS,
  choices,
  digits,
  errorOf,
  hanzi,
  ladderBand,
  NUMBER_ZHUYIN,
  randomBand,
  randomIn,
  type Band,
} from "@/lib/numbers";
import { playSfx } from "@/lib/sfx";
import { FIRST_TRY_ATTEMPTS, firstTry, firstTryResult } from "@/lib/attempts";
import { recordAttempt } from "@/lib/session";
import { now, since } from "@/lib/track";
import { holdHint, useHoldMic, type Clip } from "@/lib/useHoldMic";
import { PHONE, useViewport } from "@/lib/useFit";
import { PlayButton } from "@/components/PlayButton";
import { Burst, FxFrame, fxClass, StatusPill } from "@/components/quiz/Feedback";
import { PinyinCheck } from "@/components/quiz/PinyinCheck";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { CHECK_AFTER, soundMiss, type Check } from "@/components/speaking/cards";
import { ResultView } from "@/components/speaking/ResultView";

type Mode = "listen" | "speak";
const MODES: Mode[] = ["listen", "speak"];
const MODE_LABEL: Record<Mode, string> = { listen: "Listen", speak: "Speak" };
// The speech check passes a spoken answer from this score, the same as the backend (stats.log_number_speech).
const PASS = 80;
// A new number differs from the last RECENT numbers, so a small size (0 to 10) still goes through all its numbers.
const RECENT = 6;
// Listen: keep the answer hidden throughout the first-try allowance.
const LISTEN_MISSES = FIRST_TRY_ATTEMPTS;

/** The focus numbers and bands of the open sizes only: a link or a coach step can ask for a size that is still locked. */
function openFocus(focus: Focus, open: readonly Band[]) {
  const nums = focus.nums.filter((x) => open.includes(band(x)));
  const bands = focus.bands.filter((b) => open.includes(b));
  return { nums, bands, empty: focus.nums.length + focus.bands.length > 0 && !nums.length && !bands.length };
}

/** The next number: the size picked on the ladder, else the focus numbers, then the focus bands, else the ladder (mostly
 * the newest open size). Never one of the recent numbers, when another one is possible. */
function pick(focus: Focus, recent: readonly number[], open: readonly Band[], only: Band | null): number {
  const f = openFocus(focus, open);
  const fresh = (x: number) => !recent.includes(x);
  for (let i = 0; i < 40; i++) {
    const others = f.nums.filter(fresh);
    // With focus numbers, half of the questions still come from their sizes, so a short list does not loop.
    const n = only
      ? randomIn(only)
      : !f.nums.length && !f.bands.length
        ? randomIn(ladderBand(open))
        : others.length && Math.random() < 0.5
          ? others[Math.floor(Math.random() * others.length)]
          : randomIn(randomBand(f.bands.length ? f.bands : [...new Set(f.nums.map(band))]));
    if (fresh(n)) return n;
  }
  const last = recent[recent.length - 1];
  for (let i = 0; i < 20; i++) {
    const n = randomIn(only ?? ladderBand(open));
    if (n !== last) return n;
  }
  return randomIn(only ?? ladderBand(open));
}

/** The ladder of sizes: known sizes, the newest open size with its progress, and the locked ones. An open size can be
 * picked to practice it alone (B cycles). */
function Ladder({
  rungs,
  need,
  only,
  setOnly,
}: {
  rungs: NumberRung[];
  need: { tests: number; acc: number } | undefined;
  only: Band | null;
  setOnly: (b: Band | null) => void;
}) {
  const open = rungs.filter((r) => r.open);
  const newest = open[open.length - 1];
  const next = rungs[open.length];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Number sizes">
        {rungs.map((r) =>
          r.open ? (
            <button
              key={r.band}
              className="chip"
              data-active={only === r.band}
              onClick={() => setOnly(only === r.band ? null : r.band)}
              title={only === r.band ? "Back to every open size" : "Practice only " + BAND_NAME[r.band]}
            >
              {BAND_LABEL[r.band]}
              {r.known ? (
                <span className="text-ok"> ✓</span>
              ) : need && r === newest ? (
                <span className="text-muted tabular-nums">
                  {" "}
                  · {Math.min(r.tests, need.tests)}/{need.tests}
                  {r.acc !== null && r.tests ? " · " + r.acc + "%" : ""}
                </span>
              ) : null}
            </button>
          ) : (
            <span
              key={r.band}
              className="chip opacity-50"
              title={"Opens when you know " + BAND_NAME[open[open.length - 1]?.band ?? "0-10"]}
            >
              🔒 {BAND_LABEL[r.band]}
            </span>
          ),
        )}
      </div>
      {next && newest && need && (
        <div className="text-xs text-muted">
          {BAND_NAME[next.band][0].toUpperCase() + BAND_NAME[next.band].slice(1)} open when you get {need.acc}% right in{" "}
          {BAND_NAME[newest.band]}, over at least {need.tests} first tries.
        </div>
      )}
    </div>
  );
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
  const { open, known, lv } = useLevels();
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
  // The open sizes of this mode. Without the level path (it failed to load, or an older backend), every size is open.
  const rungs = lv?.numbers?.[mode] ?? null;
  const openBands: Band[] = rungs ? rungs.filter((r) => r.open).map((r) => r.band) : [...BANDS];
  const [only, setOnly] = useState<Band | null>(null);
  useEffect(() => setOnly(null), [mode]);
  const picked = only && openBands.includes(only) ? only : null;
  const sizeKeys: Hotkey[] = [
    {
      keys: ["KeyB"],
      label: "Size",
      run: () => {
        const all = [null, ...openBands];
        setOnly(all[(all.indexOf(picked) + 1) % all.length]);
      },
      when: openBands.length > 1,
    },
  ];
  const ladder = rungs ? (
    <Ladder rungs={rungs} need={lv?.rules.number_ladder?.["numbers/" + mode]} only={picked} setOnly={setOnly} />
  ) : null;
  const props = {
    chips,
    ladder,
    hotkeys: [...keys, ...sizeKeys],
    open: openBands,
    only: picked,
    ready: known,
  };
  return mode === "speak" ? <Speak {...props} /> : <Listen {...props} />;
}

type Q = { n: number; options: number[] };
type ModeProps = {
  chips: React.ReactNode;
  ladder: React.ReactNode;
  hotkeys: Hotkey[];
  open: Band[];
  only: Band | null;
  ready: boolean;
};

function Listen({ chips, ladder, hotkeys, open, only, ready }: ModeProps) {
  const focus = useFocus();
  const empty = openFocus(focus, open).empty;
  // Read at pick time: a size that opens after an answer is used from the next question on.
  const openRef = useRef(open);
  openRef.current = open;
  const [q, setQ] = useState<Q | null>(null);
  // The last pick (for its animation), the wrong picks of this number, and the end of the question (right, or shown).
  const [picked, setPicked] = useState<number | null>(null);
  const [wrong, setWrong] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const recent = useRef<number[]>([]);
  const attempt = useRef({ cardId: "", tries: 0, counted: false });

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    if (attempt.current.tries > 0 && !attempt.current.counted) {
      setScore((s) => ({ ...s, n: s.n + 1, streak: 0 }));
      recordAttempt("numbers", false);
    }
    attempt.current = { cardId: crypto.randomUUID(), tries: 0, counted: false };
    const n = pick(focus, recent.current, openRef.current, only);
    recent.current = [...recent.current, n].slice(-RECENT);
    setQ({ n, options: choices(n, openRef.current) });
    setPicked(null);
    setWrong([]);
    setDone(false);
    shownAt.current = now();
    replays.current = 0;
    playAudio(ttsUrl(hanzi(n)));
  }, [focus, only]);

  useEffect(() => {
    if (ready) next();
  }, [focus, only, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (advance.current) clearTimeout(advance.current);
    },
    [],
  );

  const choose = useCallback(
    (o: number) => {
      if (!q || done || wrong.includes(o)) return;
      if (advance.current) clearTimeout(advance.current);
      setPicked(o);
      const ok = o === q.n;
      const cur = attempt.current;
      const counted = cur.counted ? null : firstTryResult(ok, false, cur.tries);
      if (counted !== null) {
        cur.counted = true;
        setScore((s) => ({ n: s.n + 1, ok: s.ok + (counted ? 1 : 0), streak: counted ? s.streak + 1 : 0 }));
      }
      const error = errorOf(q.n, o);
      // Save the number picked, so the stats can show which numbers are heard instead (14 for 40, 205 for 250).
      api.event({
        area: "numbers",
        mode: "listen",
        item: String(q.n),
        ok,
        first_try: firstTry(ok, false, cur.tries),
        tries: cur.tries + 1,
        ms: since(shownAt.current),
        replays: replays.current,
        units: [
          {
            kind: "number",
            expected: String(q.n),
            actual: String(o),
            ok,
            try_n: cur.tries,
            ctx: band(q.n),
            extra: { hanzi: hanzi(q.n), error },
          },
        ],
        details: {
          attempt_card: cur.cardId,
          options: q.options,
          picked: o,
          hanzi: hanzi(q.n),
          focus: focus.active ? focus.label : undefined,
        },
      });
      cur.tries += 1;
      playSfx(ok ? "right" : "wrong");
      if (ok) {
        setDone(true);
        advance.current = setTimeout(next, 1000);
        return;
      }
      const misses = [...wrong, o];
      setWrong(misses);
      // A wrong pick keeps the answer hidden and plays the number again. After LISTEN_MISSES wrong picks, it shows.
      if (misses.length >= LISTEN_MISSES) setDone(true);
      else advance.current = setTimeout(() => playAudio(ttsUrl(hanzi(q.n))), 600);
    },
    [q, done, wrong, next, focus],
  );

  const replay = () => {
    if (!q) return;
    if (!wrong.length && picked === null) replays.current += 1;
    if (advance.current) clearTimeout(advance.current);
    playAudio(ttsUrl(hanzi(q.n)));
  };
  const showAnswer = () => {
    if (!q || done) return;
    if (advance.current) clearTimeout(advance.current);
    if (!attempt.current.counted) {
      attempt.current.counted = true;
      setScore((s) => ({ ...s, n: s.n + 1, streak: 0 }));
      recordAttempt("numbers", false);
    }
    setDone(true);
    playAudio(ttsUrl(hanzi(q.n)));
  };

  useHotkeys("numbers", [
    ...ANSWER_KEYS.map((keys, i) => ({
      keys,
      label: "Answer " + (i + 1),
      run: () => q && choose(q.options[i]),
      when: !!q && !done && i < q.options.length,
      bar: false,
    })),
    { keys: [], label: "Answer", show: ["1-4", "/", "A S D F"], when: !!q && !done },
    { keys: ["Space"], label: "Hear again", run: replay, when: !!q },
    { keys: ["KeyN"], label: "Show the answer", run: showAnswer, when: !!q && !done && wrong.length > 0 },
    { keys: ["Enter", "KeyN"], label: "Next", run: next, when: done },
    ...hotkeys,
  ]);

  const right = q !== null && done && picked === q.n;
  const status = done ? (right ? "right" : "wrong") : wrong.length ? "wrong" : "listening";
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex gap-2 items-center flex-wrap">
        {chips}
        <FocusChip focus={focus} empty={empty} />
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}%
          first try of {score.n}
        </div>
      </div>
      {ladder}
      {q && (
        <div
          className={
            "card stage border-2 p-8 flex flex-1 flex-col items-center justify-center gap-6 md:gap-7 transition-colors duration-300 " +
            (status === "listening" ? "border-line" : right ? "border-ok bg-ok/5" : "border-bad/60 bg-bad/5")
          }
        >
          <StatusPill
            status={status}
            label={
              done
                ? right
                  ? "Correct!"
                  : "Here is the answer"
                : wrong.length
                  ? "Not quite, listen again"
                  : "Listen, then choose"
            }
          />
          <PlayButton big src={ttsUrl(hanzi(q.n))} title="Play again (Space)" />
          <div className="text-muted">Which number do you hear?</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
            {q.options.map((o, i) => {
              const isRight = done && o === q.n;
              const isWrong = wrong.includes(o);
              return (
                <button
                  key={o}
                  onClick={() => choose(o)}
                  disabled={done || isWrong}
                  className={
                    "tile relative rounded-2xl border-2 px-4 pb-5 pt-9 text-center transition " +
                    (picked === o ? fxClass(o === q.n ? "right" : "wrong") : "") +
                    " " +
                    (isRight
                      ? "border-ok bg-ok/10"
                      : isWrong
                        ? "border-bad bg-bad/10 opacity-70"
                        : done
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
                  {done && (isRight || isWrong) && <div className="cjk text-sm text-muted mt-1">{hanzi(o)}</div>}
                </button>
              );
            })}
          </div>
          {done && (
            <div className="max-md:hidden">
              <Reading n={q.n} big />
            </div>
          )}
          {!done && wrong.length > 0 && (
            <button className="btn text-muted max-md:hidden" onClick={showAnswer}>
              Show the answer <Kbd>N</Kbd>
            </button>
          )}
          {(done || wrong.length > 0) && (
            <ActionBar
              mobileOnly
              tone={right ? "ok" : "bad"}
              title={done ? (right ? "Correct!" : "Here is the answer") : "Not quite, listen again"}
              detail={done ? <span className="cjk text-2xl">{digits(q.n) + " · " + hanzi(q.n)}</span> : undefined}
            >
              {done ? (
                <button
                  className={
                    "btn ab-primary " + (right ? "!bg-ok !border-ok !text-white" : "!bg-bad !border-bad !text-white")
                  }
                  onClick={next}
                >
                  Continue
                </button>
              ) : (
                <button className="btn" onClick={showAnswer}>
                  Show the answer
                </button>
              )}
            </ActionBar>
          )}
        </div>
      )}
    </div>
  );
}

function Speak({ chips, ladder, hotkeys, open, only, ready }: ModeProps) {
  const focus = useFocus();
  const empty = openFocus(focus, open).empty;
  const openRef = useRef(open);
  openRef.current = open;
  const phone = useViewport().w < PHONE;
  const [n, setN] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [helped, setHelped] = useState(false);
  const [tries, setTries] = useState(0);
  // The typed check fixed the sounds and the tones were right: the number counts as said.
  const [fixed, setFixed] = useState(false);
  const [typedCheck, setTypedCheck] = useState<Check>("none");
  const [typedNote, setTypedNote] = useState("");
  const [error, setError] = useState("");
  const [fxKey, setFxKey] = useState(0);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const recent = useRef<number[]>([]);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  // misses: recordings in a row without help that did not pass. sound: one of them had a sound heard wrong.
  const blank = {
    n: null as number | null,
    cardId: "",
    counted: false,
    helped: false,
    tries: 0,
    misses: 0,
    sound: false,
    eventIds: [] as number[],
  };
  const current = useRef(blank);

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
      if (advance.current) clearTimeout(advance.current);
    };
  }, []);

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    const prev = current.current;
    if (prev.tries > 0 && !prev.counted) {
      setScore((s) => ({ ...s, n: s.n + 1, streak: 0 }));
      recordAttempt("numbers", false);
    }
    const x = pick(focus, recent.current, openRef.current, only);
    recent.current = [...recent.current, x].slice(-RECENT);
    current.current = { ...blank, n: x, cardId: crypto.randomUUID(), eventIds: [] };
    setN(x);
    setResult(null);
    setHelped(false);
    setTries(0);
    setFixed(false);
    setTypedCheck("none");
    setTypedNote("");
    setError("");
  }, [focus, only]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ready) next();
  }, [focus, only, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const passed = fixed || (result !== null && result.score >= PASS);
  // The answer (the characters and their Bopomofo) shows only after a pass or help. A miss shows what went wrong.
  const shown = passed || helped;

  const onClip = useCallback(
    async (c: Clip) => {
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
          cardId: cur.cardId,
        });
        if (current.current.cardId !== cur.cardId) return;
        const ok = r.score >= PASS;
        const counted = cur.counted ? null : firstTryResult(ok, cur.helped, cur.tries);
        if (counted !== null) {
          setScore((s) => ({
            n: s.n + 1,
            ok: s.ok + (counted ? 1 : 0),
            streak: counted ? s.streak + 1 : 0,
          }));
          recordAttempt("numbers", counted);
        }
        const miss = !ok && !cur.helped;
        const after = {
          ...cur,
          tries: cur.tries + 1,
          counted: cur.counted || counted !== null,
          misses: miss ? cur.misses + 1 : cur.misses,
          sound: cur.sound || (miss && soundMiss(r)),
          eventIds: r.event_id ? [...cur.eventIds, r.event_id] : cur.eventIds,
        };
        current.current = after;
        setTries(after.tries);
        setResult(r);
        setFxKey((k) => k + 1);
        playSfx(ok ? "right" : r.score >= 60 ? "close" : "wrong");
        // After 3 misses in a row with a sound heard wrong, ask once what the learner said: the model can mix up close sounds.
        if (after.misses >= CHECK_AFTER && after.sound && !after.helped)
          setTypedCheck((s) => (s === "none" ? "open" : s));
        // A pass moves on by itself, like the other exercises. The result stays readable for a moment.
        if (ok) advance.current = setTimeout(next, 1800);
      } catch (e) {
        setError("The check failed: " + (e as Error).message);
      } finally {
        setChecking(false);
      }
    },
    [next],
  );

  const modelReady = health !== null && health !== "down" && health.speech_model === "ready";
  const hold = useHoldMic({
    active: modelReady,
    maxS: 10,
    onClip: (c) => void onClip(c),
    onDiscard: (why) => setError(holdHint(why, "R", phone)),
  });
  const canHold = modelReady && !checking && n !== null && !passed && typedCheck !== "open";

  // Hearing the number before the first pass counts as help, like "Hear the answer" in Reading.
  const cheat = () => {
    if (n === null) return;
    if (advance.current) clearTimeout(advance.current);
    if (!passed) {
      current.current = { ...current.current, helped: true };
      setHelped(true);
    }
    playAudio(ttsUrl(hanzi(n)));
  };
  const hear = (char: string) => playAudio(ttsUrl(char));

  /** The learner typed what they said. Same sounds: the sound misses count as right (the tones stay as checked).
   * Other sounds: a real mix-up, and the answer shows. */
  const checkTyped = async (typed: string): Promise<string | null> => {
    const cur = current.current;
    if (cur.n === null || !cur.eventIds.length) return null;
    const asked = cur.n;
    const r = await api.confirmSpeech(cur.eventIds, typed);
    if (current.current.n !== asked) return null;
    setTypedCheck("done");
    if (!r.match) {
      setTypedNote("You typed " + typed + ". This number is said " + hanzi(asked) + ". Listen, then try again.");
      cheat();
      return null;
    }
    const fixedSyl = (x: SpeechResult) => ({
      ...x,
      syllables: x.syllables.map((s) => ({ ...s, initial_ok: true, final_ok: true })),
    });
    const tonesOk = !!result && result.syllables.every((s) => s.heard && s.tone_ok);
    setResult((x) => x && fixedSyl(x));
    if (tonesOk) {
      setFixed(true);
      setTypedNote("Thanks! The microphone heard the sounds wrong, so this number counts as said right.");
      playSfx("right");
      setFxKey((k) => k + 1);
      advance.current = setTimeout(next, 2200);
    } else {
      setTypedNote(
        "Thanks! The sounds were right: the microphone heard them wrong. A tone still needs work: try again.",
      );
    }
    return null;
  };

  useHotkeys("numbers-speak", [
    {
      keys: ["KeyR"],
      label: "Hold to speak",
      run: () => void hold.press(),
      up: () => void hold.release(),
      when: canHold || hold.holding,
    },
    { keys: ["Space"], label: shown ? "Hear it again" : "Hear the answer", run: cheat, when: n !== null },
    { keys: ["Enter"], label: "Next", run: next, when: passed && !checking },
    { keys: ["KeyN"], label: "Skip", run: next, when: !passed && !checking && !hold.holding },
    ...hotkeys,
  ]);

  const status = hold.holding
    ? "hearing"
    : checking
      ? "checking"
      : passed
        ? "right"
        : result
          ? result.score >= 60
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
        <FocusChip focus={focus} empty={empty} />
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}%
          first try of {score.n}
        </div>
      </div>
      {ladder}

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
            {shown ? (
              <Reading n={n} big />
            ) : (
              <div className="text-muted">
                {result ? "Try again, or hear the answer." : "Say this number in Mandarin."}
              </div>
            )}
            {helped && !passed && <div className="text-xs text-muted">Heard first: this one counts as help.</div>}
          </div>

          {typedNote && (
            <div className="text-sm text-center max-w-md cjk text-muted" role="status">
              {typedNote}
            </div>
          )}
          {typedCheck === "open" && !checking && !hold.holding && (
            <PinyinCheck
              example="ㄕˊ ㄙˋ or shi si"
              intro="The microphone can mix up close sounds, like s and sh, especially with a blocked nose. Type the sounds you said in Bopomofo or Pinyin, one syllable per character, with a space between them."
              label="The sounds you said, in Bopomofo or Pinyin"
              maxLength={120}
              check={checkTyped}
              onClose={() => setTypedCheck("closed")}
            />
          )}

          {result && (
            <div className="w-full max-w-2xl">
              <ResultView result={result} onHear={hear} hide={!shown} />
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
              {shown ? "Hear it again" : "Hear the answer"} <Kbd>Space</Kbd>
            </button>
            {typedCheck === "closed" && !shown && (
              <button
                className="btn"
                onClick={() => setTypedCheck("open")}
                title="The microphone can mix up close sounds"
              >
                Type what you said
              </button>
            )}
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
