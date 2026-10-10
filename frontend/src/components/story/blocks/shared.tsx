"use client";
import { animate } from "motion/react";
import { useEffect, useState } from "react";
import type { Fact } from "../types";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const SPRING = { type: "spring", stiffness: 260, damping: 22 } as const;

/** Enter from below, after the blocks before it. */
export const rise = (delay: number) => ({
  initial: { opacity: 0, y: 24, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.7, delay, ease: EASE },
});

const SUFFIX: Record<string, string> = { "%": "%", min: " min", days: " days", answers: "", times: "×", symbols: "", points: " pts" };
export const suffix = (f: Fact) => SUFFIX[f.unit] ?? "";

/** A number that counts up from zero. */
export function CountUp({ value, delay = 0, duration = 1.3 }: { value: number; delay?: number; duration?: number }) {
  const [n, setN] = useState(0);
  const decimals = Number.isInteger(value) || Math.abs(value) >= 10 ? 0 : 1;
  useEffect(() => {
    const c = animate(0, value, { duration, delay, ease: EASE, onUpdate: setN });
    return () => c.stop();
  }, [value, delay, duration]);
  return <span className="tabular-nums">{n.toFixed(decimals)}</span>;
}

/** The value of a fact with its unit, counting up. */
export function FactValue({ f, delay }: { f: Fact; delay: number }) {
  return <><CountUp value={f.unit === "%" ? Math.round(f.value) : f.value} delay={delay} />{suffix(f)}</>;
}

export const tone = (pct: number | null | undefined) => (pct == null ? "#ffffff" : pct >= 85 ? "#5ee0a0" : pct >= 65 ? "#ffc857" : "#ff7a6b");

