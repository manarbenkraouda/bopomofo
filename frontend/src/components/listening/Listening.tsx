"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { loadData, splitZhuyin, syllableAudio, TONE_MARK, TONE_NAME, type SyllableItem } from "@/lib/zhuyin";
import { PlayButton } from "@/components/PlayButton";

type Quiz = "tone" | "zhuyin";
type Q = { item: SyllableItem; options: string[]; answer: string };

const shuffle = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const withTone = (z: string, t: number) => { const { symbols } = splitZhuyin(z); return symbols.join("") + TONE_MARK[t]; };

export function Listening() {
  const [items, setItems] = useState<SyllableItem[]>([]);
  const [quiz, setQuiz] = useState<Quiz>("tone");
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });

  useEffect(() => { loadData().then((d) => setItems(d.syllables.filter((s) => !s.zhuyin.includes("˙")))); }, []);

  const make = useCallback((): Q | null => {
    if (!items.length) return null;
    const item = items[Math.floor(Math.random() * items.length)];
    const { toneNum, symbols } = splitZhuyin(item.zhuyin);
    if (quiz === "tone") return { item, options: ["1", "2", "3", "4"], answer: String(toneNum) };
    const opts = new Set<string>([item.zhuyin]);
    for (const t of shuffle([1, 2, 3, 4].filter((t) => t !== toneNum)).slice(0, 2)) opts.add(withTone(item.zhuyin, t));
    const near = shuffle(items.filter((s) => s.zhuyin !== item.zhuyin && splitZhuyin(s.zhuyin).symbols.some((c) => symbols.includes(c))));
    for (const s of near) { if (opts.size >= 4) break; opts.add(withTone(s.zhuyin, toneNum)); }
    for (const s of shuffle(items)) { if (opts.size >= 4) break; opts.add(s.zhuyin); }
    return { item, options: shuffle([...opts]), answer: item.zhuyin };
  }, [items, quiz]);

  const next = useCallback(() => {
    const nq = make();
    setQ(nq);
    setPicked(null);
    if (nq) playAudio(syllableAudio(nq.item.id));
  }, [make]);

  useEffect(() => { if (items.length) next(); }, [items.length, quiz]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((o: string) => {
    if (!q || picked) return;
    setPicked(o);
    const ok = o === q.answer;
    setScore((s) => ({ n: s.n + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
    api.attempt("listening", q.item.zhuyin, ok, { quiz, heard_tones: [{ tone: splitZhuyin(q.item.zhuyin).toneNum, ok }] });
  }, [q, picked, quiz]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return;
      if (e.code === "Space") { e.preventDefault(); playAudio(syllableAudio(q.item.id)); }
      else if (e.key === "Enter" && picked) next();
      else if (/^[1-4]$/.test(e.key)) choose(q.options[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, picked, next, choose]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2 items-center">
        <button className="chip" data-active={quiz === "tone"} onClick={() => setQuiz("tone")}>Which tone?</button>
        <button className="chip" data-active={quiz === "zhuyin"} onClick={() => setQuiz("zhuyin")}>Which Bopomofo?</button>
        <div className="ml-auto text-sm text-muted"><b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}% of {score.n}</div>
      </div>
      {q && (
        <div className="card p-8 flex flex-col items-center gap-6">
          <PlayButton big src={syllableAudio(q.item.id)} title="Play again (Space)" />
          <div className="text-muted">{quiz === "tone" ? "Which tone do you hear? (keys 1-4)" : "Which Bopomofo matches the sound? (keys 1-4)"}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl">
            {q.options.map((o, i) => {
              const right = picked && o === q.answer, wrong = picked === o && o !== q.answer;
              return (
                <button key={o} onClick={() => choose(o)} className={"rounded-2xl border-2 p-4 text-center transition " + (right ? "border-ok bg-ok/10" : wrong ? "border-bad bg-bad/10" : "border-line bg-card hover:border-ink")}>
                  <div className="text-xs text-muted">{i + 1}</div>
                  <div className={"cjk " + (quiz === "tone" ? "text-3xl" : "text-3xl tracking-wider")}>{quiz === "tone" ? ["ˉ", "ˊ", "ˇ", "ˋ"][Number(o) - 1] : o}</div>
                  {quiz === "tone" && <div className="text-xs text-muted mt-1">{TONE_NAME[Number(o)]}</div>}
                </button>
              );
            })}
          </div>
          {picked && (
            <div className="flex flex-col items-center gap-3">
              <div className={"text-lg font-semibold " + (picked === q.answer ? "text-ok" : "text-bad")}>{picked === q.answer ? "Correct!" : "Not quite."}</div>
              <div className="cjk text-4xl">{q.item.char} <span className="text-accent text-3xl">{q.item.zhuyin}</span></div>
              <ToneSet items={items} item={q.item} />
              <button className="btn btn-primary" onClick={next}>Next ⏎</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToneSet({ items, item }: { items: SyllableItem[]; item: SyllableItem }) {
  const base = splitZhuyin(item.zhuyin).symbols.join("");
  const set = items.filter((s) => splitZhuyin(s.zhuyin).symbols.join("") === base).sort((a, b) => splitZhuyin(a.zhuyin).toneNum - splitZhuyin(b.zhuyin).toneNum);
  if (set.length < 2) return null;
  return (
    <div className="flex gap-2 items-center text-sm text-muted">
      Compare:
      {set.map((s) => <button key={s.id} className="chip cjk" onClick={() => playAudio(syllableAudio(s.id))}>{s.char} {s.zhuyin}</button>)}
    </div>
  );
}
