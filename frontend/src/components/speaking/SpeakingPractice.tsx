"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ttsUrl, type Health, type Sentence, type SpeechResult, type TextItem } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { Recorder } from "@/lib/recorder";
import { loadData, syllableAudio, TONE_NAME, type SyllableItem } from "@/lib/zhuyin";
import { PlayButton } from "@/components/PlayButton";
import { PitchChart } from "@/components/PitchChart";
import { ZhuyinText, type Annot } from "@/components/ZhuyinText";

type Source = "sentence" | "syllable" | "custom";
type Target = { text: string; items: TextItem[]; english?: string; audio: string; slow?: string };

export function SpeakingPractice() {
  const [health, setHealth] = useState<Health | null>(null);
  const [source, setSource] = useState<Source>("sentence");
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [sylls, setSylls] = useState<SyllableItem[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [annot, setAnnot] = useState<Annot>("zhuyin");
  const [custom, setCustom] = useState("");
  const [rec, setRec] = useState<"idle" | "recording" | "analyzing">("idle");
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<Recorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const poll = () => api.health().then((h) => { setHealth(h); if (h.speech_model === "loading") setTimeout(poll, 2000); }).catch(() => setHealth(null));
    poll();
    loadData().then((d) => setSylls(d.syllables));
    const q = new URLSearchParams(window.location.search);
    api.sentences().then((r) => {
      setSentences(r.sentences);
      const sid = Number(q.get("sentence"));
      const s = r.sentences.find((x) => x.id === sid) ?? (q.get("text") ? undefined : r.sentences[0]);
      if (s) chooseSentence(s);
    }).catch((e) => setError(String(e.message ?? e)));
    const t = q.get("text");
    if (t) { setSource("custom"); setCustom(t); applyText(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => { setResult(null); setError(""); if (mine) URL.revokeObjectURL(mine); setMine(null); };
  const chooseSentence = (s: Sentence) => { reset(); setTarget({ text: s.hanzi, items: s.items, english: s.english, audio: ttsUrl(s.hanzi), slow: ttsUrl(s.hanzi, -35) }); };
  const chooseSyllable = async (s: SyllableItem) => {
    reset();
    const r = await api.analyzeText(s.char).catch(() => null);
    setTarget({ text: s.char, items: r?.items ?? [], audio: syllableAudio(s.id) });
    playAudio(syllableAudio(s.id));
  };
  async function applyText(t: string) {
    reset();
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
    try {
      setResult(await api.speech(wav, target.text));
      api.health().then(setHealth).catch(() => {});
    } catch (e) { setError((e as Error).message); }
    setRec("idle");
  };
  const upload = async (f: File) => {
    if (!target) return;
    reset();
    setMine(URL.createObjectURL(f));
    setRec("analyzing");
    try { setResult(await api.speech(f, target.text)); api.health().then(setHealth).catch(() => {}); } catch (e) { setError((e as Error).message); }
    setRec("idle");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "KeyR") { e.preventDefault(); if (rec === "idle") start(); else if (rec === "recording") stop(); }
      if (e.code === "Space" && target) { e.preventDefault(); playAudio(target.audio); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const marks = useMemo(() => result?.syllables.map((s) => (!s.heard ? "#d23f3f" : s.tone_ok && s.initial_ok !== false && s.final_ok !== false ? "#2f9466" : "#d23f3f")), [result]);
  const sets = useMemo(() => {
    const m = new Map<string, SyllableItem[]>();
    for (const s of sylls) { const k = [...s.zhuyin].filter((c) => !"ˊˇˋ˙".includes(c)).join(""); m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [sylls]);

  const single = target ? target.items.filter((x) => x.type === "syllable").length === 1 : false;

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
      <aside className="card p-4 flex flex-col gap-3 lg:sticky lg:top-6 max-h-[calc(100vh-3rem)] overflow-hidden">
        <div className="flex gap-1 flex-wrap">
          {(["sentence", "syllable", "custom"] as Source[]).map((s) => (
            <button key={s} className="chip" data-active={source === s} onClick={() => setSource(s)}>
              {s === "sentence" ? "My sentences" : s === "syllable" ? "Syllables" : "My own text"}
            </button>
          ))}
        </div>
        {source === "sentence" && (
          <div className="overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
            {!sentences.length && <div className="text-sm text-muted">No sentences yet. Create some on the Sentences page.</div>}
            {sentences.map((s) => (
              <button key={s.id} onClick={() => chooseSentence(s)} className={"text-left rounded-lg px-3 py-2 hover:bg-bg " + (target?.text === s.hanzi ? "bg-bg" : "")}>
                <div className="cjk text-lg leading-snug">{s.hanzi}</div>
                <div className="text-xs text-muted truncate">{s.english}</div>
              </button>
            ))}
          </div>
        )}
        {source === "syllable" && (
          <div className="overflow-y-auto flex flex-col gap-2">
            <p className="text-xs text-muted">Tone pairs and sets. For one syllable alone, the tone is judged from your pitch curve (an estimate).</p>
            {sets.map(([k, items]) => (
              <div key={k} className="flex flex-wrap gap-1">
                {items.map((s) => (
                  <button key={s.id} onClick={() => chooseSyllable(s)} className={"chip cjk " + (target?.text === s.char ? "!bg-ink !text-white" : "")}>{s.char} {s.zhuyin}</button>
                ))}
              </div>
            ))}
          </div>
        )}
        {source === "custom" && (
          <div className="flex flex-col gap-2">
            <textarea className="input cjk text-lg min-h-28" placeholder="輸入中文，例如：你今天過得怎麼樣？" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn btn-primary justify-center" disabled={!custom.trim()} onClick={() => applyText(custom)}>Practice this text</button>
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
          <div className="card p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm">
              {(["zhuyin", "pinyin", "none"] as Annot[]).map((a) => <button key={a} className="chip" data-active={annot === a} onClick={() => setAnnot(a)}>{a === "zhuyin" ? "注音" : a === "pinyin" ? "Pinyin" : "Characters only"}</button>)}
            </div>
            <div className="py-2">
              <ZhuyinText items={target.items} annot={annot} size={single ? 84 : 52} marks={marks} onSyllable={(i) => {
                const s = target.items.filter((x) => x.type === "syllable")[i];
                if (s && s.type === "syllable") playAudio(ttsUrl(s.char));
              }} />
            </div>
            {target.english && <div className="text-muted">{target.english}</div>}
            {single && health && !health.speaker_hz && (
              <div className="text-sm text-rough">Tip: record one full sentence first. The app then learns your voice pitch, which makes single-syllable tone 3 checks more accurate.</div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <PlayButton src={target.audio} label="Listen" />
              {target.slow && <PlayButton src={target.slow} label="Slow" />}
              {mine && <PlayButton src={mine} label="My recording" />}
              <div className="flex-1" />
              <label className="btn cursor-pointer" title="Analyze an audio file (wav, mp3, flac, ogg)">
                Upload a recording
                <input type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
              </label>
              <div className="flex items-center gap-3">
                {rec === "recording" && <div className="w-24 h-2 rounded bg-line overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: Math.round(level * 100) + "%" }} /></div>}
                <button
                  onClick={rec === "idle" ? start : rec === "recording" ? stop : undefined}
                  disabled={rec === "analyzing" || health?.speech_model !== "ready"}
                  className={"btn !rounded-full !px-6 !py-3 text-base " + (rec === "recording" ? "btn-accent recording" : "btn-primary")}>
                  {rec === "idle" ? "● Record (R)" : rec === "recording" ? "■ Stop" : "Analyzing…"}
                </button>
              </div>
            </div>
            {error && <div className="text-bad text-sm">{error}</div>}
          </div>
        ) : (
          <div className="card p-6 text-muted">Choose something to say from the list.</div>
        )}

        {result && <ResultView result={result} />}
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
  return (
    <div className="card p-6 flex flex-col gap-5">
      <div className="flex items-baseline gap-4 flex-wrap">
        <div className={"text-5xl font-semibold " + (result.score >= 85 ? "text-ok" : result.score >= 60 ? "text-rough" : "text-bad")}>{result.score}</div>
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
