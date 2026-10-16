"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Placement as Content,
  type PlacementResult,
  type PlacementVoice,
  type TextItem,
  type Unit,
} from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { answerText, normalizePinyin, symbolOfPinyin } from "@/lib/pinyin";
import { playSfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { holdHint, useHoldMic, type Clip } from "@/lib/useHoldMic";
import { PHONE, useViewport } from "@/lib/useFit";
import { ActionBar, type Tone } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { ZhuyinText } from "@/components/ZhuyinText";
import { Burst } from "@/components/quiz/Feedback";
import { BoboPose } from "@/components/mascot/Bobo";

/**
 * The placement test, once, after the onboarding of a learner who speaks everyday Mandarin or more (backend/app/placement.py).
 * 1. The alphabet (only for learners who know some Bopomofo): each of the 37 symbols, type its pinyin. One try each.
 * 2. The voice: say 42 syllables (every symbol and tone), then 12 sentences. One recording each; the speech check scores sounds and tones.
 * About 10 minutes. A reload resumes where the learner stopped.
 * Every answer is saved as a normal Recognize or Speaking answer. At the end the server scores the answers and opens levels.
 * Keyboard: Enter checks and continues, Space records and stops (and is "I don't know" in the alphabet), → skips a card.
 */

type Part = "loading" | "intro" | "alphabet" | "voice" | "saving" | "result";
type Draft = { part: Part; order: string; i: number; vi: number; alphaIds: number[]; voiceIds: number[]; ts?: number };
// The test in progress, kept on the device: closing the tab and coming back resumes it. The server counts answers of the last
// 6 hours only (placement.MAX_AGE), so an older draft starts again.
const DRAFT_KEY = "zhuyin.placement";
const DRAFT_MAX_MS = 5 * 3600 * 1000;
const MAX_SECONDS = { syllable: 5, sentence: 10 } as const;

const shuffle = (s: string) => {
  const a = [...s];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join("");
};
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

type Card = { text: string; english?: string; items: TextItem[]; mode: "syllable" | "sentence" };

export function Placement() {
  const router = useRouter();
  const [content, setContent] = useState<Content | null>(null);
  const [d, setD] = useState<Draft>({ part: "loading", order: "", i: 0, vi: 0, alphaIds: [], voiceIds: [] });
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<Promise<unknown>[]>([]);
  // The saved answers of the test (event ids). A ref: finish() must see ids saved after the last render.
  const ids = useRef({ alphaIds: [] as number[], voiceIds: [] as number[] });
  const addId = (k: "alphaIds" | "voiceIds", id: number) => {
    if (ids.current[k].includes(id)) return;
    ids.current = { ...ids.current, [k]: [...ids.current[k], id] };
    setD((x) => ({ ...x, ...ids.current }));
  };

  // Load the test. A done test shows its result; a learner without a due test goes home. A reload resumes the draft.
  useEffect(() => {
    api
      .placement()
      .then((c) => {
        setContent(c);
        if (c.status === "done" && c.result) {
          setResult(c.result);
          setD((x) => ({ ...x, part: "result" }));
          return;
        }
        if (c.status !== "due") {
          router.replace("/");
          return;
        }
        try {
          const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as Draft | null;
          if (
            saved &&
            ["alphabet", "voice"].includes(saved.part) &&
            saved.order.length === c.symbols.length &&
            Date.now() - (saved.ts ?? 0) < DRAFT_MAX_MS
          ) {
            ids.current = { alphaIds: saved.alphaIds, voiceIds: saved.voiceIds };
            setD(saved);
            return;
          }
        } catch {}
        setD({ part: "intro", order: shuffle(c.symbols), i: 0, vi: 0, alphaIds: [], voiceIds: [] });
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);
  useEffect(() => {
    if (d.part === "alphabet" || d.part === "voice")
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, ts: d.ts ?? Date.now() }));
  }, [d]);

  const cards: Card[] = content
    ? [
        ...content.syllables.map((s) => ({ ...s, mode: "syllable" as const })),
        ...content.sentences.map((s) => ({ ...s, mode: "sentence" as const })),
      ]
    : [];

  const finish = useCallback(async (voiceSkipped: boolean, none = false) => {
    setD((x) => ({ ...x, part: "saving" }));
    setError("");
    await Promise.allSettled(pending.current);
    const use = none ? { alphaIds: [], voiceIds: [] } : ids.current;
    try {
      const r = await api.placementFinish({
        alphabet_ids: use.alphaIds,
        voice_ids: use.voiceIds,
        voice_skipped: voiceSkipped,
      });
      setResult(r.result);
      playSfx("right");
    } catch (e) {
      // Already done (another tab): show the saved result.
      const c = await api.placement().catch(() => null);
      if (c?.result) setResult(c.result);
      else {
        setError((e as Error).message);
        setD((x) => ({ ...x, part: "voice" }));
        return;
      }
    }
    localStorage.removeItem(DRAFT_KEY);
    setD((x) => ({ ...x, part: "result" }));
  }, []);

  // ts: when the test started. The draft is dropped once the first answers are too old for the server.
  const start = () => {
    playSfx("tick");
    setD((x) => ({ ...x, part: content?.alphabet ? "alphabet" : "voice", ts: Date.now() }));
  };
  const skipAll = () => void finish(true, true);

  // The intro and the result screens: Enter is the main button.
  useHotkeys("placement", [
    { keys: ["Enter", "NumpadEnter"], label: "Start the test", run: start, when: d.part === "intro" && !!content },
    {
      keys: ["Enter", "NumpadEnter"],
      label: "Start learning",
      run: () => router.replace("/"),
      when: d.part === "result",
    },
  ]);

  const total = (content?.alphabet ? d.order.length : 0) + cards.length;
  const doneCount =
    d.part === "alphabet"
      ? d.i
      : d.part === "voice"
        ? (content?.alphabet ? d.order.length : 0) + d.vi
        : d.part === "result" || d.part === "saving"
          ? total
          : 0;
  const first = content?.alphabet ? 1 : 0; // part numbers: the alphabet part comes first when there is one
  const partLabel =
    d.part === "alphabet"
      ? "Part 1 · Symbols"
      : cards[d.vi]?.mode === "sentence"
        ? "Part " + (first + 2) + " · Sentences"
        : "Part " + (first + 1) + " · Sounds";

  return (
    <div className="flex h-full flex-col">
      <header className="pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-3 md:h-16 md:px-6">
          {d.part === "alphabet" || d.part === "voice" ? (
            <>
              <span className="w-28 shrink-0 text-xs font-semibold text-muted">{partLabel}</span>
              <div
                className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={doneCount}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-500"
                  style={{ width: (100 * doneCount) / Math.max(1, total) + "%" }}
                />
              </div>
              <span className="w-12 text-right text-xs font-semibold tabular-nums text-muted">
                {doneCount}/{total}
              </span>
            </>
          ) : (
            <span className="h-10" />
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-5 pb-[calc(var(--ab-space,0px)+1.25rem)] pt-2 md:pt-6">
          {d.part === "loading" && <div className="m-auto text-muted">{error || "Loading…"}</div>}
          {d.part === "intro" && content && (
            <Intro
              alphabet={content.alphabet}
              syllables={content.syllables.length}
              sentences={content.sentences.length}
            />
          )}
          {d.part === "alphabet" && (
            <Alphabet
              key={d.i}
              sym={d.order[d.i]}
              onAnswer={(p) => {
                pending.current.push(
                  p.then((id) => {
                    if (id) addId("alphaIds", id);
                  }),
                );
              }}
              onNext={() =>
                setD((x) => (x.i + 1 >= x.order.length ? { ...x, i: x.i + 1, part: "voice" } : { ...x, i: x.i + 1 }))
              }
            />
          )}
          {d.part === "voice" && cards[d.vi] && (
            <Voice
              key={d.vi}
              card={cards[d.vi]}
              last={d.vi + 1 >= cards.length}
              onAnswer={(id) => addId("voiceIds", id)}
              onNext={() => {
                if (d.vi + 1 >= cards.length) void finish(false);
                else setD((x) => ({ ...x, vi: x.vi + 1 }));
              }}
              onSkipVoice={() => void finish(true)}
              error={error}
            />
          )}
          {d.part === "saving" && (
            <div className="m-auto flex flex-col items-center gap-3 text-center">
              <BoboPose pose="thinking" className="w-36" />
              <p className="text-muted">Bobo is reading your answers…</p>
            </div>
          )}
          {d.part === "result" && result && <Result r={result} />}
        </div>
      </main>
      {(d.part === "intro" || d.part === "result") && (
        <div className="mx-auto w-full max-w-lg px-5 md:pb-8 md:pt-4">
          <ActionBar>
            {d.part === "intro" && (
              <button className="btn justify-center md:flex-1 md:!py-3" onClick={skipAll}>
                Skip, start from level 1
              </button>
            )}
            <button
              className="btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"
              onClick={d.part === "intro" ? start : () => router.replace("/")}
            >
              {d.part === "intro" ? "Start the test" : "Start learning"}
              <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          </ActionBar>
        </div>
      )}
    </div>
  );
}

function Intro({ alphabet, syllables, sentences }: { alphabet: boolean; syllables: number; sentences: number }) {
  const parts: [string, string, string][] = [
    ...(alphabet
      ? [
          ["ㄅ", "The symbols", "See each of the 37 symbols and type its sound in pinyin. One try each."] as [
            string,
            string,
            string,
          ],
        ]
      : []),
    [
      "音",
      "Sounds",
      "Say " +
        syllables +
        " syllables: every Bopomofo sound and all four tones. Bobo checks each initial, final, and tone.",
    ],
    [
      "說",
      "Sentences",
      "Say " + sentences + " short sentences, with the neutral tone and the tone changes of 3-3, 不, and 一.",
    ],
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <BoboPose pose="investigate" className="zq-pop w-40 md:w-48" priority />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold md:text-3xl">Let&apos;s find your level</h1>
        <p className="mx-auto max-w-sm text-muted">
          You already speak Mandarin. Show me what you know, and you skip the parts you don&apos;t need. About 10
          minutes: find a quiet place.
        </p>
      </div>
      <div className="card w-full divide-y divide-line overflow-hidden text-left">
        {parts.map(([icon, label, sub], n) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3">
            <span className="cjk grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg text-accent">
              {icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                Part {n + 1}: {label}
              </span>
              <span className="block text-sm text-muted">{sub}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted">
        No pressure: a wrong answer only means you practice it first. You can stop and come back: the test waits where
        you left it.
      </p>
    </div>
  );
}

/** One symbol: type its pinyin, one try. Space (or the button) says "I don't know". */
function Alphabet({
  sym,
  onAnswer,
  onNext,
}: {
  sym: string;
  onAnswer: (p: Promise<number | undefined>) => void;
  onNext: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState("");
  const [fb, setFb] = useState<null | { ok: boolean; typed: string }>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = useRef(now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = (ok: boolean, actual: string, text: string) => {
    const units: Unit[] = [
      { kind: "symbol", expected: sym, actual, ok, try_n: 0, help: false, ...(text ? { extra: { typed: text } } : {}) },
    ];
    onAnswer(
      api
        .event({
          area: "recognize",
          item: sym,
          ok,
          first_try: ok,
          ms: since(shown.current),
          tries: 1,
          help: false,
          units,
          details: { placement: true, skipped: !text || undefined },
        })
        .then((r) => r.id),
    );
    setFb({ ok, typed: text });
    playSfx(ok ? "right" : "wrong");
    timer.current = setTimeout(onNext, ok ? 700 : 1600);
  };
  const check = () => {
    if (fb) {
      if (timer.current) clearTimeout(timer.current);
      onNext();
      return;
    }
    const text = normalizePinyin(typed);
    if (!text) return;
    const s = symbolOfPinyin(text);
    if (!s) {
      setHint("“" + text + "” is not the sound of one symbol. Type one sound, like b, zh, or ang.");
      return;
    }
    save(s === sym, s, text);
  };
  const dontKnow = () => {
    if (!fb) save(false, "∅", "");
  };

  useHotkeys("placement-alphabet", [
    { keys: ["Enter", "NumpadEnter"], label: fb ? "Next" : "Check", run: check, input: true },
    { keys: ["Space"], label: "I don't know", run: dontKnow, when: !fb, input: true },
  ]);

  const color = fb ? (fb.ok ? "text-ok" : "text-bad") : "";
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-2"
      onClick={() => input.current?.focus({ preventScroll: true })}
    >
      <div
        className={"cjk select-none text-[clamp(88px,18dvh,200px)] leading-none transition-colors " + color}
        aria-label={"Type the pinyin of this symbol: " + sym}
      >
        {sym}
      </div>
      <div className="flex min-h-7 items-center text-center" aria-live="polite">
        {fb ? (
          fb.ok ? (
            <span className="cjk text-lg font-semibold text-ok">
              ✓ {sym} = {answerText(sym)}
            </span>
          ) : (
            <span className="cjk font-medium text-bad">
              {fb.typed ? "“" + fb.typed + "” is not it: " : ""}
              {sym} = {answerText(sym)}
            </span>
          )
        ) : (
          <span className="text-muted">Which sound is it? Type it in pinyin.</span>
        )}
      </div>
      <form
        className="flex w-full max-w-sm items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <input
          ref={input}
          value={typed}
          onChange={(e) => {
            if (!fb) {
              setTyped(e.target.value.slice(0, 12));
              setHint("");
            }
          }}
          type="text"
          inputMode="text"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={fb ? "next" : "go"}
          aria-label="Pinyin of the symbol"
          placeholder={fb ? "" : "pinyin"}
          className={
            "min-w-0 flex-1 rounded-2xl border-2 bg-card px-4 py-2 text-center font-mono text-3xl tracking-wider outline-none transition placeholder:text-base placeholder:tracking-normal placeholder:text-muted/60 focus:border-accent " +
            (fb ? (fb.ok ? "border-ok text-ok" : "border-bad/60") : "border-line")
          }
        />
        <button
          type="submit"
          onMouseDown={keepFocus}
          className={"btn shrink-0 !rounded-2xl !px-5 text-base font-semibold " + (fb ? "btn-accent" : "btn-primary")}
        >
          {fb ? "Next" : "Check"} <Kbd className="max-md:!hidden">Enter</Kbd>
        </button>
      </form>
      {!fb && (
        <button type="button" className="btn text-muted" onMouseDown={keepFocus} onClick={dontKnow}>
          I don&apos;t know <Kbd className="max-md:!hidden">Space</Kbd>
        </button>
      )}
      <div className="min-h-5 text-center text-sm text-rough">
        {hint || <span className="text-muted">Type v for ü and eh for ê.</span>}
      </div>
    </div>
  );
}

type Rec = "idle" | "recording" | "checking" | "done";

/** One voice card: record once, see a short result, go on. A failed recording (silent, too short) can be recorded again. */
function Voice({
  card,
  last,
  onAnswer,
  onNext,
  onSkipVoice,
  error: outer,
}: {
  card: Card;
  last: boolean;
  error: string;
  onAnswer: (id: number) => void;
  onNext: () => void;
  onSkipVoice: () => void;
}) {
  const [step, setStep] = useState<"idle" | "checking" | "done">("idle");
  const [error, setError] = useState(outer);
  const [score, setScore] = useState<number | null>(null);
  const [marks, setMarks] = useState<(string | undefined)[]>([]);
  const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const phone = useViewport().w < PHONE;

  const onClip = useCallback(
    async ({ wav }: Clip) => {
      setStep("checking");
      try {
        const res = await api.speech(wav, card.text, card.mode, { tryN: 0 });
        if (res.event_id) onAnswer(res.event_id);
        setScore(res.score);
        setMarks(
          res.syllables.map((s) =>
            s.tone_ok && s.initial_ok !== false && s.final_ok !== false ? "var(--ok)" : "var(--bad)",
          ),
        );
        playSfx(res.score >= 80 ? "right" : res.score >= 60 ? "close" : "wrong");
        setStep("done");
      } catch (e) {
        setError((e as Error).message);
        setStep("idle");
      }
    },
    [card, onAnswer],
  );

  // Press and hold to record: the microphone stays open between cards, and each recording keeps half a second from
  // before the press, so the first consonant is not cut.
  const hold = useHoldMic({
    active: canRecord,
    maxS: MAX_SECONDS[card.mode],
    onClip: (c) => void onClip(c),
    onDiscard: (why) => setError(holdHint(why, "Space", phone)),
  });
  const rec: Rec = step !== "idle" ? step : hold.holding ? "recording" : "idle";
  const level = hold.level;
  useEffect(() => {
    if (hold.error) setError("The microphone is not available. Allow it in the browser, or skip the voice part.");
  }, [hold.error]);
  const press = () => {
    if (step !== "idle") return;
    setError("");
    void hold.press();
  };
  const release = () => void hold.release();

  const next = () => onNext();
  const skip = () => {
    if (rec === "idle") onNext();
  };

  useHotkeys("placement-voice", [
    {
      keys: ["Space", "KeyR"],
      label: "Hold to record",
      run: press,
      up: release,
      when: rec === "idle" || rec === "recording",
    },
    { keys: ["Enter", "NumpadEnter"], label: last ? "See my level" : "Next", run: next, when: rec === "done" },
    { keys: ["ArrowRight"], label: "Skip this one", run: skip, when: rec === "idle" },
  ]);

  const tone: Tone =
    rec !== "done" || score === null ? (error ? "bad" : null) : score >= 80 ? "ok" : score >= 60 ? "close" : "bad";
  const verdict = score === null ? "" : score >= 80 ? "Clear!" : score >= 60 ? "Almost" : "Not quite";
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-2 text-center">
        <p className="text-sm font-semibold text-muted">
          {card.mode === "syllable" ? "Say this sound" : "Say this sentence"}
        </p>
        <div className="card flex w-full flex-col items-center gap-2 px-4 py-6">
          <ZhuyinText
            items={card.items}
            size={card.mode === "syllable" ? 72 : 40}
            marks={rec === "done" ? marks : undefined}
            className="justify-center"
          />
          {card.english && <p className="text-sm text-muted">{card.english}</p>}
        </div>
        <button
          type="button"
          {...hold.bind}
          onPointerDown={(e) => {
            if (e.button === 0) setError("");
            hold.bind.onPointerDown(e);
          }}
          disabled={!canRecord || rec === "checking" || rec === "done"}
          aria-label="Hold to record"
          className={
            "cjk relative grid h-24 w-24 place-items-center rounded-full text-4xl text-white shadow-xl transition " +
            (rec === "recording"
              ? "recording bg-bad"
              : rec === "done"
                ? score !== null && score >= 80
                  ? "zq-pop bg-ok"
                  : "bg-rough"
                : "bg-accent") +
            (rec === "checking" ? " opacity-60" : "")
          }
          style={
            rec === "recording"
              ? { boxShadow: "0 0 0 " + Math.round(level * 18) + "px rgba(239,68,68,.25)" }
              : undefined
          }
        >
          {rec === "done" ? (score !== null && score >= 80 ? "✓" : "・") : rec === "checking" ? "…" : "說"}
          {rec === "done" && score !== null && score >= 80 && <Burst count={10} distance={90} />}
        </button>
        <div className="min-h-12 text-sm" aria-live="polite">
          {rec === "idle" && !error && (
            <span className="text-muted">
              {phone ? (
                "Hold the button"
              ) : (
                <>
                  Hold <Kbd>Space</Kbd> or the button
                </>
              )}
              , say it, then let go.
            </span>
          )}
          {rec === "recording" && <span className="font-medium text-bad">Recording… let go when you are done.</span>}
          {rec === "checking" && <span className="text-muted">Bobo is listening…</span>}
          {rec === "done" && (
            <span
              className={
                "text-base font-semibold " + (tone === "ok" ? "text-ok" : tone === "close" ? "text-rough" : "text-bad")
              }
            >
              {verdict} {score}/100
            </span>
          )}
          {error && rec === "idle" && <span className="text-bad">{error}</span>}
          {!canRecord && <span className="text-rough">This browser cannot record. You can skip the voice part.</span>}
        </div>
      </div>
      <div className="mx-auto w-full max-w-lg md:pb-8 md:pt-4">
        <ActionBar
          tone={tone}
          title={rec === "done" ? verdict + " " + score + "/100" : error ? "Try again" : undefined}
          detail={rec !== "done" && error ? error : undefined}
        >
          {rec !== "done" && (
            <button className="btn justify-center md:flex-1 md:!py-3" onClick={onSkipVoice} disabled={rec !== "idle"}>
              Skip the voice part
            </button>
          )}
          {rec === "idle" && (
            <button className="btn justify-center md:flex-1 md:!py-3" onClick={skip}>
              Skip this one<Kbd className="max-md:!hidden">→</Kbd>
            </button>
          )}
          {rec === "done" ? (
            <button
              className="btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"
              onClick={next}
            >
              {last ? "See my level" : "Next"}
              <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          ) : (
            <button
              className="btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"
              {...hold.bind}
              onPointerDown={(e) => {
                if (e.button === 0) setError("");
                hold.bind.onPointerDown(e);
              }}
              disabled={!canRecord || rec === "checking"}
            >
              {rec === "recording" ? "Recording… let go" : rec === "checking" ? "Checking…" : "Hold to record"}
              <Kbd className="max-md:!hidden">Space</Kbd>
            </button>
          )}
        </ActionBar>
      </div>
    </>
  );
}

function VoiceRow({ label, v, tones }: { label: string; v: PlacementVoice; tones: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="ml-auto text-right font-medium">
        {v.cards ? (
          <>
            {v.symbols.length} of 37 sounds · {v.tones.length} of {tones} tones
          </>
        ) : (
          "Not recorded"
        )}
      </span>
    </div>
  );
}

function Result({ r }: { r: PlacementResult }) {
  const missed = [...new Set([...r.syllables.missed, ...r.sentences.missed])];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <div className="relative inline-flex items-center justify-center">
        <BoboPose pose="celebrate" className="zq-pop w-40 md:w-48" priority />
        <Burst />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">You start at level {r.level}</p>
        <h1 className="text-2xl font-bold md:text-3xl">{r.title}</h1>
        <p className="mx-auto max-w-sm text-muted">
          {r.level > 1
            ? "The levels you showed are open now. I’m writing your first plan from your answers."
            : r.chapters
              ? "Every symbol chapter is open. We start with the symbols you missed, then move up fast."
              : "We start with the symbols, step by step. Each level opens as soon as you show it."}
        </p>
      </div>
      <div className="card w-full divide-y divide-line overflow-hidden text-left">
        {r.alphabet && (
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="shrink-0 text-sm text-muted">Symbols</span>
            <span className="ml-auto font-medium">
              {r.alphabet.right} of {r.alphabet.of} right
            </span>
          </div>
        )}
        {r.voice_skipped && !r.syllables.cards && !r.sentences.cards ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="text-sm text-muted">Voice</span>
            <span className="ml-auto font-medium">Skipped. Speaking opens with your level.</span>
          </div>
        ) : (
          <>
            <VoiceRow label="Syllables" v={r.syllables} tones={4} />
            <VoiceRow label="Sentences" v={r.sentences} tones={5} />
          </>
        )}
      </div>
      {missed.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted">Sounds to practice first</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {missed.slice(0, 16).map((m) => (
              <span key={m} className="chip cjk">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
