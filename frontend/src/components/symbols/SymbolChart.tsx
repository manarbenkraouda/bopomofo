"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { playAudio } from "@/lib/audio";
import { useHotkeys } from "@/lib/hotkeys";
import { PHONE, useViewport } from "@/lib/useFit";
import { FINALS, INITIALS, loadData, MEDIALS, NOTES, PINYIN_OF, splitZhuyin, symbolAudio, syllableAudio, type MoeRow, type StrokeData, type SyllableItem } from "@/lib/zhuyin";
import { Kbd } from "@/components/shell/Kbd";
import { StrokeAnim } from "@/components/StrokeAnim";

const TONES = [
  { sym: "ˉ", name: "Tone 1", desc: "High and flat. No mark is written.", ex: "媽" },
  { sym: "ˊ", name: "Tone 2", desc: "Rising, like a question.", ex: "麻" },
  { sym: "ˇ", name: "Tone 3", desc: "Low, dipping. In phrases it often stays low.", ex: "馬" },
  { sym: "ˋ", name: "Tone 4", desc: "Falling sharply from high.", ex: "罵" },
  { sym: "˙", name: "Neutral", desc: "Short and light. Written before the syllable.", ex: "嗎" },
];
const GROUPS = [INITIALS, MEDIALS, FINALS, TONES.map((t) => t.sym)];
const ORDER = GROUPS.flat();

export function SymbolChart() {
  const router = useRouter();
  const [d, setD] = useState<{ strokes: StrokeData; table: MoeRow[]; syllables: SyllableItem[] } | null>(null);
  const [sel, setSel] = useState("ㄅ");
  const [play, setPlay] = useState(0);
  const [sheet, setSheet] = useState(false); // phone and tablet: the details open in a bottom sheet
  const { w: vw } = useViewport();
  useEffect(() => { loadData().then(setD); }, []);

  // Select a symbol or a tone mark: replay its strokes and play its sound (for a tone, its example syllable).
  const pick = (s: string) => {
    setSel(s);
    setPlay((p) => p + 1);
    setSheet(true);
    if (!d) return;
    const r = d.table.find((x) => x.sym === s);
    if (r) { playAudio(symbolAudio(r)); return; }
    const t = TONES.find((x) => x.sym === s);
    const ex = t && d.syllables.find((x) => x.char === t.ex);
    if (ex) playAudio(syllableAudio(ex.id));
  };
  const step = (n: number) => pick(ORDER[(ORDER.indexOf(sel) + n + ORDER.length) % ORDER.length]);
  const jump = (n: number) => {
    const g = GROUPS.findIndex((x) => x.includes(sel));
    pick(GROUPS[(g + n + GROUPS.length) % GROUPS.length][0]);
  };
  useHotkeys("symbols", [
    { keys: ["ArrowRight"], label: "Next symbol", run: () => step(1), repeat: true, bar: false },
    { keys: ["ArrowLeft"], label: "Previous symbol", run: () => step(-1), repeat: true, bar: false },
    { keys: [], label: "Symbol", show: ["←", "→"] },
    { keys: ["ArrowDown"], label: "Next group", run: () => jump(1), bar: false },
    { keys: ["ArrowUp"], label: "Previous group", run: () => jump(-1), bar: false },
    { keys: [], label: "Group", show: ["↑", "↓"] },
    { keys: ["Space"], label: "Sound", run: () => pick(sel), when: !!d },
    { keys: ["Enter"], label: "Replay strokes", run: () => setPlay((p) => p + 1) },
    { keys: ["KeyW"], label: "Practice writing", run: () => router.push("/writing?mode=symbol") },
    { keys: ["Escape"], label: "Close", run: () => setSheet(false), when: sheet, bar: false },
  ]);

  if (!d) return <div className="text-muted">Loading…</div>;
  const row = d.table.find((r) => r.sym === sel);
  const tone = TONES.find((t) => t.sym === sel);
  const examples = d.syllables.filter((s) => (tone ? s.char === tone.ex : splitZhuyin(s.zhuyin).symbols.includes(sel))).slice(0, 12);
  const anim = vw < PHONE ? 170 : 220;
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      <div className="card p-4 md:p-5 flex flex-col gap-5">
        <p className="text-sm text-muted lg:hidden">Tap a symbol to hear it and watch its strokes.</p>
        <Group title="Initials (聲母)" syms={INITIALS} sel={sel} pick={pick} />
        <Group title="Medials (介音)" syms={MEDIALS} sel={sel} pick={pick} />
        <Group title="Finals (韻母)" syms={FINALS} sel={sel} pick={pick} />
        <div>
          <div className="text-xs uppercase tracking-wide text-muted mb-2">Tone marks (聲調)</div>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button key={t.sym} onClick={() => pick(t.sym)}
                className={"rounded-xl border px-3 py-2 text-left " + (sel === t.sym ? "bg-ink text-bg border-ink" : "bg-card border-line hover:border-ink")}>
                <span className="cjk text-2xl mr-2">{t.sym}</span>{t.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      {sheet && <div className="m-sheet-backdrop" onClick={() => setSheet(false)} />}
      <div data-open={sheet} className="m-sheet card p-5 flex flex-col items-center gap-3 lg:sticky lg:top-0">
        <div className="m-sheet-head flex w-full justify-end -mb-2">
          <button className="icon-btn !h-9 !w-9 text-lg" onClick={() => setSheet(false)} aria-label="Close">✕</button>
        </div>
        {tone ? (
          <>
            {sel !== "ˉ" ? <StrokeAnim sym={sel} data={d.strokes} size={anim} playKey={play} /> : <div className="cjk text-8xl grid place-items-center" style={{ height: anim }}>ˉ</div>}
            <div className="text-xl font-semibold">{tone.name}</div>
            <div className="text-muted text-center">{tone.desc}</div>
          </>
        ) : (
          <>
            <StrokeAnim sym={sel} data={d.strokes} size={anim} playKey={play} />
            <div className="flex items-center gap-3">
              <span className="cjk text-5xl">{sel}</span>
              <div>
                <div className="text-lg">≈ {PINYIN_OF[sel]}</div>
                <div className="text-sm text-muted">{row?.strokes} stroke{row && row.strokes > 1 ? "s" : ""}</div>
              </div>
            </div>
            {NOTES[sel] && <div className="text-sm text-muted text-center">MOE: {NOTES[sel]}</div>}
          </>
        )}
        <div className="flex gap-2">
          <button className="btn whitespace-nowrap" onClick={() => setPlay((p) => p + 1)}>Strokes <Kbd>Enter</Kbd></button>
          {row && <button className="btn whitespace-nowrap" onClick={() => playAudio(symbolAudio(row))}>▶ Sound <Kbd>Space</Kbd></button>}
        </div>
        {examples.length > 0 && (
          <div className="w-full">
            <div className="text-xs text-muted mb-1">Examples</div>
            <div className="flex flex-wrap gap-1">
              {examples.map((s) => <button key={s.id} className="chip cjk" onClick={() => playAudio(syllableAudio(s.id))}>{s.char} {s.zhuyin}</button>)}
            </div>
          </div>
        )}
        <Link href="/writing?mode=symbol" className="btn btn-primary w-full justify-center">Practice writing symbols <Kbd>W</Kbd></Link>
      </div>
    </div>
  );
}

function Group({ title, syms, sel, pick }: { title: string; syms: string[]; sel: string; pick: (s: string) => void }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted mb-2">{title}</div>
      <div className="flex flex-wrap gap-2">
        {syms.map((s) => (
          <button key={s} onClick={() => pick(s)} className={"cjk w-14 h-14 rounded-xl border text-2xl flex flex-col items-center justify-center leading-none transition " + (sel === s ? "bg-ink text-bg border-ink scale-110" : "bg-card border-line hover:border-ink")}>
            {s}
            <span className={"text-[10px] mt-1 font-sans " + (sel === s ? "text-bg/70" : "text-muted")}>{PINYIN_OF[s] ?? ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
