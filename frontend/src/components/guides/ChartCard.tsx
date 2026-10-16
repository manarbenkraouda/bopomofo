"use client";

import { useRef, useState } from "react";
import { Glyph } from "@/components/landing/Glyph";
import type { StrokeData } from "@/lib/zhuyin";

/** One symbol of the chart. A press plays the MOE recording and writes the symbol again in stroke order. */
export function ChartCard({
  sym,
  pinyin,
  saidAs,
  strokes,
  count,
  note,
  audio,
}: {
  sym: string;
  pinyin: string;
  saidAs: string;
  strokes: StrokeData[string];
  count: number;
  note?: string;
  audio: string;
}) {
  const [take, setTake] = useState(0);
  const sound = useRef<HTMLAudioElement | null>(null);
  const play = () => {
    sound.current ??= new Audio(audio);
    sound.current.currentTime = 0;
    void sound.current.play().catch(() => {});
    setTake((t) => t + 1);
  };
  return (
    <li className="card">
      <button type="button" onClick={play} aria-label={"Play " + sym + " (" + pinyin + ") and show its stroke order"}>
        <Glyph key={take} strokes={strokes} play={take > 0} rate={4} gap={90} className="g-glyph" />
      </button>
      <p className="sym" lang="zh-TW">
        {sym}
      </p>
      <dl>
        <div>
          <dt>Pinyin</dt>
          <dd>{pinyin}</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>{saidAs}</dd>
        </div>
        <div>
          <dt>Strokes</dt>
          <dd>{count}</dd>
        </div>
      </dl>
      {note ? <p className="note">{note}</p> : null}
    </li>
  );
}
