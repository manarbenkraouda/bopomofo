"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ttsUrl, type Health, type Sentence, type SpeechResult, type Syl, type TextItem } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, matches, useFocus, type Focus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { Recorder } from "@/lib/recorder";
import { playSfx } from "@/lib/sfx";
import { loadData, syllableAudio, TONE_NAME, type SyllableItem } from "@/lib/zhuyin";
import { PlayButton } from "@/components/PlayButton";
import { ActionBar } from "@/components/shell/ActionBar";
import { PHONE, useViewport } from "@/lib/useFit";
import { PitchChart } from "@/components/PitchChart";
import { ZhuyinText, type Annot } from "@/components/ZhuyinText";
import { FxFrame, StatusPill, useCountUp, type FxStatus } from "@/components/quiz/Feedback";
import { Kbd } from "@/components/shell/Kbd";

type Source = "sentence" | "syllable" | "custom";
type Target = { text: string; items: TextItem[]; english?: string; audio: string; slow?: string };
const grade = (score: number): FxStatus => (score >= 85 ? "right" : score >= 60 ? "close" : "wrong");
const SOURCES: Source[] = ["sentence", "syllable", "custom"];
const ANNOTS: Annot[] = ["zhuyin", "pinyin", "none"];
/** For speaking, a tone focus means the tone as said (after tone changes). */
const sylMatch = (i: Syl, f: Focus) => (!f.tones.length || f.tones.includes(i.surface_tone)) && (!f.syms.length || f.syms.some((x) => (i.initial + i.final).includes(x)));

export function SpeakingPractice() {
  const [health, setHealth] = useState<Health | null>(null);
  const [source, setSource] = useState<Source>("sentence");
  const [allSentences, setSentences] = useState<Sentence[]>([]);
  const [allSylls, setSylls] = useState<SyllableItem[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [annot, setAnnot] = useState<Annot>("zhuyin");
  const [custom, setCustom] = useState("");
  const [rec, setRec] = useState<"idle" | "recording" | "analyzing">("idle");
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [listOpen, setListOpen] = useState(false); // phone and tablet: the list is a bottom sheet
  const { w: vw } = useViewport();
  const [fxKey, setFxKey] = useState(0);
  const [session, setSession] = useState({ streak: 0, best: 0 });
  const recorder = useRef<Recorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The focus from the stats screen (?tones=3 or ?syms=ㄓ) narrows both lists. With no match, the full list stays.
  const focus = useFocus();
  const sourceParam = useSearchParams().get("source");
  // Coach sentences (?ids=) come in the coach's order. Other focus filters keep the sentences that contain the tone or sound.
  const fSent = useMemo(() => (focus.ids.length ? focus.ids.map((id) => allSentences.find((s) => s.id === id)).filter((s): s is Sentence => !!s)
    : focus.active ? allSentences.filter((s) => s.items.some((i) => i.type === "syllable" && sylMatch(i, focus))) : allSentences), [allSentences, focus]);
  const fSyl = useMemo(() => allSylls.filter((s) => matches(s.zhuyin, focus)), [allSylls, focus]);
  const sentences = fSent.length ? fSent : allSentences;
  const sylls = fSyl.length ? fSyl : allSylls;

  useEffect(() => {
    const poll = () => api.health().then((h) => { setHealth(h); if (h.speech_model === "loading") setTimeout(poll, 2000); }).catch(() => setHealth(null));
    poll();
    loadData().then((d) => setSylls(d.syllables));
    const q = new URLSearchParams(window.location.search);
    api.sentences().then((r) => {
      setSentences(r.sentences);
      if (q.get("source") === "syllable") return;
      const sid = Number(q.get("sentence"));
      const s = r.sentences.find((x) => x.id === sid) ?? (q.get("text") ? undefined : r.sentences[0]);
      if (s) chooseSentence(s);
    }).catch((e) => setError(String(e.message ?? e)));
    const t = q.get("text");
    if (t) { setSource("custom"); setCustom(t); applyText(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A link with ?source= picks the list, and with a focus it starts on a random matching item.
  useEffect(() => {
    if (sourceParam !== "sentence" && sourceParam !== "syllable") return;
    setSource(sourceParam);
    if (!focus.active || recorder.current) return;
    if (sourceParam === "syllable" && fSyl.length) chooseSyllable(fSyl[Math.floor(Math.random() * fSyl.length)]);
    if (sourceParam === "sentence" && fSent.length) chooseSentence(fSent[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceParam, focus, allSylls.length > 0, allSentences.length > 0]);

  const reset = () => { setResult(null); setError(""); if (mine) URL.revokeObjectURL(mine); setMine(null); };
  const celebrate = (r: SpeechResult) => {
    const g = grade(r.score);
    playSfx(g === "right" ? "right" : g === "close" ? "close" : "wrong");
    setFxKey((k) => k + 1);
    setSession((s) => ({ streak: g === "right" ? s.streak + 1 : 0, best: Math.max(s.best, r.score) }));
  };
  const chooseSentence = (s: Sentence) => { reset(); setListOpen(false); setTarget({ text: s.hanzi, items: s.items, english: s.english, audio: ttsUrl(s.hanzi), slow: ttsUrl(s.hanzi, -35) }); };
  const chooseSyllable = async (s: SyllableItem) => {
    reset();
    setListOpen(false);
    const r = await api.analyzeText(s.char).catch(() => null);
    setTarget({ text: s.char, items: r?.items ?? [], audio: syllableAudio(s.id) });
    playAudio(syllableAudio(s.id));
  };
  async function applyText(t: string) {
    reset();
    setListOpen(false);
    try {
      const r = await api.analyzeText(t.trim());
      setTarget({ text: t.trim(), items: r.items, audio: ttsUrl(t.trim()), slow: ttsUrl(t.trim(), -35) });
      api.translate(t.trim()).then((tr) => setTarget((cur) => (cur && cur.text === t.trim() ? { ...cur, english: tr.english } : cur))).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }

  const start = async () => {
    reset();
    try {
      recorder.current = new Recorder();
      recorder.current.onLevel = (v) => setLevel(Math.min(1, v * 8));
      await recorder.current.start();
      setRec("recording");
      timer.current = setTimeout(stop, 15000);
    } catch (e) {
      setError("Microphone not available: " + (e as Error).message);
      setRec("idle");
    }
  };
  const stop = async () => {
    if (timer.current) clearTimeout(timer.current);
    const r = recorder.current;
    if (!r || !target) return;
    recorder.current = null;
    setRec("analyzing");
    const { wav, seconds } = await r.stop();
    setLevel(0);
    setMine(URL.createObjectURL(wav));
    if (seconds < 0.4) { setError("The recording is too short. Hold the button and speak."); setRec("idle"); return; }
    playSfx("tick");
    try {
      const r = await api.speech(wav, target.text, source);
      setResult(r);
      celebrate(r);
      api.health().then(setHealth).catch(() => {});
    } catch (e) { setError((e as Error).message); }
    setRec("idle");
  };
  const upload = async (f: File) => {
    if (!target) return;
    reset();
    setMine(URL.createObjectURL(f));
    setRec("analyzing");
    try { const r = await api.speech(f, target.text, source); setResult(r); celebrate(r); api.health().then(setHealth).catch(() => {}); } catch (e) { setError((e as Error).message); }
    setRec("idle");
  };

  const marks = useMemo(() => result?.syllables.map((s) => (!s.heard ? "#d23f3f" : s.tone_ok && s.initial_ok !== false && s.final_ok !== false ? "#2f9466" : "#d23f3f")), [result]);
  const sets = useMemo(() => {
    const m = new Map<string, SyllableItem[]>();
    for (const s of sylls) { const k = [...s.zhuyin].filter((c) => !"ˊˇˋ˙".includes(c)).join(""); m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [sylls]);

  // Keyboard: move through the list on the left, record, and listen without the mouse.
  const flatSylls = useMemo(() => sets.flatMap(([, items]) => items), [sets]);
  const listLen = source === "sentence" ? sentences.length : source === "syllable" ? flatSylls.length : 0;
  const go = (d: number) => {
    if (rec !== "idle") return;
    if (source === "sentence" && sentences.length) {
      const i = sentences.findIndex((s) => s.hanzi === target?.text);
      const s = sentences[i < 0 ? 0 : Math.max(0, Math.min(sentences.length - 1, i + d))];
      chooseSentence(s);
      playAudio(ttsUrl(s.hanzi));
    } else if (source === "syllable" && flatSylls.length) {
      const i = flatSylls.findIndex((s) => s.char === target?.text);
      chooseSyllable(flatSylls[i < 0 ? 0 : Math.max(0, Math.min(flatSylls.length - 1, i + d))]);
    }
  };
  useEffect(() => { listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "nearest" }); }, [target, source]);
  const canRecord = health?.speech_model === "ready" && !!target && rec !== "analyzing";
  useHotkeys("speaking", [
    { keys: ["KeyR"], label: rec === "recording" ? "Stop" : "Record", run: () => { if (rec === "idle") start(); else if (rec === "recording") stop(); }, when: canRecord },
    { keys: ["Space"], label: "Listen", run: () => target && playAudio(target.audio), when: !!target },
    { keys: ["Shift+Space"], label: "Slow", run: () => target?.slow && playAudio(target.slow), when: !!target?.slow },
    { keys: ["KeyP"], label: "My recording", run: () => mine && playAudio(mine), when: !!mine },
    { keys: ["Enter"], label: "Next", run: () => go(1), when: !!result && listLen > 0 && rec === "idle" },
    { keys: ["ArrowDown", "KeyJ"], label: "Next in the list", run: () => go(1), when: listLen > 0, repeat: true, bar: false },
    { keys: ["ArrowUp", "KeyK"], label: "Previous in the list", run: () => go(-1), when: listLen > 0, repeat: true, bar: false },
    { keys: [], label: "List", show: ["↑", "↓"], when: listLen > 0 },
    { keys: ["KeyZ"], label: "Bopomofo, Pinyin, or none", run: () => setAnnot(ANNOTS[(ANNOTS.indexOf(annot) + 1) % ANNOTS.length]), bar: false },
    { keys: ["KeyU"], label: "Upload a recording", run: () => fileRef.current?.click(), when: !!target && rec === "idle", bar: false },
    { keys: ["Ctrl+Enter"], label: "Practice this text", run: () => applyText(custom), when: source === "custom" && !!custom.trim(), input: true, bar: false },
    ...cycleKeys("Source", SOURCES, source, setSource),
  ]);

  const single = target ? target.items.filter((x) => x.type === "syllable").length === 1 : false;
  const position = source === "sentence" ? sentences.findIndex((s) => s.hanzi === target?.text) : source === "syllable" ? flatSylls.findIndex((s) => s.char === target?.text) : -1;
  const fx: FxStatus = rec === "recording" ? "hearing" : rec === "analyzing" ? "checking" : result ? grade(result.score) : "idle";
  const pillLabel = rec === "recording" ? (vw < PHONE ? "Recording… tap Stop when done" : "Recording… press R to stop") : rec === "analyzing" ? "Analyzing…" : result
    ? (result.score >= 85 ? "Excellent! " : result.score >= 60 ? "Almost: " : "Keep practicing: ") + result.score
    : vw < PHONE ? "Tap Record, then speak" : "Press R to record";

  return (
    <div className="grid lg:grid-cols-[330px_1fr] gap-5 items-start">
      {listOpen && <div className="m-sheet-backdrop" onClick={() => setListOpen(false)} />}
      <aside data-open={listOpen} className="m-sheet card p-4 flex flex-col gap-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-140px)] overflow-hidden">
        <div className="m-sheet-head flex items-center justify-between">
          <span className="font-semibold">Choose what to say</span>
          <button className="icon-btn !h-9 !w-9 text-lg" onClick={() => setListOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["sentence", "syllable", "custom"] as Source[]).map((s) => (
            <button key={s} className="chip" data-active={source === s} onClick={() => setSource(s)}>
              {s === "sentence" ? "My sentences" : s === "syllable" ? "Syllables" : "My own text"}
            </button>
          ))}
          <FocusChip focus={focus} empty={focus.active && (source === "sentence" ? !fSent.length : !fSyl.length)} />
        </div>
        {source === "sentence" && (
          <div ref={listRef} className="overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
            {!sentences.length && <div className="text-sm text-muted">No sentences yet. Create some on the Sentences page.</div>}
            {sentences.map((s) => (
              <button key={s.id} data-current={target?.text === s.hanzi} onClick={() => chooseSentence(s)} className={"text-left rounded-lg px-3 py-2 border " + (target?.text === s.hanzi ? "bg-accent-soft border-accent/50" : "border-transparent hover:bg-raise")}>
                <div className="cjk text-lg leading-snug">{s.hanzi}</div>
                <div className="text-xs text-muted truncate">{s.english}</div>
              </button>
            ))}
          </div>
        )}
        {source === "syllable" && (
          <div ref={listRef} className="overflow-y-auto flex flex-col gap-2">
            <p className="text-xs text-muted">Tone pairs and sets. For one syllable alone, the tone is judged from your pitch curve (an estimate).</p>
            {sets.map(([k, items]) => (
              <div key={k} className="flex flex-wrap gap-1">
                {items.map((s) => (
                  <button key={s.id} data-current={target?.text === s.char} onClick={() => chooseSyllable(s)} className={"chip cjk " + (target?.text === s.char ? "!bg-ink !text-bg" : "")}>{s.char} {s.zhuyin}</button>
                ))}
              </div>
            ))}
          </div>
        )}
        {source === "custom" && (
          <div className="flex flex-col gap-2">
            <textarea className="input cjk text-lg min-h-28" placeholder="輸入中文，例如：你今天過得怎麼樣？" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn btn-primary justify-center" disabled={!custom.trim()} onClick={() => applyText(custom)}>Practice this text <Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></button>
            <p className="text-xs text-muted">Type anything your partner says. You get Bopomofo, audio, a translation, and pronunciation feedback.</p>
          </div>
        )}
      </aside>

      <section className="flex flex-col gap-5 min-w-0">
        {health && health.speech_model !== "ready" && (
          <div className="card p-3 text-sm text-rough">{health.speech_model === "loading" ? "The speech model is loading (a few seconds)…" : "Speech model error: " + health.speech_error}</div>
        )}
        {!health && <div className="card p-3 text-sm text-bad">The backend is not reachable. Start it with start.cmd.</div>}
        {target ? (
          <div className={"card border-2 p-4 md:p-6 flex flex-col gap-4 transition-colors duration-300 " + (fx === "right" ? "border-ok bg-ok/5" : fx === "close" ? "border-rough/70" : fx === "wrong" ? "border-bad/60 bg-bad/5" : fx === "checking" ? "border-rough/70" : fx === "hearing" ? "border-accent/50" : "border-line")}>
            <div className="flex items-center gap-2 lg:hidden">
              <button className="btn !px-4" onClick={() => go(-1)} disabled={!listLen || rec !== "idle"} aria-label="Previous">‹</button>
              <button className="btn flex-1 justify-center" onClick={() => setListOpen(true)}>
                {source === "sentence" ? "My sentences" : source === "syllable" ? "Syllables" : "My own text"}{position >= 0 ? " · " + (position + 1) + "/" + listLen : ""} ▾
              </button>
              <button className="btn !px-4" onClick={() => go(1)} disabled={!listLen || rec !== "idle"} aria-label="Next">›</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={fx} label={pillLabel} />
              <div className="ml-auto flex items-center gap-3 text-sm text-muted">
                <span><b className="text-ink">{session.streak}</b> streak · best <b className="text-ink">{session.best || "–"}</b></span>
              </div>
            </div>
            <div className="chips flex items-center gap-2 text-sm">
              {(["zhuyin", "pinyin", "none"] as Annot[]).map((a) => <button key={a} className="chip" data-active={annot === a} onClick={() => setAnnot(a)}>{a === "zhuyin" ? "注音" : a === "pinyin" ? "Pinyin" : "Characters only"}</button>)}
            </div>
            <div className="py-2 flex">
              <FxFrame status={fx} level={level} attempt={fxKey} round={false}>
              <div className="px-2">
              <ZhuyinText items={target.items} annot={annot} size={single ? 84 : vw < PHONE ? 40 : 52} marks={marks} onSyllable={(i) => {
                const s = target.items.filter((x) => x.type === "syllable")[i];
                if (s && s.type === "syllable") playAudio(ttsUrl(s.char));
              }} />
              </div>
              </FxFrame>
            </div>
            {target.english && <div className="text-muted">{target.english}</div>}
            {single && health && !health.speaker_hz && (
              <div className="text-sm text-rough">Tip: record one full sentence first. The app then learns your voice pitch, which makes single-syllable tone 3 checks more accurate.</div>
            )}
            <ActionBar tone={result ? (fx === "right" ? "ok" : fx === "close" ? "close" : "bad") : null}
              title={result && rec === "idle" ? (result.score >= 85 ? "Excellent! " : result.score >= 60 ? "Almost: " : "Keep practicing: ") + result.score : undefined}
              detail={result && rec === "idle" ? "Tones " + result.syllables.filter((s) => s.tone_ok).length + "/" + result.syllables.length + " correct · details below" : undefined}>
              <PlayButton src={target.audio} label="Listen" />
              {target.slow && <PlayButton src={target.slow} label="Slow" />}
              {mine && <PlayButton src={mine} label={vw < PHONE ? "Mine" : "My recording"} />}
              {result && rec === "idle" && listLen > 0 && <button className="btn md:!hidden" onClick={() => go(1)}>Next ›</button>}
              <div className="flex-1 max-md:!hidden" />
              <label className="btn cursor-pointer" title="Analyze an audio file (wav, mp3, flac, ogg)">
                Upload <Kbd>U</Kbd>
                <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
              </label>
              {rec === "recording" && <div className="w-24 h-2 rounded bg-line overflow-hidden max-md:!hidden"><div className="h-full bg-accent transition-all" style={{ width: Math.round(level * 100) + "%" }} /></div>}
              <button
                onClick={rec === "idle" ? start : rec === "recording" ? stop : undefined}
                disabled={rec === "analyzing" || health?.speech_model !== "ready"}
                className={"btn ab-primary !rounded-full !px-6 !py-3 text-base " + (rec === "recording" ? "btn-accent recording" : "btn-primary")}>
                {rec === "idle" ? <>● {result && vw < PHONE ? "Try again" : "Record"} <Kbd>R</Kbd></> : rec === "recording" ? <>■ Stop <Kbd>R</Kbd></> : "Analyzing…"}
              </button>
            </ActionBar>
            {error && <div className="text-bad text-sm">{error}</div>}
          </div>
        ) : (
          <div className="card p-6 text-muted flex flex-col items-start gap-3">
            Choose something to say from the list.
            <button className="btn btn-primary lg:!hidden" onClick={() => setListOpen(true)}>Choose ▾</button>
          </div>
        )}

        {result && <ResultView key={fxKey} result={result} />}
      </section>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg text-muted">{label} –</span>;
  return <span className={"text-[11px] px-1.5 py-0.5 rounded " + (ok ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad")}>{label} {ok ? "✓" : "✗"}</span>;
}

function ResultView({ result }: { result: SpeechResult }) {
  const tone = result.syllables.filter((s) => s.tone_ok).length;
  const shown = useCountUp(result.score);
  return (
    <div className="card p-6 flex flex-col gap-5">
      <div className="flex items-baseline gap-4 flex-wrap">
        <div className={"text-5xl font-semibold tabular-nums " + (result.score >= 85 ? "text-ok" : result.score >= 60 ? "text-rough" : "text-bad")}>{shown}</div>
        <div className="text-muted">
          score · tones {tone}/{result.syllables.length} correct
          <span className="text-xs ml-2">(analysis {result.timing.infer_seconds}s for {result.timing.audio_seconds}s of audio)</span>
        </div>
      </div>
      <div>
        <div className="text-sm text-muted mb-1">Your pitch (black) against the target tone shapes (colored bands), per syllable</div>
        <PitchChart result={result} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {result.syllables.map((s, i) => {
          const ok = s.heard && s.tone_ok && s.initial_ok !== false && s.final_ok !== false;
          return (
            <button key={i} onClick={() => playAudio(ttsUrl(s.expected.char))} className={"text-left rounded-xl border p-3 hover:shadow-sm " + (ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5")}>
              <div className="flex items-center gap-2 cjk">
                <span className="text-3xl">{s.expected.char}</span>
                <span className="text-accent text-lg">{s.expected.zhuyin}</span>
              </div>
              <div className="text-xs text-muted mt-1 cjk">
                {s.expected.surface_tone !== s.expected.tone ? "said as tone " + s.expected.surface_tone + " here · " : ""}heard: <b className="text-ink">{s.heard?.zhuyin ?? "—"}</b>
              </div>
              <div className="flex gap-1 mt-2 flex-wrap">
                <Badge ok={s.heard ? s.initial_ok : false} label="initial" />
                <Badge ok={s.heard ? s.final_ok : false} label="final" />
                <Badge ok={s.tone_ok} label="tone" />
              </div>
              {s.messages.length > 0 && <ul className="mt-2 text-xs leading-snug list-disc pl-4 cjk">{s.messages.map((m, k) => <li key={k}>{m}</li>)}</ul>}
              {s.tone_source === "pitch" && <div className="text-[11px] text-muted mt-1">Tone judged from pitch (estimate).</div>}
              {s.tone_source === "model+pitch" && <div className="text-[11px] text-muted mt-1">Low falling tone 3 (Taiwan style), from your pitch range.</div>}
              {s.uncertain && !s.tone_ok && <div className="text-[11px] text-rough mt-1">Model heard tone {s.model_tone}, pitch suggests tone {s.pitch_tone}.</div>}
            </button>
          );
        })}
      </div>
      {result.extra.length > 0 && <div className="text-sm text-muted cjk">Extra sounds heard: {result.extra.map((e) => e.zhuyin).join(" ")}</div>}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Tone guide</summary>
        <ul className="mt-2 grid sm:grid-cols-2 gap-1">{[1, 2, 3, 4, 5].map((t) => <li key={t}>{TONE_NAME[t]}</li>)}</ul>
        <div className="mt-2 cjk">Raw model output: {result.heard_raw}</div>
      </details>
    </div>
  );
}
