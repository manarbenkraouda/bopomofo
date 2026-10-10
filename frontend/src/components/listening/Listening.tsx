"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, matches, useFocus } from "@/lib/focus";
import { ANSWER_KEYS, ANSWER_LETTERS, cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { now, parts, since } from "@/lib/track";
import { loadData, splitZhuyin, syllableAudio, TONE_MARK, TONE_NAME, type SyllableItem } from "@/lib/zhuyin";
import { PlayButton } from "@/components/PlayButton";
import { Burst, fxClass, StatusPill } from "@/components/quiz/Feedback";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";

type Quiz = "tone" | "zhuyin";
type Q = { item: SyllableItem; options: string[]; answer: string };
const QUIZZES: Quiz[] = ["tone", "zhuyin"];
const COMPARE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR"];

const shuffle = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const withTone = (z: string, t: number) => { const { symbols } = splitZhuyin(z); return symbols.join("") + TONE_MARK[t]; };
/** The same syllable in its other tones, for comparison. */
const toneSetOf = (items: SyllableItem[], item: SyllableItem) => {
  const base = splitZhuyin(item.zhuyin).symbols.join("");
  return items.filter((s) => splitZhuyin(s.zhuyin).symbols.join("") === base).sort((a, b) => splitZhuyin(a.zhuyin).toneNum - splitZhuyin(b.zhuyin).toneNum).slice(0, 4);
};

export function Listening() {
  const [items, setItems] = useState<SyllableItem[]>([]);
  const [quiz, setQuiz] = useState<Quiz>("tone");
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [held, setHeld] = useState(false); // auto-advance stopped to compare tones
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const focus = useFocus();
  const quizParam = useSearchParams().get("quiz");

  useEffect(() => { loadData().then((d) => setItems(d.syllables.filter((s) => !s.zhuyin.includes("˙")))); }, []);
  useEffect(() => { if (quizParam === "tone" || quizParam === "zhuyin") setQuiz(quizParam); }, [quizParam]);
  // The focus from the stats screen narrows the questions. With no match, all syllables stay in play.
  const matching = useMemo(() => items.filter((s) => matches(s.zhuyin, focus)), [items, focus]);
  const pool = matching.length ? matching : items;

  const make = useCallback((): Q | null => {
    if (!pool.length) return null;
    const item = pool[Math.floor(Math.random() * pool.length)];
    const { toneNum, symbols } = splitZhuyin(item.zhuyin);
    if (quiz === "tone") return { item, options: ["1", "2", "3", "4"], answer: String(toneNum) };
    const opts = new Set<string>([item.zhuyin]);
    for (const t of shuffle([1, 2, 3, 4].filter((t) => t !== toneNum)).slice(0, 2)) opts.add(withTone(item.zhuyin, t));
    const near = shuffle(items.filter((s) => s.zhuyin !== item.zhuyin && splitZhuyin(s.zhuyin).symbols.some((c) => symbols.includes(c))));
    for (const s of near) { if (opts.size >= 4) break; opts.add(withTone(s.zhuyin, toneNum)); }
    for (const s of shuffle(items)) { if (opts.size >= 4) break; opts.add(s.zhuyin); }
    return { item, options: shuffle([...opts]), answer: item.zhuyin };
  }, [items, pool, quiz]);

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    const nq = make();
    setQ(nq);
    setPicked(null);
    setHeld(false);
    shownAt.current = now();
    replays.current = 0;
    if (nq) playAudio(syllableAudio(nq.item.id));
  }, [make]);

  useEffect(() => { if (items.length) next(); }, [items.length, quiz, pool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (advance.current) clearTimeout(advance.current); }, []);

  const choose = useCallback((o: string) => {
    if (!q || picked) return;
    setPicked(o);
    const ok = o === q.answer;
    setScore((s) => ({ n: s.n + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
    // Save what was picked, so the stats can show which tone or sound you hear instead of the right one.
    const e = parts(q.item.zhuyin);
    const units = quiz === "tone"
      ? [{ kind: "tone" as const, expected: e.tone, actual: Number(o), ok, ctx: e.base }]
      : (() => {
          const a = parts(o);
          return [
            { kind: "tone" as const, expected: e.tone, actual: a.tone, ok: e.tone === a.tone, ctx: e.base },
            { kind: "initial" as const, expected: e.initial, actual: a.initial, ok: e.initial === a.initial },
            { kind: "final" as const, expected: e.final, actual: a.final, ok: e.final === a.final },
            { kind: "syllable" as const, expected: q.answer, actual: o, ok },
          ];
        })();
    api.event({ area: "listening", mode: quiz, item: q.item.zhuyin, ok, first_try: ok, ms: since(shownAt.current), replays: replays.current, units,
      details: { options: q.options, picked: o, focus: focus.active ? focus.label : undefined } });
    playSfx(ok ? "right" : "wrong");
    // Always move on by itself: after 1 s when right, after 1.5 s when wrong (time to see the right answer).
    advance.current = setTimeout(next, ok ? 1000 : 1500);
  }, [q, picked, quiz, next, focus]);

  const toneSet = q && picked ? toneSetOf(items, q.item) : [];
  const compare = (i: number) => {
    if (!toneSet[i]) return;
    if (advance.current) clearTimeout(advance.current);
    setHeld(true);
    playAudio(syllableAudio(toneSet[i].id));
  };

  useHotkeys("listening", [
    ...ANSWER_KEYS.map((keys, i) => ({ keys, label: "Answer " + (i + 1), run: () => q && choose(q.options[i]), when: !!q && !picked && i < q.options.length, bar: false })),
    { keys: [], label: "Answer", show: ["1-4", "/", "A S D F"], when: !!q && !picked },
    { keys: ["Space"], label: "Hear again", run: () => { if (!q) return; if (!picked) replays.current += 1; playAudio(syllableAudio(q.item.id)); }, when: !!q },
    { keys: ["Enter", "KeyN"], label: "Next", run: next, when: !!picked },
    ...COMPARE_KEYS.map((k, i) => ({ keys: [k], label: "Compare tone: " + (toneSet[i]?.zhuyin ?? ""), run: () => compare(i), when: toneSet.length > 1 && i < toneSet.length, bar: false })),
    { keys: [], label: "Compare tones", show: ["Q W E R"], when: toneSet.length > 1 },
    ...cycleKeys("Quiz type", QUIZZES, quiz, setQuiz),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex gap-2 items-center">
        <button className="chip" data-active={quiz === "tone"} onClick={() => setQuiz("tone")}>Which tone?</button>
        <button className="chip" data-active={quiz === "zhuyin"} onClick={() => setQuiz("zhuyin")}>Which Bopomofo?</button>
        <FocusChip focus={focus} empty={focus.active && !matching.length} />
        <div className="ml-auto text-sm text-muted"><b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}% of {score.n}</div>
      </div>
      {q && (
        <div className={"card stage border-2 p-8 flex flex-1 flex-col items-center justify-center gap-6 md:gap-7 transition-colors duration-300 " + (!picked ? "border-line" : picked === q.answer ? "border-ok bg-ok/5" : "border-bad/60 bg-bad/5")}>
          <StatusPill status={!picked ? "listening" : picked === q.answer ? "right" : "wrong"}
            label={!picked ? "Listen, then choose" : held ? "Paused to compare: Continue when ready" : picked === q.answer ? "Correct!" : "Not quite"} />
          <PlayButton big src={syllableAudio(q.item.id)} title="Play again (Space)" />
          <div className="text-muted">{quiz === "tone" ? "Which tone do you hear?" : "Which Bopomofo matches the sound?"}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
            {q.options.map((o, i) => {
              const right = picked && o === q.answer, wrong = picked === o && o !== q.answer;
              const fx = picked === o ? fxClass(right ? "right" : "wrong") : "";
              return (
                <button key={o} onClick={() => choose(o)} className={"tile relative rounded-2xl border-2 px-4 pb-5 pt-6 md:pt-9 text-center transition " + fx + " " + (right ? "border-ok bg-ok/10" : wrong ? "border-bad bg-bad/10" : picked ? "border-line bg-card opacity-60" : "border-line bg-card hover:border-accent hover:-translate-y-0.5")}>
                  {right && picked === o && <Burst count={12} distance={90} />}
                  <span className="absolute left-3 top-3 flex gap-1"><Kbd>{i + 1}</Kbd><Kbd>{ANSWER_LETTERS[i]}</Kbd></span>
                  <div className={"cjk " + (quiz === "tone" ? "text-5xl" : "text-4xl tracking-wider")}>{quiz === "tone" ? ["ˉ", "ˊ", "ˇ", "ˋ"][Number(o) - 1] : o}</div>
                  {quiz === "tone" && <div className="text-xs text-muted mt-1">{TONE_NAME[Number(o)]}</div>}
                </button>
              );
            })}
          </div>
          {picked && (
            <div className="flex flex-col items-center gap-3">
              <div className="cjk text-4xl max-md:hidden">{q.item.char} <span className="text-accent text-3xl">{q.item.zhuyin}</span></div>
              {toneSet.length > 1 && (
                <div className="flex flex-wrap justify-center gap-2 items-center text-sm text-muted">
                  Compare:
                  {toneSet.map((s, i) => <button key={s.id} className="chip cjk flex items-center gap-1.5" onClick={() => compare(i)}><Kbd>{COMPARE_KEYS[i].slice(3)}</Kbd>{s.char} {s.zhuyin}</button>)}
                </div>
              )}
            </div>
          )}
          {picked && (
            <ActionBar mobileOnly tone={picked === q.answer ? "ok" : "bad"} title={picked === q.answer ? "Correct!" : "Not quite"}
              detail={<span className="text-2xl">{q.item.char} <span className="text-accent">{q.item.zhuyin}</span></span>}>
              <button className={"btn ab-primary " + (picked === q.answer ? "!bg-ok !border-ok !text-white" : "!bg-bad !border-bad !text-white")} onClick={next}>Continue</button>
            </ActionBar>
          )}
        </div>
      )}
    </div>
  );
}
