"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { Burst } from "@/components/quiz/Feedback";
import { type PlacementResult, type PlacementVoice } from "@/lib/api";

function VoiceRow({ label, v, tones }: { label: string; v: PlacementVoice; tones: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="ml-auto text-right font-medium">
        {v.cards ? (
          <>
            {v.symbols.length} of 37 sounds · {v.tones.length} of {tones} tones
          </>
        ) : (
          "Not recorded"
        )}
      </span>
    </div>
  );
}

export function Result({ r }: { r: PlacementResult }) {
  const missed = [...new Set([...r.syllables.missed, ...r.sentences.missed])];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4 text-center">
      <div className="relative inline-flex items-center justify-center">
        <BoboPose pose="celebrate" className="zq-pop w-40 md:w-48" priority />
        <Burst />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">You start at level {r.level}</p>
        <h1 className="text-2xl font-bold md:text-3xl">{r.title}</h1>
        <p className="mx-auto max-w-sm text-muted">
          {r.level > 1
            ? "The levels you showed are open now. I’m writing your first plan from your answers."
            : r.chapters
              ? "Every symbol chapter is open. We start with the symbols you missed, then move up fast."
              : "We start with the symbols, step by step. Each level opens as soon as you show it."}
        </p>
      </div>
      <div className="card w-full divide-y divide-line overflow-hidden text-left">
        {r.alphabet && (
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="shrink-0 text-sm text-muted">Symbols</span>
            <span className="ml-auto font-medium">
              {r.alphabet.right} of {r.alphabet.of} right
            </span>
          </div>
        )}
        {r.voice_skipped && !r.syllables.cards && !r.sentences.cards ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="text-sm text-muted">Voice</span>
            <span className="ml-auto font-medium">Skipped. Speaking opens with your level.</span>
          </div>
        ) : (
          <>
            <VoiceRow label="Syllables" v={r.syllables} tones={4} />
            <VoiceRow label="Sentences" v={r.sentences} tones={5} />
          </>
        )}
      </div>
      {missed.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted">Sounds to practice first</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {missed.slice(0, 16).map((m) => (
              <span key={m} className="chip cjk">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
