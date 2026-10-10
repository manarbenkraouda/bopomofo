"use client";
import { useEffect, useState } from "react";
import { clearAudioCache, getVoice, setVoice, ttsUrl, voices, type Voice } from "@/lib/api";
import { PlayButton } from "@/components/PlayButton";

const SAMPLE = "你好，我在台灣學中文。";

export function VoicePicker() {
  const [list, setList] = useState<Voice[]>([]);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");
  const [cleared, setCleared] = useState("");
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    voices().then((r) => { setList(r.voices); setCurrent(getVoice() || r.default); }).catch((e) => setError(e.message));
  }, []);

  const choose = (id: string) => { setVoice(id); setCurrent(id); };
  const clear = async () => {
    setClearing(true); setCleared(""); setError("");
    try {
      const r = await clearAudioCache();
      setCleared(`Cleared ${r.files} clips (${(r.bytes / 1048576).toFixed(1)} MB). Audio is made again the next time you play it.`);
    } catch (e) { setError((e as Error).message); }
    setClearing(false);
  };

  return (
    <div className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">Voice</h2>
      {error && <p className="text-sm text-bad">{error}</p>}
      {list.map((v) => (
        <div key={v.id} className={"flex items-center gap-3 rounded-xl border p-3 " + (current === v.id ? "border-accent bg-accent-soft/40" : "border-line")}>
          <label className="flex flex-1 items-start gap-3 cursor-pointer">
            <input type="radio" name="voice" className="mt-1" checked={current === v.id} onChange={() => choose(v.id)} />
            <span>
              <span className="font-medium block">{v.label}</span>
              <span className="text-sm text-muted">{v.description}</span>
            </span>
          </label>
          <PlayButton src={ttsUrl(SAMPLE, 0, v.id)} label="Preview" />
        </div>
      ))}
      <p className="text-xs text-muted">The first sentence after a voice change takes a few seconds while the voice loads.</p>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button className="btn" onClick={clear} disabled={clearing}>{clearing ? "Clearing…" : "Clear audio cache"}</button>
        <span className="text-sm text-muted">{cleared || "Removes saved audio, so all sentences are read again with the current voice and settings."}</span>
      </div>
    </div>
  );
}
