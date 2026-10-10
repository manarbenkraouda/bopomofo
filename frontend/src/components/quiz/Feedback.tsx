"use client";
import { useEffect, useRef, useState } from "react";
import { usePref } from "@/lib/prefs";
import { setSfxEnabled, SFX_KEY } from "@/lib/sfx";
import "./feedback.css";

export type FxStatus = "idle" | "listening" | "hearing" | "checking" | "writing" | "shown" | "right" | "close" | "wrong";


const PILL: Record<FxStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  idle: { label: "Paused", cls: "bg-bg text-muted", icon: <span className="w-2 h-2 rounded-full bg-muted" /> },
  listening: { label: "Listening", cls: "bg-ok/10 text-ok", icon: <span className="w-2 h-2 rounded-full bg-ok" /> },
  hearing: { label: "Hearing you", cls: "bg-accent-soft text-accent", icon: <span className="w-2 h-2 rounded-full bg-accent recording" /> },
  checking: { label: "Checking…", cls: "bg-rough/15 text-rough", icon: <span className="w-3 h-3 rounded-full border-2 border-rough border-t-transparent" style={{ animation: "zq-spin .7s linear infinite" }} /> },
  writing: { label: "Your turn", cls: "bg-bg text-ink", icon: <span>✎</span> },
  shown: { label: "Answer shown", cls: "bg-bg text-muted", icon: <span>👁</span> },
  right: { label: "Correct!", cls: "bg-ok text-white", icon: <span>✓</span> },
  close: { label: "Almost", cls: "bg-rough text-white", icon: <span>≈</span> },
  wrong: { label: "Not quite", cls: "bg-bad text-white", icon: <span>✕</span> },
};

export function StatusPill({ status, label }: { status: FxStatus; label?: string }) {
  const p = PILL[status];
  return (
    <div key={status} className={"zq-in inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium " + p.cls} role="status" aria-live="polite">
      {p.icon}
      {label ?? p.label}
    </div>
  );
}

const COLORS = ["#2f9466", "#b5452f", "#d39418", "#3f7fd2", "#8a55c8", "#2f9466"];

/** Confetti-like burst of small squares from the center of its parent. */
export function Burst({ count = 16, distance = 170 }: { count?: number; distance?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="zq-particle" style={{
          background: COLORS[i % COLORS.length],
          ["--a" as string]: Math.round((360 / count) * i + (i % 2) * 9) + "deg",
          ["--d" as string]: Math.round(distance * (0.75 + ((i * 37) % 10) / 20)) + "px",
          animationDelay: (i % 3) * 25 + "ms",
        }} />
      ))}
    </>
  );
}

/** Frame around the quiz target: grows with the voice, spins while checking, pops when right, shakes when wrong. */
export function FxFrame({ status, level = 0, attempt, children, round = true }: { status: FxStatus; level?: number; attempt: number; children: React.ReactNode; round?: boolean }) {
  const anim = status === "right" ? "zq-pop zq-glow-ok" : status === "close" ? "zq-pop zq-glow-close" : status === "wrong" ? "zq-shake zq-glow-bad" : status === "checking" ? "zq-checking" : "";
  const scale = status === "hearing" ? 1 + Math.min(level, 1) * 0.08 : 1;
  return (
    <div className="relative inline-flex items-center justify-center">
      {status === "checking" && <span className={"zq-ring " + (round ? "" : "!rounded-2xl")} />}
      <div key={status + attempt} className={(round ? "rounded-full " : "rounded-2xl ") + anim} style={{ transform: scale !== 1 ? "scale(" + scale + ")" : undefined, transition: "transform 80ms linear" }}>
        {children}
      </div>
      {status === "right" && <Burst key={"b" + attempt} />}
    </div>
  );
}

export function SfxToggle() {
  const on = usePref(SFX_KEY, "on") !== "off";
  return (
    <button className="chip" onClick={() => setSfxEnabled(!on)} title="Sound effects for correct and wrong answers (M)">
      {on ? "🔊 Sounds on" : "🔇 Sounds off"}
    </button>
  );
}

/** Classes for a result animation on any element (for example a chosen answer button). Re-key the element to replay. */
export const fxClass = (status: FxStatus) =>
  status === "right" ? "zq-pop zq-glow-ok" : status === "close" ? "zq-pop zq-glow-close" : status === "wrong" ? "zq-shake zq-glow-bad" : "";

/** Counts up from 0 to the value, for scores. */
export function useCountUp(value: number | null, ms = 700) {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (value == null) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return shown;
}

