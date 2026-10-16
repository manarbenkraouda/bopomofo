"use client";
import { motion } from "motion/react";
import type { BlockProps } from "../types";
import { CountUp, EASE, FactValue, rise, SPRING, tone } from "./shared";

export function BigNumber({ props, delay }: BlockProps<"big_number">) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...SPRING, delay }}
    >
      <div className="text-[clamp(72px,20vw,148px)] font-black leading-[0.9] tracking-tighter text-white">
        <FactValue f={props.value} delay={delay} />
      </div>
      <motion.div {...rise(delay + 0.4)} className="mt-1 text-lg font-semibold text-white/75">
        {props.label}
      </motion.div>
    </motion.div>
  );
}

/** A percentage as a ring that fills. */
export function Ring({ props, delay }: BlockProps<"ring">) {
  const v = Math.max(0, Math.min(100, props.value.value));
  const color = tone(v);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[clamp(130px,34vw,180px)] w-[clamp(130px,34vw,180px)] shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="12" />
          <motion.circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: v / 100 }}
            transition={{ duration: 1.4, delay, ease: EASE }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-[clamp(30px,8vw,44px)] font-black text-white">
          <span>
            <CountUp value={Math.round(v)} delay={delay} duration={1.4} />%
          </span>
        </div>
      </div>
      <motion.div {...rise(delay + 0.5)} className="text-lg font-semibold leading-snug text-white/85">
        {props.label}
      </motion.div>
    </div>
  );
}

/** Two numbers face to face. */
export function Versus({ props, delay }: BlockProps<"versus">) {
  const sides = [props.left, props.right];
  const max = Math.max(...sides.map((s) => s.value.value), 1);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
      {sides.map((s, i) => (
        <motion.div
          key={i}
          className={"flex flex-col " + (i ? "order-3 items-end text-right" : "items-start")}
          initial={{ opacity: 0, x: i ? 40 : -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...SPRING, delay: delay + i * 0.2 }}
        >
          <div
            className="font-black leading-none tracking-tighter"
            style={{
              fontSize:
                "clamp(" + (40 + 30 * (s.value.value / max)) + "px, 15vw, " + (60 + 50 * (s.value.value / max)) + "px)",
              color: s.value.unit === "%" ? tone(s.value.value) : "#fff",
            }}
          >
            <FactValue f={s.value} delay={delay + i * 0.2} />
          </div>
          <div className="mt-1 text-base font-semibold text-white/75">{s.label}</div>
        </motion.div>
      ))}
      <motion.div
        className="order-2 pb-6 text-sm font-bold uppercase tracking-widest text-white/50"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...SPRING, delay: delay + 0.45 }}
      >
        vs
      </motion.div>
    </div>
  );
}
