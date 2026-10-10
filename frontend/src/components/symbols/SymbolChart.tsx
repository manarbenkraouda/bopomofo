"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type Alphabet, type AlphabetSymbol } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { PHONE, useViewport } from "@/lib/useFit";
import { FINALS, INITIALS, loadData, MEDIALS, NOTES, PINYIN_OF, splitZhuyin, symbolAudio, syllableAudio, type MoeRow, type StrokeData, type SyllableItem } from "@/lib/zhuyin";
import { Kbd } from "@/components/shell/Kbd";
import { StrokeAnim } from "@/components/StrokeAnim";

const TONES = [
  { sym: "ˉ", n: 1, name: "Tone 1", short: "flat", desc: "High and flat. No mark is written.", ex: "媽" },
  { sym: "ˊ", n: 2, name: "Tone 2", short: "rising", desc: "Rising, like a question.", ex: "麻" },
  { sym: "ˇ", n: 3, name: "Tone 3", short: "dipping", desc: "Low and dipping. In phrases it often stays low.", ex: "馬" },
  { sym: "ˋ", n: 4, name: "Tone 4", short: "falling", desc: "Falling sharply from high.", ex: "罵" },
  { sym: "˙", n: 5, name: "Neutral tone", short: "light", desc: "Short and light. The mark is written before the syllable.", ex: "嗎" },
];
type GroupId = "initials" | "medials" | "finals" | "tones";
const GROUPS: { id: GroupId; title: string; zh: string; one: string; syms: string[] }[] = [
  { id: "initials", title: "Initials", zh: "聲母", one: "Initial", syms: INITIALS },
  { id: "medials", title: "Medials", zh: "介音", one: "Medial", syms: MEDIALS },
  { id: "finals", title: "Finals", zh: "韻母", one: "Final", syms: FINALS },
  { id: "tones", title: "Tone marks", zh: "聲調", one: "Tone mark", syms: TONES.map((t) => t.sym) },
];
type Filter = "all" | GroupId;
const FILTERS: Filter[] = ["all", ...GROUPS.map((g) => g.id)];
const groupOf = (s: string) => GROUPS.find((g) => g.syms.includes(s)) ?? GROUPS[0];
const STATE = {
  known: { label: "Known", cls: "bg-ok/15 text-ok" },
  learning: { label: "Learning", cls: "bg-rough/15 text-rough" },
  new: { label: "New", cls: "bg-raise text-muted" },
};
const enc = (syms: string[]) => encodeURIComponent(syms.join(","));
/** The practice pages for a symbol, the same as the coach: repeat (learn mode) until the repetitions are done, then from memory. */
const sayHref = (syms: string[], learn: boolean) => "/reading?syms=" + enc(syms) + (learn ? "&learn=1" : "");
const writeHref = (syms: string[], learn: boolean) => "/dictation?syms=" + enc(syms) + (learn ? "&learn=1" : "");

type Data = { strokes: StrokeData; table: MoeRow[]; syllables: SyllableItem[] };

/** The 37 Bopomofo symbols and the tone marks, with what the learner knows of each.
 * Top: progress over the alphabet and the next symbols the coach teaches. Then one card of tiles per group.
 * A tile opens its details (strokes, sound, progress, examples, practice): a side panel on a wide screen, a bottom sheet on a phone. */
export function SymbolChart() {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [alpha, setAlpha] = useState<Alphabet | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [play, setPlay] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [hints, setHints] = useState(true);
  const { w: vw } = useViewport();
  const wide = vw >= 1024;
  const phone = vw < PHONE;
  useEffect(() => {
    loadData().then(setD);
    api.alphabet().then(setAlpha).catch(() => {});
  }, []);

  const info = useMemo(() => new Map((alpha?.symbols ?? []).map((x) => [x.sym, x])), [alpha]);
  const reps = alpha?.learn_reps ?? 10;
  const next = alpha?.next_group ?? [];
  const nextLearn = next.some((s) => info.get(s)?.phase === "repeat");
  const shown = filter === "all" ? GROUPS : GROUPS.filter((g) => g.id === filter);
  const order = shown.flatMap((g) => g.syms);
  const cur = sel && order.includes(sel) ? sel : next.find((s) => order.includes(s)) ?? order[0];
  const tone = TONES.find((t) => t.sym === cur);
  const x = info.get(cur);
  const say = tone ? "/listening?tones=" + tone.n : sayHref([cur], x?.phase === "repeat" || !x);
  const write = tone ? "/speaking?source=syllable&tones=" + tone.n : writeHref([cur], x?.phase === "repeat" || !x);

  // Play a symbol; a tone mark plays its example syllable.
  const hear = (s: string) => {
    if (!d) return;
    const r = d.table.find((y) => y.sym === s);
    if (r) { playAudio(symbolAudio(r)); return; }
    const t = TONES.find((y) => y.sym === s);
    const ex = t && d.syllables.find((y) => y.char === t.ex);
    if (ex) playAudio(syllableAudio(ex.id));
  };
  const pick = (s: string, open = true) => {
    setSel(s);
    setPlay((p) => p + 1);
    if (open && !wide) setSheet(true);
    hear(s);
  };
  const step = (n: number) => pick(order[(order.indexOf(cur) + n + order.length) % order.length], false);
  const jump = (n: number) => {
    const g = shown.findIndex((y) => y.syms.includes(cur));
    pick(shown[(g + n + shown.length) % shown.length].syms[0], false);
  };
  useHotkeys("symbols", [
    { keys: ["ArrowRight"], label: "Next symbol", run: () => step(1), repeat: true, bar: false },
    { keys: ["ArrowLeft"], label: "Previous symbol", run: () => step(-1), repeat: true, bar: false },
    { keys: [], label: "Symbol", show: ["←", "→"] },
    { keys: ["ArrowDown"], label: "Next group", run: () => jump(1), bar: false },
    { keys: ["ArrowUp"], label: "Previous group", run: () => jump(-1), bar: false },
    { keys: ["Space"], label: "Sound", run: () => hear(cur), when: !!d },
    { keys: ["Enter"], label: "Strokes", run: () => setPlay((p) => p + 1), when: cur !== "ˉ" },
    { keys: ["KeyR"], label: tone ? "Hear the tone" : "Say it", run: () => router.push(say) },
    { keys: ["KeyW"], label: tone ? "Say the tone" : "Write it", run: () => router.push(write) },
    { keys: ["KeyN"], label: "Learn the next symbols", run: () => router.push(sayHref(next, nextLearn)), when: next.length > 0, bar: false },
    { keys: ["KeyP"], label: hints ? "Hide Pinyin" : "Show Pinyin", run: () => setHints(!hints), bar: false },
    { keys: ["Escape"], label: "Close", run: () => setSheet(false), when: sheet, bar: false },
    ...cycleKeys("Group", FILTERS, filter, setFilter),
  ]);

  const counts = { known: 0, learning: 0, new: 0 };
  for (const y of alpha?.symbols ?? []) counts[y.state]++;
  const headline = !alpha ? "The 37 symbols of Bopomofo."
    : counts.known === 37 ? "You know all 37 symbols."
    : counts.known + counts.learning === 0 ? "Learn the 37 symbols, a few at a time."
    : counts.known + " of 37 symbols known. " + counts.learning + " are in progress.";

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card relative overflow-hidden p-5 md:p-6">
        <div className="pointer-events-none absolute -bottom-12 -right-3 select-none cjk text-[180px] leading-none text-accent opacity-[.06] md:right-[30%]">ㄅ</div>
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:gap-8">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">The alphabet</div>
            <h1 className="mt-1 text-xl font-semibold leading-snug md:text-2xl">{headline}</h1>
            <div className="mt-4 grid grid-cols-3 gap-4 sm:max-w-md">
              {([["known", "bg-ok"], ["learning", "bg-rough"], ["new", "bg-line"]] as const).map(([k, c]) => (
                <div key={k}>
                  <div className="text-2xl font-semibold tabular-nums md:text-3xl">{alpha ? counts[k] : "–"}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted"><i className={"h-2 w-2 rounded-full " + c} />{k}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-raise sm:max-w-md" title={counts.known + " known, " + counts.learning + " learning, " + counts.new + " new"}>
              <i className="bg-ok transition-all" style={{ width: (100 * counts.known) / 37 + "%" }} />
              <i className="bg-rough transition-all" style={{ width: (100 * counts.learning) / 37 + "%" }} />
            </div>
            <p className="mt-2 text-xs text-muted">Known: said or written right from memory, several times in a row.</p>
          </div>
          {next.length > 0 && (
            <div className="flex flex-col gap-3 md:w-[340px]">
              <div>
                <div className="mb-2 text-xs font-medium text-muted">Next up, from your coach</div>
                <div className="flex gap-1.5">
                  {next.map((s) => (
                    <button key={s} onClick={() => pick(s)} aria-label={"Open " + s}
                      className={"cjk grid h-11 flex-1 place-items-center rounded-xl border text-xl transition active:scale-95 " + (s === cur && (wide || sheet) ? "border-accent bg-accent text-white" : "border-accent/40 bg-accent-soft/40 hover:border-accent")}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Link className="btn btn-accent flex-1 justify-center whitespace-nowrap !py-2.5" href={sayHref(next, nextLearn)}>讀 Learn them <Kbd className="max-md:!hidden">N</Kbd></Link>
                <Link className="btn flex-1 justify-center whitespace-nowrap !py-2.5" href={writeHref(next, nextLearn)}>寫 Write them</Link>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="chips flex items-center gap-1.5 overflow-x-auto max-md:-mx-4 max-md:px-4">
        {FILTERS.map((f) => {
          const g = GROUPS.find((y) => y.id === f);
          return (
            <button key={f} className="chip flex shrink-0 items-center gap-1.5" data-active={filter === f} onClick={() => setFilter(f)}>
              {g ? g.title : "All"}<span className="text-[11px] tabular-nums opacity-60">{g ? g.syms.length : 42}</span>
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        <button className="chip shrink-0" data-active={hints} onClick={() => setHints(!hints)}>Pinyin</button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          {shown.map((g) => {
            const known = g.syms.filter((s) => info.get(s)?.state === "known").length;
            return (
              <section key={g.id}>
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <h2 className="font-semibold">{g.title}</h2>
                  <span className="text-sm text-muted"><span className="cjk">{g.zh}</span> · {g.id === "tones" || !alpha ? g.syms.length : known + " of " + g.syms.length + " known"}</span>
                </div>
                <div className="card grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2 p-3 md:grid-cols-[repeat(auto-fill,minmax(66px,1fr))] md:gap-2.5 md:p-4">
                  {g.syms.map((s) => (
                    <Tile key={s} sym={s} hint={hints ? TONES.find((t) => t.sym === s)?.short ?? PINYIN_OF[s] : ""} x={info.get(s)} reps={reps}
                      next={next.includes(s)} active={s === cur && (wide || sheet)} onPick={() => pick(s)} />
                  ))}
                </div>
              </section>
            );
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted">
            <span><b className="mr-1 text-ok">✓</b>known</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-rough" />learning</span>
            <span><i className="mr-1 inline-block h-1 w-4 rounded-full bg-accent align-middle" />repetitions, {reps} before tests from memory</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-[4px] ring-2 ring-accent align-middle" />next up</span>
          </div>
        </div>
        {d && (
          <>
            {sheet && !wide && <div className="m-sheet-backdrop" onClick={() => setSheet(false)} />}
            <aside data-open={sheet} className="m-sheet card p-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-150px)] lg:overflow-y-auto">
              <Detail s={cur} d={d} x={x} reps={reps} next={next.includes(cur)} play={play} size={phone ? 168 : 200}
                say={say} write={write} onHear={() => hear(cur)} onReplay={() => setPlay((p) => p + 1)} onStep={step} onClose={() => setSheet(false)} />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ sym, hint, x, reps, next, active, onPick }: {
  sym: string; hint: string; x?: AlphabetSymbol; reps: number; next: boolean; active: boolean; onPick: () => void;
}) {
  const known = x?.state === "known";
  const pct = known ? 0 : Math.min(100, (100 * (x?.reps ?? 0)) / reps);
  return (
    <button onClick={onPick} title={x ? STATE[x.state].label + (known ? "" : " · " + Math.min(x.reps, reps) + "/" + reps + " repetitions") : undefined}
      className={"relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-2xl border leading-none transition active:scale-95 "
        + (active ? "border-ink bg-ink text-bg" : known ? "border-ok/50 bg-ok/10 hover:border-ok" : "border-line bg-raise/40 hover:border-muted")
        + (next ? " ring-2 ring-accent ring-offset-2 ring-offset-card" : "")}>
      <span className={"cjk " + (TONES.some((t) => t.sym === sym) ? "h-[26px] translate-y-[.28em] text-[42px] md:h-[30px] md:text-[50px]" : "text-[26px] md:text-3xl")}>{sym}</span>
      {hint && <span className={"mt-1 text-[10px] " + (active ? "text-bg/70" : "text-muted")}>{hint}</span>}
      {known && <span className={"absolute right-1.5 top-1 text-[11px] font-bold " + (active ? "text-bg" : "text-ok")}>✓</span>}
      {x?.state === "learning" && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rough" />}
      {pct > 0 && <i className="absolute bottom-0 left-0 h-1 bg-accent" style={{ width: pct + "%" }} />}
    </button>
  );
}

function Detail({ s, d, x, reps, next, play, size, say, write, onHear, onReplay, onStep, onClose }: {
  s: string; d: Data; x?: AlphabetSymbol; reps: number; next: boolean; play: number; size: number; say: string; write: string;
  onHear: () => void; onReplay: () => void; onStep: (n: number) => void; onClose: () => void;
}) {
  const tone = TONES.find((t) => t.sym === s);
  const row = d.table.find((r) => r.sym === s);
  const examples = d.syllables.filter((y) => (tone ? splitZhuyin(y.zhuyin).toneNum === tone.n : splitZhuyin(y.zhuyin).symbols.includes(s))).slice(0, 8);
  const done = Math.min(x?.reps ?? 0, reps);
  return (
    <div className="flex flex-col gap-4">
      <div className="m-sheet-head -mb-2 flex items-center justify-between">
        <span className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <button className="icon-btn absolute right-4 top-4 !h-9 !w-9 text-lg" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{groupOf(s).one}</span>
        {x && <span className={"rounded-full px-2 py-0.5 font-medium " + STATE[x.state].cls}>{STATE[x.state].label}</span>}
        {next && <span className="rounded-full border border-accent/50 px-2 py-0.5 text-accent">Next up</span>}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button className="icon-btn !h-10 !w-10 shrink-0 text-xl" onClick={() => onStep(-1)} aria-label="Previous symbol">‹</button>
        {s === "ˉ"
          ? <div className="pad-grid cjk grid place-items-center rounded-xl border border-line text-8xl text-[#b5452f]" style={{ width: size, height: size }}>ˉ</div>
          : <StrokeAnim sym={s} data={d.strokes} size={size} playKey={play} />}
        <button className="icon-btn !h-10 !w-10 shrink-0 text-xl" onClick={() => onStep(1)} aria-label="Next symbol">›</button>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span className="cjk text-5xl leading-none">{s}</span>
        <div>
          <div className="text-lg font-semibold">{tone ? tone.name : "≈ " + PINYIN_OF[s]}</div>
          <div className="text-sm text-muted">{tone ? "as in " + tone.ex : row ? row.strokes + " stroke" + (row.strokes > 1 ? "s" : "") : ""}</div>
        </div>
      </div>
      {tone && <p className="-mt-1 text-center text-sm text-muted">{tone.desc}</p>}

      <div className="flex gap-2">
        <button className="btn flex-1 justify-center" onClick={onHear}>▶ Sound <Kbd className="max-md:!hidden">Space</Kbd></button>
        {s !== "ˉ" && <button className="btn flex-1 justify-center" onClick={onReplay}>↻ Strokes <Kbd className="max-md:!hidden">Enter</Kbd></button>}
      </div>

      {NOTES[s] && (
        <div className="rounded-xl border border-line px-3 py-2 text-sm"><span className="font-medium">Writing tip. </span><span className="text-muted">{NOTES[s]}</span></div>
      )}

      {!tone && (
        <div className="rounded-xl bg-raise p-3 text-sm">
          {!x || x.state === "new" ? (
            <div className="text-muted">Not practiced yet. It starts with {reps} repetitions: hear it, then say it back.</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="font-medium">{x.state === "known" ? "You know this symbol" : x.phase === "recall" ? "Repetitions done. Now test it from memory" : "Repetitions"}</span>
                {x.state !== "known" && <span className="tabular-nums text-muted">{done}/{reps}</span>}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <i className={"block h-full " + (x.state === "known" ? "bg-ok" : "bg-accent")} style={{ width: (x.state === "known" ? 100 : (100 * done) / reps) + "%" }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {([["Said", x.say], ["Written", x.write], ["Heard", x.pick]] as const).map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-card px-2 py-1.5">
                    <div className="font-semibold tabular-nums">{v ?? "–"}</div>
                    <div className="text-[11px] text-muted">{l}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-muted">Right from memory, in the last 5 answers.</div>
            </>
          )}
        </div>
      )}

      {examples.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Examples · tap to hear</div>
          <div className="flex flex-wrap gap-1.5">
            {examples.map((y) => (
              <button key={y.id} onClick={() => playAudio(syllableAudio(y.id))} className="flex items-baseline gap-1.5 rounded-xl border border-line bg-bg/60 px-2.5 py-1.5 transition hover:border-accent">
                <span className="cjk text-base">{y.char}</span><span className="cjk text-sm text-accent">{y.zhuyin}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 max-lg:sticky max-lg:-bottom-4 max-lg:-mx-5 max-lg:-mb-1 max-lg:border-t max-lg:border-line max-lg:bg-card max-lg:px-5 max-lg:py-3">
        <Link className="btn btn-accent justify-center !py-2.5" href={say}>{tone ? "聽 Hear " + tone.name.toLowerCase() : "讀 Say it"} <Kbd className="max-md:!hidden">R</Kbd></Link>
        <Link className="btn justify-center !py-2.5" href={write}>{tone ? "說 Say " + tone.name.toLowerCase() : "寫 Write it"} <Kbd className="max-md:!hidden">W</Kbd></Link>
      </div>
    </div>
  );
}
