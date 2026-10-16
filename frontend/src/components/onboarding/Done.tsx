"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { Burst } from "@/components/quiz/Feedback";
import { offsetLabel, zoneLabel } from "@/lib/timezones";
import { LEVELS, type Draft, type Mic } from "./questions";

export function Done({ d, mic, test }: { d: Draft; mic: Mic; test: boolean }) {
  const zone = zoneLabel(d.timezone);
  const rows: [string, string, string][] = [
    ["時", "Daily goal", (d.goal ?? 0) + " min a day"],
    ["地", "Time zone", zone.city + " · " + offsetLabel(d.timezone)],
    ["級", "Level", LEVELS.find((l) => l.id === d.level)?.label ?? ""],
    [
      "ㄅ",
      "Start with",
      d.bopomofo === "reads" ? "Practice" : d.bopomofo === "some" ? "A symbol review" : "The symbols, from ㄅ",
    ],
    ["說", "Microphone", mic === "granted" ? "Ready" : "Asked when you record"],
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <div className="relative inline-flex items-center justify-center">
        <BoboPose pose="celebrate" className="zq-pop w-44 md:w-52" priority />
        <Burst />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold md:text-3xl">You&apos;re all set, {d.name.trim()}!</h1>
        <p className="mx-auto max-w-sm text-muted">
          {test
            ? "I’m Bobo (波波), your coach. You already speak Mandarin, so let’s find your level first: a test of the symbols and your voice, about 10 minutes."
            : "I’m Bobo (波波), your coach. I’m writing your first plan from your answers. It is ready in about a minute."}
        </p>
      </div>
      <div className="card w-full divide-y divide-line overflow-hidden text-left">
        {rows.map(([icon, label, value]) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3">
            <span className="cjk grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm text-accent">
              {icon}
            </span>
            <span className="shrink-0 text-sm text-muted">{label}</span>
            <span className="ml-auto min-w-0 text-right font-medium leading-snug">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
