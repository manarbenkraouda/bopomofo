"use client";
import { motion } from "motion/react";
import type { BlockProps } from "../types";
import { rise, SPRING } from "./shared";

const SYMS = "ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ";
const ICON: Record<string, string> = { speak_sentences: "說", speak_sounds: "說", listen_tones: "聽", listen_sounds: "聽", read_symbols: "讀", recognize_symbols: "認", write_symbols: "默", write_syllables: "寫", tone_rules: "變" };

/** The 37 symbols: known (green), met but not known (amber), new (faint). Highlighted ones get a pulsing ring. */
export function SymbolGrid({ props, ctx, delay }: BlockProps<"symbol_grid">) {
  const a = ctx.alphabet;
  const hi = props.highlight?.length ? props.highlight : a.next;
  return (
    <div className="grid w-full grid-cols-8 gap-1.5 sm:grid-cols-10">
      {[...SYMS].map((s, i) => {
        const state = a.known.includes(s) ? "known" : a.learning.includes(s) ? "learning" : "new";
        const on = hi.includes(s);
        return (
          <motion.div key={s} className={"cjk relative grid aspect-square place-items-center rounded-lg text-lg font-bold " +
            (state === "known" ? "bg-[#5ee0a0]/30 text-[#bff5da]" : state === "learning" ? "bg-[#ffc857]/22 text-[#ffe2a1]" : "bg-white/8 text-white/40")}
            initial={{ opacity: 0, scale: 0.2, rotate: -20 }} animate={{ opacity: 1, scale: on ? 1.08 : 1, rotate: 0 }}
            transition={{ ...SPRING, delay: delay + i * 0.022 }}>
            {s}
            {on && (
              <motion.span className="absolute inset-0 rounded-lg border-2 border-white" initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0.35, 1] }} transition={{ duration: 1.6, delay: delay + 1, repeat: Infinity, repeatType: "reverse" }} />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/** The plan steps, one by one. */
export function Steps({ ctx, delay }: BlockProps<"steps">) {
  return (
    <ol className="flex flex-col gap-1.5">
      {ctx.steps.slice(0, 7).map((s, i) => (
        <motion.li key={i} {...rise(delay + i * 0.12)} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-2.5 py-1.5">
          <span className="cjk grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-sm font-bold text-black">{ICON[s.type] ?? "練"}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{s.title}</span>
          {s.minutes ? <span className="text-xs font-semibold text-white/60">{s.minutes} min</span> : null}
        </motion.li>
      ))}
    </ol>
  );
}

