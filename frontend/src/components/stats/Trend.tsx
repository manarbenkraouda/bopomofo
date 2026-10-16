"use client";

import { type ItemStat } from "@/lib/api";

export function Trend({ it }: { it: ItemStat }) {
  if (it.recent == null || it.before == null || it.recent_n < 3) return null;
  const d = Math.round(it.recent - it.before);
  if (Math.abs(d) < 5)
    return (
      <span className="text-xs text-muted" title="This week vs before">
        →
      </span>
    );
  return (
    <span className={"text-xs font-semibold " + (d > 0 ? "text-ok" : "text-bad")} title="This week vs before">
      {d > 0 ? "↑" : "↓"}
      {Math.abs(d)}
    </span>
  );
}
