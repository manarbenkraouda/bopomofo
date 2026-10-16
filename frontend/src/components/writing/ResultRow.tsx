"use client";

import { StrokeAnim } from "@/components/StrokeAnim";
import { NOTES, type StrokeData } from "@/lib/zhuyin";
import { type Row } from "./segment";

export function ResultRow({
  x,
  data,
  syllable,
  toneOne,
}: {
  x: Row;
  data: StrokeData;
  syllable?: string;
  toneOne: boolean;
}) {
  let sym: React.ReactNode = "",
    items: string[] = [],
    note = "";
  if (x.kind === "symbol") {
    sym = x.expected;
    items = x.r.messages.length ? x.r.messages : ["Small shape notes."];
    if (!x.r.ok && x.r.nearly && x.r.strokes.some((s) => s.status === "joined"))
      items = [...items, "Accepted: MOE allows a 3-stroke form of " + x.expected + "."];
    note = NOTES[x.expected] ?? "";
  } else if (x.kind === "missing") {
    sym = <StrokeAnim sym={x.expected} data={data} size={56} numbers={false} />;
    items = [x.tone ? "The tone mark " + x.expected + " is missing." : "The symbol " + x.expected + " is missing."];
    note = NOTES[x.expected] ?? "";
  } else if (x.kind === "extra") {
    sym = "✕";
    items = [
      x.tone && toneOne
        ? "This syllable is tone 1, which has no mark. You wrote " + (x.guess ?? "a mark") + "."
        : "Extra " +
          (x.tone ? "mark" : "symbol") +
          (x.guess ? " (it looks like " + x.guess + ")" : "") +
          ". If it is part of the symbol before it, write them closer; if it is a new symbol, leave a space.",
    ];
  }
  return (
    <div className="grid grid-cols-[64px_1fr] gap-3 py-2 border-t border-line">
      <div className="cjk text-3xl grid place-items-center">{sym}</div>
      <div>
        {syllable && <div className="text-xs text-muted cjk">{syllable}</div>}
        <ul className="list-disc pl-5 text-[15px] cjk">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        {note && <div className="text-xs text-muted mt-1">MOE: {note}</div>}
      </div>
    </div>
  );
}
