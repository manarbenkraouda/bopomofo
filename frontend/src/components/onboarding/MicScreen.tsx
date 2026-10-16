"use client";

import { Burst } from "@/components/quiz/Feedback";
import { type Mic } from "./questions";

export function MicScreen({ mic }: { mic: Mic }) {
  const ok = mic === "granted";
  const text = ok
    ? "The microphone is ready."
    : mic === "denied"
      ? "The browser blocks the microphone. You can allow it later in the site settings, when you start Speaking."
      : mic === "unsupported"
        ? "This browser cannot record. Speaking and Reading need Chrome, Edge, Safari, or Firefox."
        : "Your browser asks for the microphone next. The app uses it only while you record.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
      <div className="relative inline-flex items-center justify-center">
        <span
          key={mic}
          className={
            "cjk grid h-32 w-32 place-items-center rounded-full text-6xl text-white shadow-2xl transition-colors " +
            (ok ? "zq-pop bg-ok" : "bg-accent " + (mic === "idle" ? "recording" : ""))
          }
        >
          {ok ? "✓" : "說"}
        </span>
        {ok && <Burst count={12} distance={110} />}
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold md:text-3xl">Let the app hear you</h1>
        <p className="mx-auto max-w-sm text-muted">
          Speaking and Reading check every syllable you say: the initial, the final, and the tone.
        </p>
      </div>
      <p
        className={
          "rounded-full px-4 py-1.5 text-sm font-medium " +
          (ok
            ? "bg-ok/15 text-ok"
            : mic === "denied" || mic === "unsupported"
              ? "bg-rough/15 text-rough"
              : "bg-raise text-muted")
        }
      >
        {text}
      </p>
    </div>
  );
}
