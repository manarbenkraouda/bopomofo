"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ttsUrl, type Sentence, type TextItem } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { PHONE, useViewport } from "@/lib/useFit";
import { PlayButton } from "@/components/PlayButton";
import { Kbd } from "@/components/shell/Kbd";
import { ZhuyinText, type Annot } from "@/components/ZhuyinText";
import { Segmented } from "@/components/stats/charts";

const TOPICS = ["Language exchange call", "Introducing myself", "Coffee shop", "Night market food", "MRT and buses", "Shopping", "Weather", "Hobbies", "Work", "Family", "Travel in Taiwan", "Making plans", "At the doctor", "Feelings", "Daily routine"];
const LEVELS = [{ id: "beginner", label: "Beginner" }, { id: "intermediate", label: "Intermediate" }, { id: "advanced", label: "Advanced" }];
const COUNTS = [3, 5, 8, 10];
const ANNOTS: Annot[] = ["zhuyin", "pinyin", "none"];
const CJK = /[\u3400-\u9fff]/;
const NEW = "__new", UNSAID = "__unsaid", ALL = "__all";

type Looked = { text: string; items: TextItem[]; english?: string; words?: { text: string; english: string }[] };
const scoreTone = (n: number) => (n >= 85 ? "text-ok bg-ok/15" : n >= 60 ? "text-rough bg-rough/15" : "text-bad bg-bad/15");
const sayWord = (t: string) => playAudio(ttsUrl(t));
/** Topics typed by hand can differ only in case ("Complete introduction", "complete introduction"): they are one topic. */
const topicKey = (t: string) => t.trim().toLowerCase();
const topicName = (t: string) => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);
const hearSyllable = (items: TextItem[], i: number) => { const s = items.filter((x) => x.type === "syllable")[i]; if (s?.type === "syllable") sayWord(s.char); };

/**
 * The sentence library. A summary card with the two main actions (new sentences, look up), one search field that also looks up
 * any Chinese text, the sentences grouped by topic with how well each one was said, and the selected sentence in detail:
 * a side panel on a wide screen, a bottom sheet on a phone. New sentences are written in a composer sheet.
 */
export function Sentences() {
  const router = useRouter();
  const [library, setLibrary] = useState<Sentence[] | null>(null);
  const [fresh, setFresh] = useState<number[]>([]);
  const [hidden, setHidden] = useState<number[]>([]); // deleted, waiting for the undo time to pass
  const [filter, setFilter] = useState(ALL);
  const [query, setQuery] = useState("");
  const [looked, setLooked] = useState<Looked | null>(null);
  const [annot, setAnnot] = useState<Annot>("zhuyin");
  const [showEn, setShowEn] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false); // phone: the detail bottom sheet
  const [composer, setComposer] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]);
  const [custom, setCustom] = useState("");
  const [level, setLevel] = useState("beginner");
  // Start at the level given in the onboarding (the learner can still change it here).
  useEffect(() => { api.me().then((m) => setLevel((l) => (l === "beginner" ? m.sentence_level : l))).catch(() => {}); }, []);
  const [count, setCount] = useState(5);
  const [useProfile, setUseProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; id: number; undo?: () => void } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const topicRef = useRef<HTMLInputElement>(null);
  const pending = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const { w: vw } = useViewport();
  const wide = vw >= 1024;
  const phone = vw < PHONE;

  const refresh = () => api.sentences().then((r) => setLibrary(r.sentences)).catch((e) => { setLibrary((l) => l ?? []); setError(e.message); });
  useEffect(() => { refresh(); }, []);
  // Deletes wait 5 s for an undo. Leaving the page deletes at once.
  useEffect(() => { const p = pending.current; return () => { for (const [id, t] of p) { clearTimeout(t); api.deleteSentence(id).catch(() => {}); } }; }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.undo ? 5000 : 2200); return () => clearTimeout(t); }, [toast]);
  const say = (text: string, undo?: () => void) => setToast((t) => ({ text, undo, id: (t?.id ?? 0) + 1 }));

  const all = useMemo(() => (library ?? []).filter((s) => !hidden.includes(s.id)), [library, hidden]);
  const topics = useMemo(() => {
    const m = new Map<string, Sentence[]>();
    for (const s of all) m.set(topicKey(s.topic), [...(m.get(topicKey(s.topic)) ?? []), s]);
    return [...m.entries()].sort((a, b) => Math.max(...b[1].map((s) => s.created)) - Math.max(...a[1].map((s) => s.created)));
  }, [all]);
  const unsaid = all.filter((s) => !s.practice).length;
  const q = query.trim().toLowerCase();
  const shown = all.filter((s) =>
    (filter === ALL || (filter === NEW ? fresh.includes(s.id) : filter === UNSAID ? !s.practice : topicKey(s.topic) === filter)) &&
    (!q || s.hanzi.includes(query.trim()) || s.english.toLowerCase().includes(q) || s.topic.toLowerCase().includes(q) ||
      s.items.some((i) => i.type === "syllable" && i.pinyin.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q))));
  // Groups: the new sentences first, then one group per topic, the most recent topic first. Inside a group, the order they were written in.
  const groups: { title: string; sub: string; list: Sentence[] }[] = [];
  const freshShown = shown.filter((s) => fresh.includes(s.id));
  if (freshShown.length) groups.push({ title: "Just written", sub: topicName(freshShown[0].topic), list: freshShown.sort((a, b) => a.id - b.id) });
  for (const [t, members] of topics) {
    const l = shown.filter((s) => topicKey(s.topic) === t && !fresh.includes(s.id)).sort((a, b) => a.id - b.id);
    if (!l.length) continue;
    const levels = [...new Set(l.map((s) => s.level))];
    groups.push({ title: topicName(members[0].topic), sub: levels.length === 1 ? levels[0] : levels.join(", "), list: l });
  }
  const flat = groups.flatMap((g) => g.list);
  const cur = flat.find((s) => s.id === selId) ?? (wide ? flat[0] : undefined);
  const at = cur ? flat.indexOf(cur) : -1;
  const select = (s: Sentence | undefined, open = true) => { if (!s) return; setSelId(s.id); if (open && !wide) setSheet(true); };

  const generate = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.generate(custom.trim() || topic, level, count, useProfile);
      await refresh();
      setFresh(r.sentences.map((s) => s.id));
      setFilter(ALL);
      setQuery("");
      setComposer(false);
      if (r.sentences[0]) setSelId(r.sentences[0].id);
      say(r.sentences.length + " new sentence" + (r.sentences.length === 1 ? "" : "s"));
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const lookUp = async (text = query) => {
    const t = text.trim();
    if (!t || !CJK.test(t)) return;
    setError("");
    try {
      const r = await api.analyzeText(t);
      setLooked({ text: t, items: r.items });
      setQuery(""); // the look-up card holds the text; the whole library shows again under it
      playAudio(ttsUrl(t));
      api.translate(t).then((tr) => setLooked((c) => (c?.text === t ? { ...c, ...tr } : c))).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  };
  const remove = (s: Sentence) => {
    const i = flat.indexOf(s);
    setHidden((h) => [...h, s.id]);
    setSheet(false);
    setSelId(flat[i + 1]?.id ?? flat[i - 1]?.id ?? null);
    const t = setTimeout(() => { pending.current.delete(s.id); api.deleteSentence(s.id).then(refresh).catch(() => {}); }, 5000);
    pending.current.set(s.id, t);
    say("Sentence deleted", () => { clearTimeout(t); pending.current.delete(s.id); setHidden((h) => h.filter((x) => x !== s.id)); setSelId(s.id); setToast(null); });
  };

  const filters = [ALL, ...(fresh.length ? [NEW] : []), ...(unsaid ? [UNSAID] : []), ...topics.map(([t]) => t)];
  useHotkeys("sentences", [
    { keys: ["ArrowDown", "KeyJ"], label: "Next sentence", run: () => select(flat[Math.min(flat.length - 1, at + 1)], false), when: flat.length > 0 && !composer, repeat: true, bar: false },
    { keys: ["ArrowUp", "KeyK"], label: "Previous sentence", run: () => select(flat[Math.max(0, at - 1)], false), when: flat.length > 0 && !composer, repeat: true, bar: false },
    { keys: [], label: "Choose", show: ["↑", "↓"], when: flat.length > 0 && !composer },
    { keys: ["Space"], label: "Listen", run: () => cur && playAudio(ttsUrl(cur.hanzi)), when: !!cur && !composer },
    { keys: ["Shift+Space"], label: "Slow", run: () => cur && playAudio(ttsUrl(cur.hanzi, -35)), when: !!cur && !composer, bar: false },
    { keys: ["KeyS"], label: "Speak it", run: () => cur && router.push("/speaking?sentence=" + cur.id), when: !!cur && !composer },
    { keys: ["KeyW"], label: "Write the words", run: () => cur && router.push("/writing?sentence=" + cur.id), when: !!cur && !composer },
    { keys: ["KeyN"], label: "New sentences", run: () => { setComposer(true); setSheet(false); }, when: !composer },
    { keys: ["Slash", "KeyL"], label: "Search or look up", run: () => searchRef.current?.focus(), when: !composer, bar: false },
    { keys: ["Delete"], label: "Delete", run: () => cur && remove(cur), when: !!cur && !composer, bar: false },
    { keys: ["Escape"], label: "Close", run: () => { setComposer(false); setSheet(false); }, when: composer || sheet, input: true },
    { keys: ["Ctrl+Enter"], label: "Write them", run: generate, when: composer && !busy, input: true },
    { keys: ["KeyZ"], label: "Bopomofo, Pinyin, or none", run: () => setAnnot(ANNOTS[(ANNOTS.indexOf(annot) + 1) % ANNOTS.length]), bar: false },
    { keys: ["KeyE"], label: showEn ? "Hide English" : "Show English", run: () => setShowEn(!showEn), bar: false },
    ...(composer ? cycleKeys("Topic", TOPICS, topic, (t) => { setTopic(t); setCustom(""); }) : cycleKeys("Filter", filters, filter, setFilter)),
  ]);

  const said = all.filter((s) => s.practice);
  const avgBest = said.length ? Math.round(said.reduce((a, s) => a + (s.practice?.best ?? 0), 0) / said.length) : null;
  const filterLabel = (f: string) => (f === ALL ? "All" : f === NEW ? "Just written" : f === UNSAID ? "Not said yet" : topicName(topics.find(([k]) => k === f)?.[1][0].topic ?? f));
  const filterCount = (f: string) => (f === ALL ? all.length : f === NEW ? fresh.filter((id) => all.some((s) => s.id === id)).length : f === UNSAID ? unsaid : all.filter((s) => topicKey(s.topic) === f).length);

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card relative overflow-hidden p-5 md:p-6">
        <div className="pointer-events-none absolute -bottom-12 -right-3 select-none cjk text-[180px] leading-none text-accent opacity-[.06] md:right-[24%]">句</div>
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:gap-8">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">Your sentences</div>
            <h1 className="mt-1 text-xl font-semibold leading-snug md:text-2xl">
              {library === null ? "Loading…" : !all.length ? "Write your first sentences about your life."
                : unsaid ? said.length + " of " + all.length + " said aloud. " + unsaid + " are waiting for your voice."
                : "You have said every sentence aloud."}
            </h1>
            <div className="mt-4 grid grid-cols-3 gap-4 sm:max-w-md">
              {([[all.length, "sentences"], [topics.length, "topics"], [avgBest ?? "–", "best score, avg"]] as const).map(([v, l]) => (
                <div key={l}><div className="text-2xl font-semibold tabular-nums md:text-3xl">{v}</div><div className="text-xs text-muted">{l}</div></div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 md:flex-col md:items-stretch">
            <button className="btn btn-accent flex-1 justify-center !py-2.5" onClick={() => { setComposer(true); setSheet(false); }}>＋ New sentences <Kbd className="max-md:!hidden">N</Kbd></button>
            {unsaid > 0 && (
              <button className="btn flex-1 justify-center !py-2.5" onClick={() => { const s = all.find((x) => !x.practice); if (s) router.push("/speaking?sentence=" + s.id); }}>
                說 Say the next<span className="max-md:hidden">&nbsp;one</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {composer && (
        <>
          <div className="m-sheet-backdrop" onClick={() => !busy && setComposer(false)} />
          <section data-open className="m-sheet card flex flex-col gap-4 p-5 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">New sentences</h2>
                <p className="text-sm text-muted">Pick a topic or type your own. They are saved to your library.</p>
              </div>
              <button className="icon-btn !h-9 !w-9 text-lg" onClick={() => setComposer(false)} aria-label="Close" disabled={busy}>✕</button>
            </div>
            <div className="chips flex gap-1.5 max-lg:flex-nowrap max-lg:overflow-x-auto lg:flex-wrap">
              {TOPICS.map((t) => <button key={t} className="chip shrink-0" data-active={!custom && topic === t} onClick={() => { setTopic(t); setCustom(""); }}>{t}</button>)}
            </div>
            <input ref={topicRef} className="input w-full" placeholder="Or your own topic, e.g. my job" value={custom}
              onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") generate(); }} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex flex-col gap-1"><span className="text-xs text-muted">Level</span><Segmented options={LEVELS} value={level} onChange={setLevel} /></div>
              <div className="flex flex-col gap-1"><span className="text-xs text-muted">How many</span><Segmented options={COUNTS.map((n) => ({ id: n, label: String(n) }))} value={count} onChange={setCount} /></div>
              <label className="flex cursor-pointer items-center gap-3 self-end py-1.5">
                <button type="button" role="switch" aria-checked={useProfile} onClick={() => setUseProfile(!useProfile)}
                  className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (useProfile ? "bg-accent" : "bg-line")}>
                  <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " + (useProfile ? "left-[22px]" : "left-0.5")} />
                </button>
                <span className="text-sm">About my life <Link href="/profile" className="text-muted underline">profile</Link></span>
              </label>
            </div>
            {error && <div className="text-sm text-bad">{error}</div>}
            <button className="btn btn-accent justify-center !py-3 text-base" onClick={generate} disabled={busy}>
              {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Writing {count} sentences about {custom.trim() || topic}…</>
                : <>Write {count} sentences <Kbd className="max-md:!hidden">Ctrl</Kbd><Kbd className="max-md:!hidden">Enter</Kbd></>}
            </button>
          </section>
        </>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-72">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">⌕</span>
            <input ref={searchRef} className="input w-full !rounded-full !pl-9 !pr-24" placeholder="Search or paste Chinese" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") lookUp(); if (e.key === "Escape") { setQuery(""); (e.target as HTMLInputElement).blur(); } }} />
            {CJK.test(query) ? (
              <button className="btn btn-primary absolute right-1 top-1/2 -translate-y-1/2 !rounded-full !px-3 !py-1 text-sm" onClick={() => lookUp()}>Look up ↵</button>
            ) : <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 max-md:hidden"><Kbd>/</Kbd></span>}
          </div>
          <Segmented options={[{ id: "zhuyin" as Annot, label: <span className="cjk">注音</span> }, { id: "pinyin" as Annot, label: "Pinyin" }, { id: "none" as Annot, label: <span className="cjk">字</span> }]} value={annot} onChange={setAnnot} />
          <button className="chip !py-1.5" data-active={showEn} onClick={() => setShowEn(!showEn)}>English</button>
        </div>
        {all.length > 0 && (
          <div className="chips flex gap-1.5 overflow-x-auto max-md:-mx-4 max-md:px-4">
            {filters.map((f) => (
              <button key={f} className="chip flex shrink-0 items-center gap-1.5" data-active={filter === f} onClick={() => setFilter(f)}>
                {f === UNSAID && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}{filterLabel(f)}<span className="text-[11px] tabular-nums opacity-60">{filterCount(f)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {looked && (
        <section className="card relative overflow-hidden border-accent/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">Look up</div>
            <button className="text-muted hover:text-ink" onClick={() => setLooked(null)} aria-label="Close">✕</button>
          </div>
          <div className="mt-2"><ZhuyinText items={looked.items} annot={annot === "none" ? "zhuyin" : annot} size={phone ? 32 : 42} onSyllable={(i) => hearSyllable(looked.items, i)} /></div>
          <div className="mt-2 text-muted">{looked.english ?? "Translating…"}</div>
          {looked.words && <div className="mt-3"><Words words={looked.words} /></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <PlayButton src={ttsUrl(looked.text)} label="Listen" />
            <PlayButton src={ttsUrl(looked.text, -35)} label="Slow" />
            <Link className="btn btn-accent" href={"/speaking?text=" + encodeURIComponent(looked.text)}>說 Practice saying it</Link>
          </div>
        </section>
      )}

      {library !== null && !all.length ? (
        <section className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="cjk text-5xl text-accent">句</div>
          <div className="font-semibold">No sentences yet</div>
          <p className="max-w-sm text-sm text-muted">Pick a topic and the app writes short Taiwan Mandarin sentences about your life, with Bopomofo, audio, and word glosses.</p>
          <button className="btn btn-accent" onClick={() => setComposer(true)}>＋ New sentences</button>
        </section>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-5">
            {!flat.length && library !== null && <div className="card p-6 text-sm text-muted">Nothing matches{query ? " “" + query + "”" : ""}. {CJK.test(query) ? "Press Enter to look it up." : ""}</div>}
            {groups.map((g) => (
              <section key={g.title}>
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <h2 className={"font-semibold " + (g.title === "Just written" ? "text-accent" : "")}>{g.title}</h2>
                  <span className="truncate text-sm text-muted">· {g.sub} · {g.list.length}</span>
                </div>
                <div className="card divide-y divide-line overflow-hidden">
                  {g.list.map((s) => <Row key={s.id} s={s} annot={annot} showEn={showEn} active={cur?.id === s.id} fresh={fresh.includes(s.id)} small={phone} onOpen={() => select(s)} />)}
                </div>
              </section>
            ))}
          </div>
          {cur && (
            <>
              {sheet && !wide && <div className="m-sheet-backdrop" onClick={() => setSheet(false)} />}
              <aside data-open={sheet} className="m-sheet card p-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-150px)] lg:overflow-y-auto">
                <Detail s={cur} annot={annot} onClose={() => setSheet(false)} onDelete={() => remove(cur)} phone={phone} />
              </aside>
            </>
          )}
        </div>
      )}

      {toast && (
        <div key={toast.id} role="status" className="app-toast fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg shadow-lg">
          {toast.text}
          {toast.undo && <button className="font-semibold text-accent" onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function Row({ s, annot, showEn, active, fresh, small, onOpen }: { s: Sentence; annot: Annot; showEn: boolean; active: boolean; fresh: boolean; small: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(active);
  useEffect(() => { if (active && !was.current) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); was.current = active; }, [active]);
  const p = s.practice;
  return (
    <div ref={ref} role="button" tabIndex={-1} onClick={onOpen}
      className={"group flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors md:px-4 " + (active ? "bg-accent-soft/50 lg:shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-raise")}>
      <span onClick={(e) => e.stopPropagation()}><PlayButton src={ttsUrl(s.hanzi)} title="Listen" className="!h-9 !w-9 shrink-0 !rounded-full !p-0 justify-center" /></span>
      <div className="min-w-0 flex-1">
        <ZhuyinText items={s.items} annot={annot} size={small ? 22 : 26} />
        {showEn && <div className="mt-1 truncate text-sm text-muted">{s.english}</div>}
      </div>
      {p ? <span className={"shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums " + scoreTone(p.best)} title={"Said " + p.said + " times · best " + p.best}>{p.best}</span>
        : fresh ? <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">New</span>
        : <span className="h-2 w-2 shrink-0 rounded-full bg-accent/70" title="Not said yet" />}
      <span className="shrink-0 text-lg leading-none text-muted opacity-40 group-hover:opacity-100 lg:hidden">›</span>
    </div>
  );
}

function Detail({ s, annot, onClose, onDelete, phone }: { s: Sentence; annot: Annot; onClose: () => void; onDelete: () => void; phone: boolean }) {
  const p = s.practice;
  return (
    <div className="flex flex-col gap-4">
      <div className="m-sheet-head -mb-2 flex items-center justify-between">
        <span className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <button className="icon-btn absolute right-4 top-4 !h-9 !w-9 text-lg" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{topicName(s.topic)}</span>
        <span className="rounded-full bg-raise px-2 py-0.5 text-muted">{s.level}</span>
        <span className="text-muted">{new Date(s.created * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
      </div>
      <div><ZhuyinText items={s.items} annot={annot === "none" ? "zhuyin" : annot} size={phone ? 34 : 40} onSyllable={(i) => hearSyllable(s.items, i)} /></div>
      <div className="-mt-1 text-[15px] text-muted">{s.english}</div>
      <div className="flex gap-2">
        <PlayButton src={ttsUrl(s.hanzi)} label="Listen" className="flex-1 justify-center" />
        <PlayButton src={ttsUrl(s.hanzi, -35)} label="Slow" className="flex-1 justify-center" />
      </div>
      {s.words.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Words · tap to hear</div>
          <Words words={s.words} />
        </div>
      )}
      <div className="rounded-xl bg-raise p-3">
        {p ? (
          <div className="flex items-center gap-3">
            <span className={"grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums " + scoreTone(p.best)}>{p.best}</span>
            <div className="text-sm">
              <div className="font-medium">Best score {p.best}</div>
              <div className="text-muted">Said {p.said} time{p.said === 1 ? "" : "s"} · last {p.last}</div>
            </div>
          </div>
        ) : <div className="text-sm text-muted">Not said aloud yet. Your first recording sets the score.</div>}
      </div>
      <div className="flex flex-col gap-2">
        <Link className="btn btn-accent justify-center !py-2.5" href={"/speaking?sentence=" + s.id}>說 Practice speaking <Kbd className="max-md:!hidden">S</Kbd></Link>
        <Link className="btn justify-center !py-2.5" href={"/writing?sentence=" + s.id}>寫 Write the words <Kbd className="max-md:!hidden">W</Kbd></Link>
        <button className="mt-1 self-center text-xs text-muted hover:text-bad" onClick={onDelete}>Delete this sentence</button>
      </div>
    </div>
  );
}

function Words({ words }: { words: { text: string; english: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.map((w, i) => (
        <button key={i} onClick={() => sayWord(w.text)} className="flex items-baseline gap-1.5 rounded-xl border border-line bg-bg/60 px-2.5 py-1.5 text-sm transition hover:border-accent">
          <span className="cjk text-base">{w.text}</span><span className="text-muted">{w.english}</span>
        </button>
      ))}
    </div>
  );
}


