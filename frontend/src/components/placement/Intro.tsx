"use client";

import { BoboPose } from "@/components/mascot/Bobo";

export function Intro({ alphabet, syllables, sentences }: { alphabet: boolean; syllables: number; sentences: number }) {
  const parts: [string, string, string][] = [
    ...(alphabet
      ? [
          [
            "ㄅ",
            "The symbols",
            "See each of the 37 symbols and type its sound in pinyin. Up to 3 tries each without hints.",
          ] as [string, string, string],
        ]
      : []),
    [
      "音",
      "Sounds",
      "Say " +
        syllables +
        " syllables: every Bopomofo sound and all four tones. Bobo checks each initial, final, and tone.",
    ],
    [
      "說",
      "Sentences",
      "Say " + sentences + " short sentences, with the neutral tone and the tone changes of 3-3, 不, and 一.",
    ],
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <BoboPose pose="investigate" className="zq-pop w-40 md:w-48" priority />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold md:text-3xl">Let&apos;s find your level</h1>
        <p className="mx-auto max-w-sm text-muted">
          You already speak Mandarin. Show me what you know, and you skip the parts you don&apos;t need. About 10
          minutes: find a quiet place.
        </p>
      </div>
      <div className="card w-full divide-y divide-line overflow-hidden text-left">
        {parts.map(([icon, label, sub], n) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3">
            <span className="cjk grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg text-accent">
              {icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                Part {n + 1}: {label}
              </span>
              <span className="block text-sm text-muted">{sub}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted">
        No pressure: a wrong answer only means you practice it first. You can stop and come back: the test waits where
        you left it.
      </p>
    </div>
  );
}
