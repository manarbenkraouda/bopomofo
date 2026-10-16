"use client";
import { motion } from "motion/react";
import type { BlockProps } from "../types";
import { rise, SPRING } from "./shared";

export function Kicker({ props, delay }: BlockProps<"kicker">) {
  return (
    <motion.div {...rise(delay)} className="text-xs font-bold uppercase tracking-[0.25em] text-white/70 md:text-sm">
      {props.text}
    </motion.div>
  );
}

/** A large title, word by word. */
export function Headline({ props, delay }: BlockProps<"headline">) {
  const words = props.text.split(" ");
  return (
    <h2 className="text-[clamp(30px,8.5vw,44px)] font-extrabold leading-[1.06] tracking-tight text-white">
      {words.map((w, i) => (
        <motion.span
          key={i}
          className="inline-block whitespace-pre"
          initial={{ opacity: 0, y: "0.6em", rotate: 4 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ ...SPRING, delay: delay + i * 0.06 }}
        >
          {w + (i < words.length - 1 ? " " : "")}
        </motion.span>
      ))}
    </h2>
  );
}

export function Text({ props, delay }: BlockProps<"text">) {
  return (
    <motion.p {...rise(delay)} className="text-lg leading-snug text-white/85 md:text-xl">
      {props.text}
    </motion.p>
  );
}

export function Chips({ props, delay }: BlockProps<"chips">) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.items.map((t, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING, delay: delay + i * 0.08 }}
          className="cjk rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-base font-semibold text-white"
        >
          {t}
        </motion.span>
      ))}
    </div>
  );
}

export function Sticker({ props, delay }: BlockProps<"sticker">) {
  return (
    <div className="flex items-center gap-4">
      <motion.span
        className="cjk inline-block text-[clamp(64px,16vw,104px)] leading-none drop-shadow-[0_8px_24px_rgba(0,0,0,.35)]"
        initial={{ scale: 0, rotate: -25 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 12, delay }}
      >
        {props.glyph}
      </motion.span>
      {props.text && (
        <motion.span {...rise(delay + 0.25)} className="text-lg font-semibold text-white/90">
          {props.text}
        </motion.span>
      )}
    </div>
  );
}

export function Cta({ props, delay, onAction }: BlockProps<"cta">) {
  return (
    <motion.button
      {...rise(delay)}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={(e) => {
        e.stopPropagation();
        onAction(props.action);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="mt-2 inline-flex items-center gap-3 self-start rounded-full bg-white px-6 py-3.5 text-lg font-bold text-black shadow-xl"
    >
      {props.label}{" "}
      <span className="rounded-md bg-black/10 px-1.5 py-0.5 text-xs font-semibold max-md:hidden">Enter</span>
    </motion.button>
  );
}
