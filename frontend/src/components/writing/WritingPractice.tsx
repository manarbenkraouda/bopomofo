"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ttsUrl, type Sentence, type Syl, type Unit } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, focusSymbols, matches, useFocus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { buildTemplates, type Pt, type Templates } from "@/lib/matcher";
import { playSfx } from "@/lib/sfx";
import { now, since, TONE_OF_MARK, writtenUnits } from "@/lib/track";
import { PHONE, useViewport } from "@/lib/useFit";
import { loadData, NOTES, splitZhuyin, symbolAudio, syllableAudio, type MoeRow, type StrokeData, type SyllableItem } from "@/lib/zhuyin";
import { PlayButton } from "@/components/PlayButton";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { StrokeAnim } from "@/components/StrokeAnim";
import { FxFrame, StatusPill, type FxStatus } from "@/components/quiz/Feedback";
import { Pad } from "./Pad";
import { gradeSyllable, type Row } from "./grade";
import { Guide, ResultOverlay, UserStrokes, COLORS } from "./Overlay";

type Mode = "symbol" | "syllable" | "word";
type Group = { char?: string; zhuyin: string };
type Item = { key: string; groups: Group[]; audio: string; english?: string };
type Graded = { rows: Row[]; ok: boolean; nearly: boolean };

const BOXES_PER_GROUP = 4;
const MODES: Mode[] = ["symbol", "syllable", "word"];

export function WritingPractice() {
  const [data, setData] = useState<{ strokes: StrokeData; table: MoeRow[]; syllables: SyllableItem[] } | null>(null);
  const [T, setT] = useState<Templates | null>(null);
  const [mode, setMode] = useState<Mode>("syllable");
  const [item, setItem] = useState<Item | null>(null);
  const [boxes, setBoxes] = useState<Pt[][][][]>([]);
  const [graded, setGraded] = useState<Graded[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [guide, setGuide] = useState(false);
  const [watch, setWatch] = useState<Record<string, number>>({});
  const [err, setErr] = useState<Record<string, number>>({});
  const [words, setWords] = useState<Item[] | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({ done: 0, ok: 0, streak: 0 });
  const [fxKey, setFxKey] = useState(0);
  const lastBox = useRef<[number, number] | null>(null);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const focus = useFocus();
  const modeParam = useSearchParams().get("mode");
  const { w: vw, h: vh } = useViewport();
  const grow = Math.max(1, Math.min(1.4, vh * 0.0013)); // pads grow on tall screens
  const phone = vw < PHONE;
  useEffect(() => () => { if (advance.current) clearTimeout(advance.current); }, []);

  useEffect(() => {
    loadData().then((d) => { setData(d); setT(buildTemplates(d.strokes)); });
    api.summary().then((s) => setErr(Object.fromEntries(Object.entries(s.symbols_by_area?.writing ?? s.symbols).map(([k, v]) => [k, (v.err + 1) / (v.n + 2)])))).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    const sid = Number(q.get("sentence"));
    if (sid) {
      api.sentence(sid).then((s) => { setMode("word"); setQueue(sentenceWords(s)); }).catch(() => {});
    }
  }, []);
  useEffect(() => { if (modeParam === "symbol" || modeParam === "syllable" || modeParam === "word") setMode(modeParam); }, [modeParam]);

  useEffect(() => {
    if (mode !== "word" || words) return;
    api.sentences().then((r) => setWords(r.sentences.flatMap(sentenceWords))).catch(() => setWords([]));
  }, [mode, words]);

  const SYMBOLS = useMemo(() => data?.table.map((r) => r.sym) ?? [], [data]);

  const weight = useCallback((z: string) => {
    const { symbols, tone } = splitZhuyin(z);
    const parts = [...symbols, tone].filter(Boolean);
    const w = parts.reduce((a, s) => a + (err[s] ?? 0.5), 0) / Math.max(1, parts.length);
    return 0.15 + w * w;
  }, [err]);

  const pick = useCallback((): Item | null => {
    if (!data) return null;
    if (queue.length) {
      const [first, ...rest] = queue;
      setQueue(rest);
      return first;
    }
    let pool: Item[] = [];
    if (mode === "symbol") pool = data.table.map((r) => ({ key: r.sym, groups: [{ zhuyin: r.sym }], audio: symbolAudio(r) }));
    else if (mode === "syllable") pool = data.syllables.map((s) => ({ key: s.id, groups: [{ char: s.char, zhuyin: s.zhuyin }], audio: syllableAudio(s.id) }));
    else pool = words ?? [];
    // The focus from the stats screen keeps only matching items, when there are some.
    if (focus.active) {
      const fs = focusSymbols(focus);
      const f = mode === "symbol" ? pool.filter((it) => fs.includes(it.key)) : pool.filter((it) => it.groups.some((g) => matches(g.zhuyin, focus)));
      if (f.length) pool = f;
    }
    if (!pool.length) return null;
    const ws = pool.map((it) => (it.key === item?.key && pool.length > 1 ? 0 : it.groups.reduce((a, g) => a + weight(g.zhuyin), 0) / it.groups.length));
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((r -= ws[i]) <= 0) return pool[i];
    return pool[0];
  }, [data, mode, words, queue, item, weight, focus]);

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    const it = pick();
    setItem(it);
    setBoxes(it ? it.groups.map(() => Array.from({ length: BOXES_PER_GROUP }, () => [])) : []);
    setGraded(null);
    setRevealed(false);
    setWatch({});
    shownAt.current = now();
    replays.current = 0;
    if (it) playAudio(it.audio);
  }, [pick]);

  // New item when the mode or data changes.
  useEffect(() => {
    if (data && (mode !== "word" || words)) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, words === null, focus]);

  const withTone = mode !== "symbol";
  const setBox = (g: number, b: number, s: Pt[][]) => {
    lastBox.current = [g, b];
    setBoxes((prev) => prev.map((grp, gi) => (gi === g ? grp.map((bx, bi) => (bi === b ? s : bx)) : grp)));
  };

  const check = useCallback((reveal = false) => {
    if (!item || !T || graded) return;
    if (!reveal && boxes.every((g) => g.every((b) => !b.length))) { setMsg("Write something first, or press Show answer."); setTimeout(() => setMsg(""), 2500); return; }
    const res = item.groups.map((g, gi) => gradeSyllable(g.zhuyin, boxes[gi], T, SYMBOLS, withTone));
    setGraded(res);
    setRevealed(reveal);
    if (reveal) {
      const w: Record<string, number> = {};
      item.groups.forEach((g, gi) => {
        const { symbols, tone } = splitZhuyin(g.zhuyin);
        symbols.forEach((_, si) => (w[gi + ":" + si] = Date.now()));
        if (tone && withTone) w[gi + ":3"] = Date.now();
      });
      setWatch(w);
    }
    const ok = !reveal && res.every((r) => r.nearly);
    if (!reveal) playSfx(res.every((r) => r.ok) ? "right" : ok ? "close" : "wrong");
    setFxKey((k) => k + 1);
    // A perfect answer moves on by itself; otherwise take the time to read the corrections.
    if (!reveal && res.every((r) => r.ok)) advance.current = setTimeout(next, 1400);
    setStats((s) => ({ done: s.done + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
    const symbols = res.flatMap((r) => r.rows.flatMap((x) => (x.kind === "symbol" ? [{ sym: x.expected, ok: !reveal && (x.r.ok || !!x.r.nearly) }] : x.kind === "missing" ? [{ sym: x.expected, ok: false }] : [])));
    setErr((e) => {
      const out = { ...e };
      for (const s of symbols) out[s.sym] = (out[s.sym] ?? 0.5) * 0.7 + (s.ok ? 0 : 0.3);
      return out;
    });
    // Save every box: the symbol it looked like and its strokes, omitted and extra symbols (∅), and the tone mark as a tone number.
    const units: Unit[] = res.flatMap((r, gi) => r.rows.flatMap((x, si): Unit[] => {
      const base = { pos: gi * 10 + si, help: reveal };
      if (x.kind === "tone-ok") return [{ ...base, kind: "tone", expected: 1, actual: 1, ok: true }];
      if (x.tone) {
        if (x.kind === "extra") return [{ ...base, kind: "tone", expected: 1, actual: x.guess ? TONE_OF_MARK[x.guess] ?? null : null, ok: false }];
        if (x.kind === "missing") return [{ ...base, kind: "tone", expected: TONE_OF_MARK[x.expected], actual: reveal ? null : 1, ok: false }];
        const good = !reveal && (x.r.ok || !!x.r.nearly);
        return [{ ...base, kind: "tone", expected: TONE_OF_MARK[x.expected], actual: good ? TONE_OF_MARK[x.expected] : x.r.recognized ? TONE_OF_MARK[x.r.recognized] ?? null : null, ok: good }];
      }
      if (x.kind === "extra") return [{ ...base, kind: "symbol", expected: "∅", actual: x.guess ?? null, ok: false }];
      if (x.kind === "missing") return [{ ...base, kind: "symbol", expected: x.expected, actual: reveal ? null : "∅", ok: false }];
      return reveal ? [{ ...base, kind: "symbol", expected: x.expected, actual: null, ok: false }] : writtenUnits(x.expected, x.r, base);
    }));
    api.event({ area: "writing", mode, item: item.groups.map((g) => g.zhuyin).join(" "), ok, first_try: ok, ms: since(shownAt.current), help: reveal,
      replays: replays.current, units, details: { perfect: !reveal && res.every((r) => r.ok), focus: focus.active ? focus.label : undefined } });
  }, [item, T, graded, boxes, SYMBOLS, withTone, mode, next, focus]);

  const switchMode = (m: Mode) => { setQueue([]); setMode(m); };
  const hasInk = boxes.some((g) => g.some((b) => b.length > 0));
  const undo = () => {
    if (!lastBox.current || graded) return;
    const [g, b] = lastBox.current;
    setBoxes((prev) => prev.map((grp, gi) => (gi === g ? grp.map((bx, bi) => (bi === b ? bx.slice(0, -1) : bx)) : grp)));
  };
  useHotkeys("writing", [
    { keys: ["Enter"], label: graded ? "Next" : "Check", run: () => (graded ? next() : check()), when: !!item },
    { keys: ["Space"], label: "Hear again", run: () => { if (!item) return; if (!graded) replays.current += 1; playAudio(item.audio); }, when: !!item },
    { keys: ["KeyH"], label: "Show answer", run: () => check(true), when: !!item && !graded },
    { keys: ["Backspace", "Ctrl+KeyZ"], label: "Undo stroke", run: undo, when: !graded && hasInk, repeat: true },
    { keys: ["Delete"], label: "Clear all", run: () => setBoxes((b) => b.map((g) => g.map(() => []))), when: !graded && hasInk },
    { keys: ["KeyT"], label: guide ? "Hide trace guide" : "Trace guide", run: () => setGuide((v) => !v) },
    ...cycleKeys("Mode", MODES, mode, switchMode),
  ]);

  if (!data || !T) return <div className="text-muted">Loading stroke data…</div>;

  const multi = (item?.groups.length ?? 1) > 1;
  // On a phone the boxes follow the screen width: one syllable is a 2 x 2 grid (3 symbols and the tone), a word is one row per syllable.
  const grid2 = phone && !multi && mode !== "symbol";
  const size = phone
    ? (mode === "symbol" ? Math.min(260, vw - 80) : multi ? Math.floor((vw - 80) / 3.8) : Math.min(170, Math.floor((vw - 88) / 2)))
    : multi ? 118 : Math.round((mode === "symbol" ? 220 : 170) * grow);
  const toneSize = Math.round(size * 0.66);
  const allOk = graded && !revealed && graded.every((g) => g.ok);
  const nearly = graded && !revealed && graded.every((g) => g.nearly);
  const fx: FxStatus = !graded ? "writing" : revealed ? "shown" : allOk ? "right" : nearly ? "close" : "wrong";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button key={m} className="chip" data-active={mode === m} onClick={() => switchMode(m)}>
            {m === "symbol" ? "Single symbols" : m === "syllable" ? "Syllables" : "Words from my sentences"}
          </button>
        ))}
        <FocusChip focus={focus} />
        <button className="chip ml-auto flex items-center gap-1.5" data-active={guide} onClick={() => setGuide(!guide)}>Trace guide <Kbd>T</Kbd></button>
      </div>

      {!item ? (
        <div className="card p-6 text-muted">
          {mode === "word" ? "No words yet. Generate sentences on the Sentences page first." : "Loading…"}
        </div>
      ) : (
        <>
          <div className={"card border-2 p-4 md:p-5 flex items-center gap-4 md:gap-5 transition-colors duration-300 " + (fx === "right" ? "border-ok bg-ok/5" : fx === "close" ? "border-rough/70" : fx === "wrong" ? "border-bad/60 bg-bad/5" : "border-line")}>
            <PlayButton big src={item.audio} title="Play (Space)" />
            <div className="flex-1">
              <div className="mb-2">
                <StatusPill status={fx} label={fx === "writing" ? "Write what you hear" : fx === "close" ? "Correct, small shape notes" : fx === "wrong" ? "Not yet, see the corrections" : undefined} />
              </div>
              <div className="text-muted">
                {msg || (mode === "symbol" ? "Listen, then write the symbol you hear." : phone ? "One symbol per box, the tone mark in the small box (none for tone 1)." : "Listen, then write the Bopomofo: one symbol per box, the tone mark in the small box. Tone 1 has no mark.")}
              </div>
              {graded && (
                <div className="mt-2 flex items-center gap-4 cjk text-3xl">
                  {item.groups.map((g, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {g.char && <span>{g.char}</span>}
                      <span className="text-accent text-2xl tracking-widest">{g.zhuyin}</span>
                    </span>
                  ))}
                  {item.english && <span className="text-base text-muted font-sans">{item.english}</span>}
                </div>
              )}
            </div>
            <div className="text-right text-sm text-muted">
              <div><b className="text-ink text-lg">{stats.streak}</b> streak</div>
              <div>{stats.done ? Math.round((100 * stats.ok) / stats.done) + "% correct" : "–"}</div>
            </div>
          </div>

          <div className="flex justify-center">
          <FxFrame status={fx} attempt={fxKey} round={false}>
          <div className="flex flex-wrap gap-6 justify-center p-3">
            {item.groups.map((g, gi) => {
              const { symbols, tone } = splitZhuyin(g.zhuyin);
              const res = graded?.[gi];
              return (
                <div key={gi} className="flex flex-col items-center gap-2">
                  {multi && <div className="text-xs text-muted">Syllable {gi + 1}{graded && g.char ? " · " + g.char : ""}</div>}
                  <div className={"flex items-end gap-2 " + (grid2 ? "flex-wrap justify-center" : "")} style={grid2 ? { maxWidth: size * 2 + 8 } : undefined}>
                    {Array.from({ length: withTone ? 4 : 1 }, (_, bi) => {
                      const isTone = bi === 3;
                      const strokes = boxes[gi]?.[bi] ?? [];
                      const row = res?.rows.find((x) => (x.kind === "symbol" || x.kind === "extra") && x.box === bi);
                      const expected = isTone ? tone : symbols[bi];
                      const wkey = gi + ":" + bi;
                      let overlay: React.ReactNode = null;
                      let state: "ok" | "nearly" | "bad" | null = null;
                      if (row?.kind === "symbol") { overlay = <ResultOverlay r={row.r} strokes={strokes} data={data.strokes} tone={isTone} />; state = row.r.ok ? "ok" : row.r.nearly ? "nearly" : "bad"; }
                      else if (row?.kind === "extra") { overlay = <UserStrokes strokes={strokes} colors={strokes.map(() => COLORS.extra)} dashed={strokes.map(() => true)} tone={isTone} />; state = "bad"; }
                      const watchSym = row?.kind === "symbol" ? row.expected : expected;
                      return (
                        <div key={bi} className="flex flex-col items-center gap-1">
                          {watch[wkey] && watchSym ? (
                            <StrokeAnim sym={watchSym} data={data.strokes} size={isTone ? toneSize : size} playKey={watch[wkey]} />
                          ) : (
                            <Pad size={isTone ? toneSize : size} strokes={strokes} onChange={(s) => setBox(gi, bi, s)} disabled={!!graded}
                              guide={guide && !graded && expected ? <Guide sym={expected} data={data.strokes} /> : undefined}
                              overlay={overlay ?? undefined} state={state} inkWidth={isTone ? 7 : 9} />
                          )}
                          <div className="flex gap-1">
                            {!graded ? (
                              <>
                                <button className="text-xs text-muted hover:text-ink px-1 max-md:px-2.5 max-md:py-1.5 max-md:text-sm" onClick={() => setBox(gi, bi, strokes.slice(0, -1))}>Undo</button>
                                <button className="text-xs text-muted hover:text-ink px-1 max-md:px-2.5 max-md:py-1.5 max-md:text-sm" onClick={() => setBox(gi, bi, [])}>Clear</button>
                              </>
                            ) : watchSym && (row?.kind === "symbol" || watch[wkey]) ? (
                              <button className="text-xs text-accent px-1" onClick={() => setWatch((w) => { const o = { ...w }; if (o[wkey]) delete o[wkey]; else o[wkey] = Date.now(); return o; })}>
                                {watch[wkey] ? "Show my writing" : "Watch strokes"}
                              </button>
                            ) : <span className="text-xs">&nbsp;</span>}
                          </div>
                          <div className="text-[11px] text-muted -mt-1">{isTone ? "tone" : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </FxFrame>
          </div>

          <ActionBar tone={fx === "right" ? "ok" : fx === "close" ? "close" : fx === "wrong" || fx === "shown" ? "bad" : null}
            title={!graded ? undefined : revealed ? "Answer shown" : allOk ? "Correct!" : nearly ? "Correct, small shape notes" : "Not yet: see the corrections"}
            detail={graded ? <span className="text-xl">{item.groups.map((g) => (g.char ?? "") + " " + g.zhuyin).join("  ")}</span> : undefined}>
            {!graded && <button className="btn" onClick={() => setBoxes((b) => b.map((g) => g.map(() => [])))}>Clear all <Kbd>Del</Kbd></button>}
            {!graded && <button className="btn" onClick={() => check(true)}>Show answer <Kbd>H</Kbd></button>}
            {!graded ? <button className="btn btn-primary ab-primary" onClick={() => check()}>Check <Kbd>Enter</Kbd></button>
              : <button className={"btn btn-primary ab-primary " + (phone ? (allOk ? "!bg-ok !border-ok !text-white" : nearly ? "!bg-rough !border-rough !text-white" : "!bg-bad !border-bad !text-white") : "")} onClick={next}>{phone ? "Continue" : "Next"} <Kbd>Enter</Kbd></button>}
          </ActionBar>

          {graded && (
            <div className="card p-5">
              <h3 className={"text-lg font-semibold mb-3 " + (revealed ? "text-bad" : allOk ? "text-ok" : nearly ? "text-rough" : "text-bad")}>
                {revealed ? "Answer shown. Watch the strokes, then try the next one." : allOk ? "Correct!" : nearly ? "Correct, with small shape notes." : "Not yet. See the corrections below."}
              </h3>
              {graded.map((g, gi) => (
                <div key={gi}>
                  {multi && <div className="text-xs text-muted mt-3 mb-1 cjk">Syllable {gi + 1}: {item.groups[gi].char} {item.groups[gi].zhuyin}</div>}
                  {g.rows.map((x, ri) => <ResultRow key={ri} x={x} data={data.strokes} />)}
                </div>
              ))}
              <div className="flex flex-wrap gap-4 text-xs text-muted mt-3">
                {[["ok", "correct"], ["rough", "close"], ["wrong", "wrong, reversed, or out of order"], ["joined", "joined strokes"]].map(([k, l]) => (
                  <span key={k} className="flex items-center gap-1"><i className="inline-block w-4 h-1 rounded" style={{ background: COLORS[k] }} />{l}</span>
                ))}
                <span>numbers = your stroke order · grey shape = expected</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultRow({ x, data }: { x: Row; data: StrokeData }) {
  let sym: React.ReactNode = "", items: string[] = [], note = "";
  if (x.kind === "symbol") {
    sym = x.expected;
    items = x.r.ok ? ["All strokes are correct."] : x.r.messages;
    if (!x.r.ok && x.r.nearly && x.r.strokes.some((s) => s.status === "joined")) items = [...items, "Accepted: MOE allows a 3-stroke form of " + x.expected + "."];
    note = NOTES[x.expected] ?? "";
  } else if (x.kind === "missing") {
    sym = <StrokeAnim sym={x.expected} data={data} size={64} numbers={false} />;
    items = [x.tone ? "The tone mark " + x.expected + " is missing." : "The symbol " + x.expected + " is missing. Its strokes are shown on the left."];
    note = NOTES[x.expected] ?? "";
  } else if (x.kind === "extra") {
    sym = "✕";
    items = [x.tone ? "This syllable is tone 1, which has no mark. You wrote " + (x.guess ?? "a mark") + "." : "This box is extra" + (x.guess ? " (it looks like " + x.guess + ")" : "") + "."];
  } else {
    sym = "–";
    items = ["Tone 1: no mark. Correct."];
  }
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 py-2 border-t border-line">
      <div className="cjk text-3xl text-center">{sym}</div>
      <div>
        <ul className="list-disc pl-5 text-[15px] cjk">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
        {note && <div className="text-xs text-muted mt-1">MOE: {note}</div>}
      </div>
    </div>
  );
}

// Words of a sentence, with Bopomofo from the sentence context.
function sentenceWords(s: Sentence): Item[] {
  const out: Item[] = [];
  let from = 0;
  for (const w of s.words) {
    const at = s.hanzi.indexOf(w.text, from);
    if (at < 0) continue;
    from = at + w.text.length;
    const sylls = s.items.slice(at, at + w.text.length).filter((x): x is Syl => x.type === "syllable");
    if (!sylls.length || sylls.length !== w.text.length || sylls.length > 4) continue;
    out.push({ key: s.id + ":" + at, groups: sylls.map((x) => ({ char: x.char, zhuyin: x.zhuyin })), audio: ttsUrl(w.text, -10), english: w.english });
  }
  return out;
}
