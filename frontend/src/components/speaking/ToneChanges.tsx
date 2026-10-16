"use client";

import { type TextItem } from "@/lib/api";
import { changed, RULE_NAME, saidZhuyin } from "./cards";

/** Before recording: every tone the rules change in this text, said plainly. The Bopomofo shows the written tone only. */
export function ToneChanges({ items }: { items: TextItem[] }) {
  const list = changed(items);
  if (!list.length) return null;
  return (
    <div className="flex flex-col items-center gap-1 text-sm cjk max-w-2xl" role="note">
      <div className="text-muted">The tone changes here. Say it this way:</div>
      <div className="flex flex-wrap justify-center gap-2">
        {list.map((s, i) => (
          <span key={i} className="rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1">
            <b>{s.char}</b> <span className="text-muted line-through decoration-1">{s.zhuyin}</span> →{" "}
            <b className="text-accent">{saidZhuyin(s)}</b>
            <span className="text-muted"> · {s.rule ? RULE_NAME[s.rule] : "tone change"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
