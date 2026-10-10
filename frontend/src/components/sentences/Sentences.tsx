"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ttsUrl, type Sentence, type TextItem } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { PlayButton } from "@/components/PlayButton";
import { Kbd } from "@/components/shell/Kbd";
import { ZhuyinText, type Annot } from "@/components/ZhuyinText";

const TOPICS = ["Language exchange call", "Introducing myself", "Coffee shop", "Night market food", "MRT and buses", "Shopping", "Weather", "Hobbies", "Work", "Family", "Travel in Taiwan", "Making plans", "At the doctor", "Feelings", "Daily routine"];
const ANNOTS: Annot[] = ["zhuyin", "pinyin", "none"];

export function Sentences() {
  const router = useRouter();
  const [topic, setTopic] = useState("Language exchange call");
  const [custom, setCustom] = useState("");
  const [level, setLevel] = useState("beginner");
  const [count, setCount] = useState(5);
  const [useProfile, setUseProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<Sentence[]>([]);
  const [library, setLibrary] = useState<Sentence[]>([]);
  const [annot, setAnnot] = useState<Annot>("zhuyin");
  const [showEn, setShowEn] = useState(true);
  const [lookup, setLookup] = useState("");
  const [looked, setLooked] = useState<{ text: string; items: TextItem[]; english?: string; words?: { text: string; english: string }[] } | null>(null);
  const [sel, setSel] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const topicRef = useRef<HTMLInputElement>(null);
  const lookupRef = useRef<HTMLInputElement>(null);

  const refresh = () => api.sentences().then((r) => setLibrary(r.sentences)).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  const generate = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.generate(custom.trim() || topic, level, count, useProfile);
      setFresh(r.sentences);
      setSel(0);
      refresh();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const doLookup = async () => {
    const t = lookup.trim();
    if (!t) return;
    setError("");
    try {
      const r = await api.analyzeText(t);
      setLooked({ text: t, items: r.items });
      playAudio(ttsUrl(t));
      api.translate(t).then((tr) => setLooked((cur) => (cur?.text === t ? { ...cur, ...tr } : cur))).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: number) => { await api.deleteSentence(id); setFresh((f) => f.filter((s) => s.id !== id)); refresh(); };

  const freshIds = new Set(fresh.map((s) => s.id));
  const list = [...fresh, ...library.filter((s) => !freshIds.has(s.id))];
  const at = Math.max(0, Math.min(sel, list.length - 1));
  const cur = list[at];
  useHotkeys("sentences", [
    { keys: ["ArrowDown", "KeyJ"], label: "Next sentence", run: () => setSel(Math.min(list.length - 1, at + 1)), when: list.length > 0, repeat: true, bar: false },
    { keys: ["ArrowUp", "KeyK"], label: "Previous sentence", run: () => setSel(Math.max(0, at - 1)), when: list.length > 0, repeat: true, bar: false },
    { keys: [], label: "Choose", show: ["↑", "↓"], when: list.length > 0 },
    { keys: ["Space"], label: "Listen", run: () => cur && playAudio(ttsUrl(cur.hanzi)), when: !!cur },
    { keys: ["Shift+Space"], label: "Slow", run: () => cur && playAudio(ttsUrl(cur.hanzi, -35)), when: !!cur, bar: false },
    { keys: ["KeyS"], label: "Speak it", run: () => cur && router.push("/speaking?sentence=" + cur.id), when: !!cur },
    { keys: ["KeyW"], label: "Write the words", run: () => cur && router.push("/writing?sentence=" + cur.id), when: !!cur },
    { keys: ["KeyO"], label: "Words", run: () => cur && setOpenId(openId === cur.id ? null : cur.id), when: !!cur, bar: false },
    { keys: ["KeyN"], label: "New topic", run: () => topicRef.current?.focus() },
    { keys: ["KeyL"], label: "Look up", run: () => lookupRef.current?.focus(), bar: false },
    { keys: ["Ctrl+Enter"], label: "Generate", run: generate, when: !busy, input: true },
    { keys: ["KeyZ"], label: "Bopomofo, Pinyin, or none", run: () => setAnnot(ANNOTS[(ANNOTS.indexOf(annot) + 1) % ANNOTS.length]), bar: false },
    { keys: ["KeyE"], label: showEn ? "Hide English" : "Show English", run: () => setShowEn(!showEn), bar: false },
    ...cycleKeys("Topic", TOPICS, topic, (t) => { setTopic(t); setCustom(""); }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-4 md:p-5 flex flex-col gap-4">
        <div className="chips flex flex-wrap gap-2">
          {TOPICS.map((t) => <button key={t} className="chip" data-active={!custom && topic === t} onClick={() => { setTopic(t); setCustom(""); }}>{t}</button>)}
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <input ref={topicRef} className="input flex-1 min-w-60" placeholder="Or type any topic, e.g. talking about my job in Paris  (N)" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} />
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} sentences</option>)}
          </select>
          <button className="btn btn-accent" onClick={generate} disabled={busy}>{busy ? "Writing sentences…" : <>Generate <Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></>}</button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} />
          Use my real data from <Link href="/profile" className="underline text-ink">my profile</Link>
        </label>
        {error && <div className="text-bad text-sm">{error}</div>}
      </div>

      <div className="card p-4 md:p-5 flex flex-col gap-3">
        <div className="font-medium">Quick lookup</div>
        <div className="flex gap-2">
          <input ref={lookupRef} className="input flex-1 cjk text-lg" placeholder="Paste or type Chinese (e.g. what your partner just said)  (L)" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLookup()} />
          <button className="btn btn-primary" onClick={doLookup}>Show Bopomofo</button>
        </div>
        {looked && (
          <div className="flex flex-col gap-2 pt-2">
            <ZhuyinText items={looked.items} annot={annot} size={44} onSyllable={(i) => { const s = looked.items.filter((x) => x.type === "syllable")[i]; if (s?.type === "syllable") playAudio(ttsUrl(s.char)); }} />
            <div className="text-muted">{looked.english ?? "Translating…"}</div>
            {looked.words && <Words words={looked.words} />}
            <div className="flex gap-2">
              <PlayButton src={ttsUrl(looked.text)} label="Listen" />
              <PlayButton src={ttsUrl(looked.text, -35)} label="Slow" />
              <Link className="btn" href={"/speaking?text=" + encodeURIComponent(looked.text)}>Practice saying it</Link>
            </div>
          </div>
        )}
      </div>

      <div className="chips flex items-center gap-2 text-sm whitespace-nowrap">
        <span className="text-muted mr-1">Show:</span>
        {ANNOTS.map((a) => <button key={a} className="chip" data-active={annot === a} onClick={() => setAnnot(a)}>{a === "zhuyin" ? "注音" : a === "pinyin" ? "Pinyin" : "Characters only"}</button>)}
        <Kbd>Z</Kbd>
        <button className="chip ml-2" data-active={showEn} onClick={() => setShowEn(!showEn)}>English</button>
        <Kbd>E</Kbd>
      </div>

      {fresh.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">New sentences</h2>
          {fresh.map((s, i) => <SentenceCard key={s.id} s={s} annot={annot} showEn={showEn} onDelete={remove} selected={i === at} onSelect={() => setSel(i)} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} />)}
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Library <span className="text-muted font-normal">({library.length})</span></h2>
        {!library.length && <div className="text-muted text-sm">Your generated sentences are saved here.</div>}
        {list.slice(fresh.length).map((s, i) => <SentenceCard key={s.id} s={s} annot={annot} showEn={showEn} onDelete={remove} selected={fresh.length + i === at} onSelect={() => setSel(fresh.length + i)} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} />)}
      </section>
    </div>
  );
}

function Words({ words }: { words: { text: string; english: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {words.map((w, i) => (
        <button key={i} onClick={() => playAudio(ttsUrl(w.text))} className="rounded-lg border border-line bg-bg/60 px-2 py-1 text-sm hover:border-accent">
          <span className="cjk text-base">{w.text}</span> <span className="text-muted">{w.english}</span>
        </button>
      ))}
    </div>
  );
}

function SentenceCard({ s, annot, showEn, onDelete, selected, onSelect, open, onToggle }: {
  s: Sentence; annot: Annot; showEn: boolean; onDelete: (id: number) => void; selected: boolean; onSelect: () => void; open: boolean; onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Scroll only when the selection moves to this card, not when the page opens.
  const was = useRef(selected);
  useEffect(() => {
    if (selected && !was.current) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    was.current = selected;
  }, [selected]);
  return (
    <div ref={ref} onMouseDown={onSelect} className={"card p-4 md:p-5 flex flex-col gap-3 transition " + (selected ? "md:!border-accent md:ring-2 md:ring-accent/30" : "")}>
      <div className="flex items-start gap-4">
        <PlayButton src={ttsUrl(s.hanzi)} title="Listen" className="shrink-0" />
        <div className="flex-1 min-w-0">
          <ZhuyinText items={s.items} annot={annot} size={40} onSyllable={(i) => { const x = s.items.filter((y) => y.type === "syllable")[i]; if (x?.type === "syllable") playAudio(ttsUrl(x.char)); }} />
          {showEn && <div className="text-muted mt-2">{s.english}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PlayButton src={ttsUrl(s.hanzi, -35)} label="Slow" />
        <Link className="btn" href={"/speaking?sentence=" + s.id}>Practice speaking {selected && <Kbd>S</Kbd>}</Link>
        <Link className="btn" href={"/writing?sentence=" + s.id}>Write the words {selected && <Kbd>W</Kbd>}</Link>
        <button className="btn" onClick={onToggle}>{open ? "Hide words" : "Words"} {selected && <Kbd>O</Kbd>}</button>
        <span className="text-xs text-muted ml-auto">{s.topic} · {s.level}</span>
        <button className="text-xs text-muted hover:text-bad" onClick={() => onDelete(s.id)}>Delete</button>
      </div>
      {open && <Words words={s.words} />}
    </div>
  );
}
