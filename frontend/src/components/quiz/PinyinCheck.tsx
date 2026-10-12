"use client";
import { useState } from "react";
import { useHotkeys } from "@/lib/hotkeys";
import { Kbd } from "@/components/shell/Kbd";

/**
 * After repeated misses, the learner types the sound they said in Pinyin.
 * The speech model can mix up close sounds (b and p, z and s), more so with a blocked nose: the typed answer corrects the stats.
 * check: returns an error line to show (the input stays open), or null when it is done.
 */
export function PinyinCheck({ example, check, onClose }: { example: string; check: (typed: string) => Promise<string | null>; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !typed.trim()) return;
    setBusy(true);
    setError("");
    try {
      const e = await check(typed.trim());
      if (e) setError(e);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  // A modal layer: the quiz keys wait while the learner types.
  useHotkeys("pinyin-check", [
    { keys: ["Enter"], label: "Check", run: submit, input: true, when: !!typed.trim() && !busy },
    { keys: ["Escape"], label: "Skip", run: onClose, input: true },
  ], { modal: true, order: 10 });

  return (
    <form className="w-full max-w-md rounded-xl border border-accent/40 bg-accent/5 p-4 flex flex-col gap-3 text-sm" role="dialog" aria-label="Type what you said"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="font-semibold text-ink">Type what you said</div>
      <p className="text-muted leading-snug">
        The microphone can mix up close sounds, like b and p, especially with a blocked nose. Type the sound you said in Pinyin.
      </p>
      <p className="text-muted leading-snug">
        Only you know what you said. Please answer honestly: your stats and plans are built from it, so an honest answer helps you most. If you are not sure, skip.
      </p>
      <input className="input text-lg" autoFocus value={typed} onChange={(e) => { setTyped(e.target.value); setError(""); }}
        placeholder={"For example: " + example} aria-label="The sound you said, in Pinyin"
        autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="done" maxLength={16} />
      {error && <div className="text-bad" role="alert">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn text-muted" onClick={onClose}>Skip <Kbd className="max-md:!hidden">Esc</Kbd></button>
        <button type="submit" className="btn btn-primary" disabled={busy || !typed.trim()}>{busy ? "Checking…" : "Check"} <Kbd className="max-md:!hidden">Enter</Kbd></button>
      </div>
    </form>
  );
}
