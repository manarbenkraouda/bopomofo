"use client";
// Characters: see a traditional character or word, and pick its meaning among 4.
// The words come from the course deck and from the learner's own sentences; the wrong choices are look-alikes first.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ttsUrl } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import {
  allWords,
  choices,
  lookalikesOf,
  pickWord,
  sentenceWords,
  type CharData,
  type CharWord,
} from "@/lib/characters";
import { FocusChip, useFocus } from "@/lib/focus";
import { ANSWER_KEYS, ANSWER_LETTERS, useHotkeys } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { PlayButton } from "@/components/PlayButton";
import { Burst, fxClass, StatusPill } from "@/components/quiz/Feedback";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";

type Q = { word: CharWord; options: CharWord[] };

export function Characters() {
  const focus = useFocus();
  const [data, setData] = useState<CharData | null>(null);
  const [words, setWords] = useState<CharWord[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<CharWord | null>(null);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const last = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    fetch("/data/characters.json")
      .then((r) => r.json() as Promise<CharData>)
      .then(async (d) => {
        // The sentences are optional: without them (offline, no sentences yet), the course words still work.
        const mine = await api
          .sentences()
          .then((r) => sentenceWords(r.sentences))
          .catch(() => []);
        if (stop) return;
        setData(d);
        setWords(allWords(d, mine));
      })
      .catch(() => !stop && setError("The characters could not load. Please try again in a moment."));
    return () => {
      stop = true;
    };
  }, []);

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    if (!data) return;
    const w = pickWord(words, focus.chars, last.current);
    if (!w) return;
    last.current = w.text;
    setQ({ word: w, options: choices(w, words, data.lookalikes) });
    setPicked(null);
    shownAt.current = now();
    replays.current = 0;
  }, [data, words, focus]);

  useEffect(() => {
    next();
  }, [data, words, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (advance.current) clearTimeout(advance.current);
    },
    [],
  );

  const choose = useCallback(
    (o: CharWord) => {
      if (!q || picked !== null || !data) return;
      setPicked(o);
      const ok = o.text === q.word.text;
      const lookalike = lookalikesOf(q.word.text, data.lookalikes).includes(o.text);
      setScore((s) => ({ n: s.n + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
      // Save the word picked, so the stats can show which characters are taken for others (她 for 他).
      api.event({
        area: "characters",
        mode: "recognize",
        item: q.word.text,
        ok,
        first_try: ok,
        ms: since(shownAt.current),
        replays: replays.current,
        units: [
          {
            kind: "char",
            expected: q.word.text,
            actual: o.text,
            ok,
            ctx: q.word.source,
            extra: { picked: o.english, lookalike },
          },
        ],
        details: {
          options: q.options.map((x) => x.text),
          zhuyin: q.word.zhuyin,
          focus: focus.active ? focus.label : undefined,
        },
      });
      playSfx(ok ? "right" : "wrong");
      playAudio(ttsUrl(q.word.text));
      // A right answer moves on by itself; a wrong one waits, so the learner can compare the two characters.
      if (ok) advance.current = setTimeout(next, 1600);
    },
    [q, picked, data, next, focus],
  );

  const replay = () => {
    if (!q) return;
    if (picked === null) replays.current += 1;
    else if (advance.current) clearTimeout(advance.current);
    playAudio(ttsUrl(q.word.text));
  };

  useHotkeys("characters", [
    ...ANSWER_KEYS.map((keys, i) => ({
      keys,
      label: "Answer " + (i + 1),
      run: () => q && choose(q.options[i]),
      when: !!q && picked === null && i < q.options.length,
      bar: false,
    })),
    { keys: [], label: "Answer", show: ["1-4", "/", "A S D F"], when: !!q && picked === null },
    { keys: ["Space"], label: picked ? "Hear again" : "Hear it (help)", run: replay, when: !!q },
    { keys: ["Enter", "KeyN"], label: "Next", run: next, when: picked !== null },
  ]);

  const right = q !== null && picked?.text === q.word.text;
  const big = q && q.word.text.length > 2 ? "text-[clamp(56px,12vw,120px)]" : "text-[clamp(80px,18vh,180px)]";
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex gap-2 items-center flex-wrap">
        <FocusChip focus={focus} />
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}% of{" "}
          {score.n}
        </div>
      </div>
      {error && <div className="card p-3 text-sm text-bad">{error}</div>}
      {q && (
        <div
          className={
            "card stage border-2 p-8 flex flex-1 flex-col items-center justify-center gap-6 md:gap-7 transition-colors duration-300 " +
            (picked === null ? "border-line" : right ? "border-ok bg-ok/5" : "border-bad/60 bg-bad/5")
          }
        >
          <StatusPill
            status={picked === null ? "listening" : right ? "right" : "wrong"}
            label={picked === null ? "What does it mean?" : right ? "Correct!" : "Not quite"}
          />
          <div className="flex flex-col items-center gap-2">
            <div
              lang="zh-TW"
              className={"cjk font-semibold leading-none select-none " + big + (right ? " text-ok" : "")}
              aria-label={"Character: " + q.word.text}
            >
              {q.word.text}
            </div>
            <div className="min-h-8 text-accent text-xl tracking-wider">{picked !== null ? q.word.zhuyin : ""}</div>
            {picked !== null && <PlayButton src={ttsUrl(q.word.text)} title="Play again (Space)" />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 w-full max-w-3xl">
            {q.options.map((o, i) => {
              const isRight = picked !== null && o.text === q.word.text;
              const isWrong = picked?.text === o.text && !isRight;
              return (
                <button
                  key={o.text}
                  onClick={() => choose(o)}
                  className={
                    "tile relative rounded-2xl border-2 pl-20 pr-4 py-4 text-left transition " +
                    (picked?.text === o.text ? fxClass(isRight ? "right" : "wrong") : "") +
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
                  {isRight && picked?.text === o.text && <Burst count={12} distance={90} />}
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 flex gap-1">
                    <Kbd>{i + 1}</Kbd>
                    <Kbd>{ANSWER_LETTERS[i]}</Kbd>
                  </span>
                  <div className="text-lg md:text-xl font-medium">{o.english}</div>
                  {/* After the answer, each choice shows its character, so a look-alike is easy to compare. */}
                  {picked !== null && (
                    <div lang="zh-TW" className="cjk text-sm text-muted mt-0.5">
                      {o.text} · {o.zhuyin}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className="text-sm text-muted text-center max-md:hidden">
              {q.word.french ? "Français : " + q.word.french + " · " : ""}
              {q.word.source === "sentence" ? "From your sentences" : "From the course"} · <Kbd>Enter</Kbd> next
            </div>
          )}
          {picked !== null && (
            <ActionBar
              mobileOnly
              tone={right ? "ok" : "bad"}
              title={right ? "Correct!" : "Not quite"}
              detail={<span className="cjk text-xl">{q.word.text + " · " + q.word.english}</span>}
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
