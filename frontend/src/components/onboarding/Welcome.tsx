"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { motion } from "motion/react";

const FLOAT = [
  { s: "ㄅ", x: "-9.5rem", y: "-3.5rem", d: 0 },
  { s: "ㄆ", x: "7.5rem", y: "-5rem", d: 0.4 },
  { s: "ㄇ", x: "-7rem", y: "4.5rem", d: 0.8 },
  { s: "ㄈ", x: "8.5rem", y: "3rem", d: 1.2 },
  { s: "ˇ", x: "-2rem", y: "-7rem", d: 0.6 },
  { s: "ˋ", x: "3rem", y: "6.5rem", d: 1 },
];

export function Welcome({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <div className="relative grid h-56 w-full place-items-center [@media(max-height:760px)]:h-44">
        {FLOAT.map((f) => (
          <motion.span
            key={f.s}
            aria-hidden
            className="cjk absolute text-3xl text-accent/70"
            style={{ left: "calc(50% + " + f.x + ")", top: "calc(50% + " + f.y + ")" }}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.2, delay: f.d, repeat: Infinity, ease: "easeInOut" }}
          >
            {f.s}
          </motion.span>
        ))}
        <BoboPose
          pose="welcome"
          className="zq-pop [&_img]:h-56 [&_img]:w-auto [@media(max-height:760px)]:[&_img]:h-44"
          priority
        />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold leading-tight md:text-4xl">
          Learn Mandarin
          <br />
          the Taiwan way
        </h1>
        <p className="mx-auto max-w-sm text-muted">
          Read, hear, write, and say Bopomofo, with a check of every syllable and every tone.
        </p>
      </div>
      <div className="grid w-full max-w-sm grid-cols-4 gap-2">
        {[
          ["讀", "Read"],
          ["聽", "Hear"],
          ["寫", "Write"],
          ["說", "Speak"],
        ].map(([c, l]) => (
          <div key={l} className="card flex flex-col items-center gap-1 py-3">
            <span className="cjk text-xl text-accent">{c}</span>
            <span className="text-xs font-semibold text-muted">{l}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Seven quick questions, about a minute.
        {email && (
          <>
            {" "}
            Signed in as {email}.{" "}
            <button className="font-semibold text-accent hover:underline" onClick={onSignOut}>
              Not you?
            </button>
          </>
        )}
      </p>
    </div>
  );
}
