"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Burst, FxFrame, StatusPill, type FxStatus } from "@/components/quiz/Feedback";
import { Sheet } from "./Sheet";
import { BOX, gradeSheet, segment, shiftOf, clusterStrokes, type Graded, type Row } from "./segment";
import { Guide, ResultOverlay, UserStrokes, COLORS } from "./Overlay";

type Mode = "symbol" | "syllable" | "word";
type Group = { char?: string; zhuyin: string };
type Item = { key: string; groups: Group[]; audio: string; english?: string };

const MODES: Mode[] = ["symbol", "syllable", "word"];
const MODE_LABEL: Record<Mode, string> = { symbol: "Symbols", syllable: "Syllables", word: "Words" };
/** Room on the sheet, in line heights, per syllable: most syllables have 2 or 3 symbols and a tone mark, plus the space after it. */
const PER_SYLLABLE = 3.6;

/** The tokens of a syllable in writing order: the neutral dot first, the other marks last. */
const tokensOf = (z: string, withTone: boolean) => {
  const { symbols, tone } = splitZhuyin(z);
  return [...(withTone && tone === "˙" ? [{ sym: tone, mark: true }] : []), ...symbols.map((s) => ({ sym: s, mark: false })),
    ...(withTone && tone && tone !== "˙" ? [{ sym: tone, mark: true }] : [])];
};

export function WritingPractice() {
  const [data, setData] = useState<{ strokes: StrokeData; table: MoeRow[]; syllables: SyllableItem[] } | null>(null);
  const [T, setT] = useState<Templates | null>(null);
  const [mode, setMode] = useState<Mode>("syllable");
  const [item, setItem] = useState<Item | null>(null);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [graded, setGraded] = useState<Graded[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [guide, setGuide] = useState(false);
  const [anim, setAnim] = useState(0);
  const [err, setErr] = useState<Record<string, number>>({});
  const [words, setWords] = useState<Item[] | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({ done: 0, ok: 0, streak: 0 });
  const [fxKey, setFxKey] = useState(0);
  const [avail, setAvail] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const focus = useFocus();
  const modeParam = useSearchParams().get("mode");
  const { w: vw, h: vh } = useViewport();
  const phone = vw < PHONE;
  useEffect(() => () => { if (advance.current) clearTimeout(advance.current); }, []);
  // The sheet takes the width of the card.
  const hasItem = item !== null;
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, [hasItem]);

  useEffect(() => {
    loadData().then((d) => { setData(d); setT(buildTemplates(d.strokes)); });
    api.summary().then((s) => setErr(Object.fromEntries(Object.entries(s.symbols_by_area?.writing ?? s.symbols).map(([k, v]) => [k, (v.err + 1) / (v.n + 2)])))).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    const sid = Number(q.get("sentence"));
    if (sid) api.sentence(sid).then((s) => { setMode("word"); setQueue(sentenceWords(s)); }).catch(() => {});
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
    // The focus from the stats or the coach keeps only matching items, when there are some.
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
    setStrokes([]);
    setGraded(null);
    setRevealed(false);
    shownAt.current = now();
    replays.current = 0;
    if (it) playAudio(it.audio);
  }, [pick]);
  useEffect(() => {
    if (data && (mode !== "word" || words)) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, words === null, focus]);

  const withTone = mode !== "symbol";
  const n = item?.groups.length ?? 1;
  // The sheet: one line when it can be tall enough to write comfortably, else more lines, within the free height of the screen.
  const sheet = useMemo(() => {
    const width = Math.max(240, avail || (phone ? vw - 48 : 900));
    if (mode === "symbol") {
      const rowH = Math.min(phone ? 250 : Math.round(230 * Math.max(1, Math.min(1.3, vh * 0.0012))), width / 1.3);
      return { rows: 1, cols: 1.3, rowH };
    }
    const need = n * PER_SYLLABLE;
    const maxH = phone ? 130 : 200;
    const good = phone ? 110 : 150;
    const room = Math.max(phone ? 300 : 320, vh * (phone ? 0.5 : 0.48));
    const fit = (rows: number) => Math.min(maxH, (width * rows) / need, room / rows);
    let rows = 1;
    while (rows < 4 && fit(rows) < good && fit(rows + 1) > fit(rows)) rows++;
    const rowH = Math.max(phone ? 90 : 110, fit(rows));
    return { rows, cols: rows === 1 ? Math.min(need, width / rowH) : width / rowH, rowH };
  }, [avail, phone, vw, vh, mode, n]);

  const clusters = useMemo(() => (T ? segment(strokes, sheet.rows, T) : []), [strokes, sheet.rows, T]);

  const check = useCallback((reveal = false) => {
    if (!item || !T || graded) return;
    if (!reveal && !strokes.length) { setMsg("Write something first, or press Show answer."); setTimeout(() => setMsg(""), 2500); return; }
    const res = gradeSheet(item.groups.map((g) => g.zhuyin), strokes, clusters, T, SYMBOLS, withTone);
    setGraded(res);
    setRevealed(reveal);
    setAnim(Date.now());
    const ok = !reveal && res.every((r) => r.nearly);
    const perfect = !reveal && res.every((r) => r.ok);
    if (!reveal) playSfx(perfect ? "right" : ok ? "close" : "wrong");
    setFxKey((k) => k + 1);
    // A perfect answer moves on by itself; otherwise take the time to read the corrections.
    if (perfect) advance.current = setTimeout(next, 1400);
    setStats((s) => ({ done: s.done + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
    const symbols = res.flatMap((r) => r.rows.flatMap((x) => (x.kind === "symbol" && !x.tone ? [{ sym: x.expected, ok: !reveal && (x.r.ok || !!x.r.nearly) }] : x.kind === "missing" && !x.tone ? [{ sym: x.expected, ok: false }] : [])));
    setErr((e) => {
      const out = { ...e };
      for (const s of symbols) out[s.sym] = (out[s.sym] ?? 0.5) * 0.7 + (s.ok ? 0 : 0.3);
      return out;
    });
    // Save every part: the symbol each written shape looked like and its strokes, omitted and extra symbols (∅), and the tone mark as a tone number.
    const units: Unit[] = res.flatMap((r, gi) => {
      const toneOne = !splitZhuyin(item.groups[gi].zhuyin).tone;
      return r.rows.flatMap((x, si): Unit[] => {
        const base = { pos: gi * 10 + si, help: reveal };
        if (x.kind === "tone-ok") return [{ ...base, kind: "tone", expected: 1, actual: 1, ok: true }];
        if (x.kind === "extra" && x.tone && toneOne) return [{ ...base, kind: "tone", expected: 1, actual: x.guess ? TONE_OF_MARK[x.guess] ?? null : null, ok: false }];
        if (x.kind === "extra") return [{ ...base, kind: "symbol", expected: "∅", actual: x.guess ?? null, ok: false }];
        if (x.kind === "missing" && x.tone) return [{ ...base, kind: "tone", expected: TONE_OF_MARK[x.expected], actual: reveal ? null : 1, ok: false }];
        if (x.kind === "missing") return [{ ...base, kind: "symbol", expected: x.expected, actual: reveal ? null : "∅", ok: false }];
        if (x.tone) {
          const good = !reveal && (x.r.ok || !!x.r.nearly);
          return [{ ...base, kind: "tone", expected: TONE_OF_MARK[x.expected], actual: good ? TONE_OF_MARK[x.expected] : x.r.recognized ? TONE_OF_MARK[x.r.recognized] ?? null : null, ok: good }];
        }
        return reveal ? [{ ...base, kind: "symbol", expected: x.expected, actual: null, ok: false }] : writtenUnits(x.expected, x.r, base);
      });
    });
    api.event({ area: "writing", mode, item: item.groups.map((g) => g.zhuyin).join(" "), ok, first_try: ok, ms: since(shownAt.current), help: reveal,
      replays: replays.current, units, details: { perfect, sheet: true, shapes: clusters.length, focus: focus.active ? focus.label : undefined } });
  }, [item, T, graded, strokes, clusters, SYMBOLS, withTone, mode, next, focus]);

  const switchMode = (m: Mode) => { setQueue([]); setMode(m); };
  const hear = () => { if (!item) return; if (!graded) replays.current += 1; playAudio(item.audio); };
  useHotkeys("writing", [
    { keys: ["Enter"], label: graded ? "Next" : "Check", run: () => (graded ? next() : check()), when: !!item },
    { keys: ["Space"], label: "Hear again", run: hear, when: !!item },
    { keys: ["KeyH"], label: "Show answer", run: () => check(true), when: !!item && !graded },
    { keys: ["Backspace", "Ctrl+KeyZ"], label: "Undo stroke", run: () => setStrokes((s) => s.slice(0, -1)), when: !graded && strokes.length > 0, repeat: true },
    { keys: ["Delete"], label: "Clear", run: () => setStrokes([]), when: !graded && strokes.length > 0 },
    { keys: ["KeyT"], label: guide ? "Hide trace guide" : "Trace guide", run: () => setGuide((v) => !v) },
    { keys: ["KeyW"], label: "Watch the strokes again", run: () => setAnim(Date.now()), when: !!graded, bar: false },
    ...cycleKeys("Mode", MODES, mode, switchMode),
  ]);

  if (!data || !T) return <div className="text-muted">Loading stroke data…</div>;

  const allOk = !!graded && !revealed && graded.every((g) => g.ok);
  const nearly = !!graded && !revealed && graded.every((g) => g.nearly);
  const fx: FxStatus = !graded ? "writing" : revealed ? "shown" : allOk ? "right" : nearly ? "close" : "wrong";
  const title = !graded ? undefined : revealed ? "Answer shown" : allOk ? "Correct!" : nearly ? "Correct, small shape notes" : "Not yet: see the corrections";
  const problems = graded ? graded.flatMap((g, gi) => g.rows.map((x) => ({ x, gi }))).filter(({ x }) => !(x.kind === "tone-ok" || (x.kind === "symbol" && x.r.ok))) : [];
  const symbolsSeen = clusters.filter((c) => !c.mark).length, marksSeen = clusters.length - symbolsSeen;

  // The trace guide: the answer in light grey, laid out the way the sheet reads it (symbols a little apart, the mark after them, a space between syllables).
  const guideLayer = guide && item && !graded ? (() => {
    const out: React.ReactNode[] = [];
    let x = 0.08, row = 0;
    item.groups.forEach((g, gi) => {
      for (const t of tokensOf(g.zhuyin, withTone)) {
        const w = t.mark ? 0.55 : 0.95;
        if (x + w > sheet.cols && x > 0.1) { row++; x = 0.08; }
        if (row >= sheet.rows) return;
        const cx = (x + w / 2) * BOX;
        out.push(t.mark
          ? <g key={gi + t.sym + x} transform={"translate(" + (cx - 1075 * 0.5) + " " + ((row + 0.38) * BOX - 1000 * 0.5) + ") scale(0.5)"}><Guide sym={t.sym} data={data.strokes} /></g>
          : <g key={gi + t.sym + x} transform={"translate(" + (cx - 1075) + " " + row * BOX + ")"}><Guide sym={t.sym} data={data.strokes} /></g>);
        x += w;
      }
      x += 0.45;
    });
    return out;
  })() : null;

  // After the check: each written shape in its color, with the expected shape in grey under it.
  const resultLayer = graded ? graded.flatMap((g) => g.rows.map((x, k) => {
    if (x.kind !== "symbol" && x.kind !== "extra") return null;
    const c = clusters[x.cluster];
    if (!c) return null;
    const [dx, dy] = shiftOf(c);
    const own = clusterStrokes(c, strokes);
    return (
      <g key={x.cluster + ":" + k} transform={"translate(" + -dx + " " + -dy + ")"}>
        {x.kind === "symbol" ? <ResultOverlay r={x.r} strokes={own} data={data.strokes} tone={x.tone} />
          : <UserStrokes strokes={own} colors={own.map(() => COLORS.extra)} dashed={own.map(() => true)} tone={x.tone} />}
      </g>
    );
  })) : null;
  // A missing symbol or mark: a pink ghost where it should be, after the last shape written for that syllable.
  const missingLayer = graded ? (() => {
    const out: React.ReactNode[] = [];
    let anchor: { x: number; row: number } = { x: 0.1 * BOX, row: 0 };
    graded.forEach((g, gi) => {
      g.rows.forEach((x, k) => {
        if ((x.kind === "symbol" || x.kind === "extra") && clusters[x.cluster]) {
          const c = clusters[x.cluster];
          anchor = { x: c.x1, row: c.row };
        } else if (x.kind === "missing") {
          const scale = x.tone ? 0.45 : 0.6;
          const cx = anchor.x + (x.tone ? 0.22 : 0.4) * BOX;
          const cy = (anchor.row + (x.tone ? 0.38 : 0.48)) * BOX;
          out.push(
            <g key={"m" + gi + ":" + k} transform={"translate(" + (cx - 1075 * scale) + " " + (cy - 1000 * scale) + ") scale(" + scale + ")"}>
              {(data.strokes[x.expected] ?? []).map((s, i) => <path key={i} d={s.path} fill="#f0b4b4" />)}
            </g>,
          );
          anchor = { x: anchor.x + (x.tone ? 0.4 : 0.7) * BOX, row: anchor.row };
        }
      });
      anchor = { x: anchor.x + 0.3 * BOX, row: anchor.row };
    });
    return out;
  })() : null;

  const animSize = phone ? 52 : 68;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex flex-wrap items-center gap-2">
        {MODES.map((m) => <button key={m} className="chip" data-active={mode === m} onClick={() => switchMode(m)}>{MODE_LABEL[m]}</button>)}
        <FocusChip focus={focus} />
        <button className="chip flex items-center gap-1.5" data-active={guide} onClick={() => setGuide(!guide)}>Trace guide <Kbd className="max-md:!hidden">T</Kbd></button>
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{stats.streak}</b> streak{stats.done > 0 && <> · {Math.round((100 * stats.ok) / stats.done)}% of {stats.done}</>}
        </div>
      </div>

      {!item ? (
        <div className="card stage border-2 border-line p-8 flex flex-1 items-center justify-center text-muted text-center">
          {mode === "word" ? "No words yet. Create sentences on the Sentences page first." : "Loading…"}
        </div>
      ) : (
        <>
          <div className={"card stage border-2 p-4 md:p-6 flex flex-col items-center gap-4 transition-colors duration-300 " + (graded && !allOk ? "" : "flex-1 justify-center ") +
            (fx === "right" ? "border-ok bg-ok/5" : fx === "close" ? "border-rough/70" : fx === "wrong" || fx === "shown" ? "border-bad/60 bg-bad/5" : "border-line")}>
            <div className="flex items-center gap-4">
              <PlayButton big src={item.audio} title="Play again (Space)" />
              <div className="flex flex-col items-start gap-1.5">
                <StatusPill status={fx} label={fx === "writing" ? "Write what you hear" : title} />
                <span className="text-sm text-muted">{mode === "symbol" ? "One symbol" : n === 1 ? "One syllable" : n + " syllables"}{mode === "word" && item.english && graded ? " · " + item.english : ""}</span>
              </div>
            </div>

            {graded && (
              <div className="relative flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1 cjk">
                {allOk && <Burst key={fxKey} count={14} distance={120} />}
                {item.groups.map((g, i) => (
                  <span key={i} className="inline-flex items-baseline gap-1.5">
                    {g.char && <span className="text-3xl">{g.char}</span>}
                    <span className="text-accent text-2xl tracking-widest">{g.zhuyin}</span>
                  </span>
                ))}
              </div>
            )}

            <div ref={stageRef} className="flex w-full justify-center">
              <FxFrame status={fx} attempt={fxKey} round={false}>
                <Sheet rows={sheet.rows} cols={sheet.cols} rowH={sheet.rowH} strokes={strokes} onChange={setStrokes} clusters={clusters}
                  disabled={!!graded} guide={guideLayer} overlay={graded ? <>{missingLayer}{resultLayer}</> : undefined}
                  state={!graded ? null : allOk ? "ok" : nearly ? "nearly" : "bad"} />
              </FxFrame>
            </div>

            {!graded ? (
              <div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted">
                <span className="text-center">
                  {msg || (mode === "symbol" ? "Write the symbol you hear."
                    : phone ? "A small space between symbols, the tone mark after the syllable."
                    : "Write left to right, with a small space between symbols. The tone mark goes after the syllable; tone 1 has none." + (sheet.rows > 1 ? " Go on to the next line when you need room." : ""))}
                </span>
                {strokes.length > 0 && !msg && (
                  <span className="text-xs">Read as {symbolsSeen} symbol{symbolsSeen === 1 ? "" : "s"}{withTone ? " and " + marksSeen + " tone mark" + (marksSeen === 1 ? "" : "s") : ""} (the bars under your writing)</span>
                )}
                <span className="flex gap-2">
                  <button className="btn !px-3 !py-1.5 text-xs text-muted max-md:!px-4 max-md:!py-2 max-md:text-sm" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>↶ Undo <Kbd className="max-md:!hidden">⌫</Kbd></button>
                  <button className="btn !px-3 !py-1.5 text-xs text-muted max-md:!px-4 max-md:!py-2 max-md:text-sm" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear <Kbd className="max-md:!hidden">Del</Kbd></button>
                </span>
              </div>
            ) : !allOk && (
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-muted">The right strokes</div>
                <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-3">
                  {item.groups.map((g, gi) => (
                    <div key={gi} className="flex items-end gap-1">
                      {tokensOf(g.zhuyin, withTone).map((t, k) => (
                        <div key={k} className={"rounded-lg bg-[#fffdf8] " + (t.mark ? "self-start" : "")}>
                          <StrokeAnim sym={t.sym} data={data.strokes} size={t.mark ? Math.round(animSize * 0.6) : animSize} playKey={anim} numbers={!t.mark} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <button className="text-xs text-accent" onClick={() => setAnim(Date.now())}>Watch again <span className="text-muted max-md:hidden">(W)</span></button>
              </div>
            )}

            <div className="w-full max-w-3xl">
              <ActionBar tone={fx === "right" ? "ok" : fx === "close" ? "close" : fx === "wrong" || fx === "shown" ? "bad" : null} title={title}
                detail={graded ? <span className="text-xl">{item.groups.map((g) => (g.char ?? "") + " " + g.zhuyin).join("  ")}</span> : undefined}>
                {!graded && <button className="btn" onClick={() => check(true)}>Show answer <Kbd className="max-md:!hidden">H</Kbd></button>}
                <div className="flex-1 max-md:!hidden" />
                {!graded ? <button className="btn btn-primary ab-primary" onClick={() => check()}>Check <Kbd className="max-md:!hidden">Enter</Kbd></button>
                  : <button className={"btn btn-primary ab-primary " + (phone ? (allOk ? "!bg-ok !border-ok !text-white" : nearly ? "!bg-rough !border-rough !text-white" : "!bg-bad !border-bad !text-white") : "")} onClick={next}>{phone ? "Continue" : "Next"} <Kbd className="max-md:!hidden">Enter</Kbd></button>}
              </ActionBar>
            </div>
          </div>

          {graded && problems.length > 0 && (
            <div className="card p-5">
              <h3 className="font-semibold mb-1">{revealed ? "Watch the strokes, then try the next one." : "What to fix"}</h3>
              {problems.map(({ x, gi }, k) => (
                <ResultRow key={k} x={x} data={data.strokes} syllable={n > 1 ? (item.groups[gi].char ?? "") + " " + item.groups[gi].zhuyin : undefined}
                  toneOne={!splitZhuyin(item.groups[gi].zhuyin).tone} />
              ))}
              <div className="flex flex-wrap gap-4 text-xs text-muted mt-3">
                {[["ok", "correct"], ["rough", "close"], ["wrong", "wrong, reversed, or out of order"], ["joined", "joined strokes"], ["extra", "extra"]].map(([k, l]) => (
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

function ResultRow({ x, data, syllable, toneOne }: { x: Row; data: StrokeData; syllable?: string; toneOne: boolean }) {
  let sym: React.ReactNode = "", items: string[] = [], note = "";
  if (x.kind === "symbol") {
    sym = x.expected;
    items = x.r.messages.length ? x.r.messages : ["Small shape notes."];
    if (!x.r.ok && x.r.nearly && x.r.strokes.some((s) => s.status === "joined")) items = [...items, "Accepted: MOE allows a 3-stroke form of " + x.expected + "."];
    note = NOTES[x.expected] ?? "";
  } else if (x.kind === "missing") {
    sym = <StrokeAnim sym={x.expected} data={data} size={56} numbers={false} />;
    items = [x.tone ? "The tone mark " + x.expected + " is missing." : "The symbol " + x.expected + " is missing."];
    note = NOTES[x.expected] ?? "";
  } else if (x.kind === "extra") {
    sym = "✕";
    items = [x.tone && toneOne ? "This syllable is tone 1, which has no mark. You wrote " + (x.guess ?? "a mark") + "."
      : "Extra " + (x.tone ? "mark" : "symbol") + (x.guess ? " (it looks like " + x.guess + ")" : "") + ". If it is part of the symbol before it, write them closer; if it is a new symbol, leave a space."];
  }
  return (
    <div className="grid grid-cols-[64px_1fr] gap-3 py-2 border-t border-line">
      <div className="cjk text-3xl grid place-items-center">{sym}</div>
      <div>
        {syllable && <div className="text-xs text-muted cjk">{syllable}</div>}
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

