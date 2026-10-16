"use client";
import { motion } from "motion/react";
import type { BlockProps } from "../types";
import { EASE, FactValue, rise, SPRING, tone } from "./shared";

/** Bars that grow; the highlighted one glows. */
export function Bars({ props, delay }: BlockProps<"bars">) {
  const pct = props.items.every((x) => x.value.unit === "%");
  const max = pct ? 100 : Math.max(...props.items.map((x) => x.value.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {props.items.map((x, i) => {
        const d = delay + i * 0.12;
        return (
          <motion.div key={i} {...rise(d)} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-3">
            <span className={"cjk truncate text-sm font-semibold " + (x.highlight ? "text-white" : "text-white/65")}>
              {x.label}
            </span>
            <div className="h-4 overflow-hidden rounded-full bg-white/12">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: x.highlight ? "#fff" : pct ? tone(x.value.value) : "rgba(255,255,255,.55)",
                  boxShadow: x.highlight ? "0 0 18px rgba(255,255,255,.7)" : undefined,
                }}
                initial={{ width: 0 }}
                animate={{ width: (100 * x.value.value) / max + "%" }}
                transition={{ duration: 1.1, delay: d + 0.1, ease: EASE }}
              />
            </div>
            <span
              className={"text-right text-sm font-bold tabular-nums " + (x.highlight ? "text-white" : "text-white/75")}
            >
              <FactValue f={x.value} delay={d + 0.1} />
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/** What was expected, an arrow that draws itself, and what was given instead. */
export function Confusion({ props, delay }: BlockProps<"confusion">) {
  return (
    <div className="flex flex-col gap-3">
      {props.pairs.map((p, i) => {
        const d = delay + i * 0.25;
        return (
          <motion.div key={i} {...rise(d)} className="flex items-center gap-3">
            <span className="cjk min-w-[4.5rem] rounded-xl bg-white/15 px-3 py-2 text-center text-lg font-bold text-white">
              {p.from}
            </span>
            <svg viewBox="0 0 80 20" className="h-5 w-16 shrink-0 text-white/70">
              <motion.path
                d="M2 10 H70 M62 3 L72 10 L62 17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, delay: d + 0.2, ease: EASE }}
              />
            </svg>
            <span className="cjk min-w-[4.5rem] rounded-xl bg-[#ff7a6b]/25 px-3 py-2 text-center text-lg font-bold text-[#ffb3a8]">
              {p.to}
            </span>
            <span className="ml-auto text-lg font-black text-white">
              <FactValue f={p.count} delay={d + 0.3} />
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/** The last 28 days, brighter with more practice. */
export function Calendar({ ctx, delay }: BlockProps<"calendar">) {
  const max = Math.max(...ctx.calendar.map((d) => d.minutes), 1);
  return (
    <div className="grid w-full max-w-[22rem] grid-cols-7 gap-1.5">
      {ctx.calendar.map((d, i) => (
        <motion.div
          key={d.day}
          title={d.day + ": " + d.minutes + " min"}
          className="aspect-square rounded-md"
          style={{
            background: d.minutes
              ? "rgba(255,255,255," + (0.25 + 0.75 * (d.minutes / max)) + ")"
              : "rgba(255,255,255,.08)",
          }}
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING, delay: delay + i * 0.025 }}
        />
      ))}
    </div>
  );
}

/** A line that draws itself, with a soft area under it. */
export function Sparkline({ props, delay }: BlockProps<"sparkline">) {
  const v = props.series.values;
  const max = Math.max(...v, 1);
  const pts = v.map((y, i) => [v.length > 1 ? (i / (v.length - 1)) * 300 : 150, 90 - (y / max) * 80] as const);
  const line = pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  return (
    <div>
      <svg viewBox="0 0 300 100" className="h-32 w-full overflow-visible">
        <motion.path
          d={line + " L300 100 L0 100 Z"}
          fill="rgba(255,255,255,.12)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: delay + 1 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, delay, ease: EASE }}
        />
      </svg>
      <motion.div {...rise(delay + 0.6)} className="mt-1 text-base font-semibold text-white/75">
        {props.label}
      </motion.div>
    </div>
  );
}
