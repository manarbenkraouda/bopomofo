"use client";
// Small chart parts for the stats screen. Plain HTML and CSS, in the theme colors.
import type { Stats } from "@/lib/api";

export const AREA_COLOR: Record<string, string> = { reading: "#e5643f", listening: "#4f9cf0", dictation: "#a77bf3", writing: "#e3a62b", speaking: "#3cbc80" };
export const AREA_LABEL: Record<string, string> = { reading: "Reading", listening: "Listening", dictation: "Dictation", writing: "Writing", speaking: "Speaking" };
export const AREA_ORDER = ["reading", "listening", "dictation", "writing", "speaking"];

/** Accuracy color: green from 85 %, amber from 65 %, red below. */
export const accTone = (p: number | null | undefined) => (p == null ? "var(--muted)" : p >= 85 ? "var(--ok)" : p >= 65 ? "var(--rough)" : "var(--bad)");
export const tint = (color: string, pct: number) => "color-mix(in srgb, " + color + " " + Math.round(pct) + "%, transparent)";
export const pct = (ok: number, n: number) => (n ? Math.round((100 * ok) / n) : null);
export const shortDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" });
export const secs = (ms: number | null | undefined) => (ms == null ? "–" : (ms / 1000).toFixed(1) + " s");

/**
 * Confusion table. Rows: what was expected. Columns: what you produced. Each cell shows the share of the row,
 * green on the diagonal (right), red elsewhere, darker for a larger share.
 */
export function Matrix({ rows, cols, get, rowName, colName, corner, onRow, selected }: {
  rows: string[]; cols: string[]; get: (r: string, c: string) => number; rowName: (r: string) => React.ReactNode; colName: (c: string) => React.ReactNode;
  corner?: string; onRow?: (r: string) => void; selected?: string;
}) {
  const totals = rows.map((r) => cols.reduce((a, c) => a + get(r, c), 0));
  return (
    <table className="w-full border-separate border-spacing-[3px] text-center text-sm tabular-nums">
      <thead>
        <tr>
          <th className="text-left text-[11px] font-normal text-muted">{corner}</th>
          {cols.map((c) => <th key={c} className="cjk pb-1 text-xs font-medium text-muted">{colName(c)}</th>)}
          <th className="pb-1 text-[11px] font-normal text-muted">n</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? "cursor-pointer" : ""}>
            <th className={"cjk whitespace-nowrap rounded-md pr-2 text-left text-xs font-semibold " + (selected === r ? "text-accent" : "")}>{rowName(r)}</th>
            {cols.map((c) => {
              const n = get(r, c);
              const p = totals[i] ? n / totals[i] : 0;
              return (
                <td key={c} title={n + " of " + totals[i]} className="h-10 min-w-10 rounded-md leading-tight"
                  style={{ background: n ? tint(r === c ? "var(--ok)" : "var(--bad)", 14 + p * 66) : "var(--raise)" }}>
                  {n ? <><span className="font-semibold">{Math.round(p * 100)}%</span><span className="block text-[10px] text-muted">{n}</span></> : ""}
                </td>
              );
            })}
            <td className="text-xs text-muted">{totals[i]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Accuracy table: rows x columns, each cell the share right with its count. */
export function AccGrid({ rows, cols, get, rowName, colName, corner }: {
  rows: string[]; cols: string[]; get: (r: string, c: string) => { n: number; ok: number } | undefined;
  rowName: (r: string) => React.ReactNode; colName: (c: string) => React.ReactNode; corner?: string;
}) {
  return (
    <table className="w-full border-separate border-spacing-[3px] text-center text-sm tabular-nums">
      <thead>
        <tr>
          <th className="text-left text-[11px] font-normal text-muted">{corner}</th>
          {cols.map((c) => <th key={c} className="pb-1 text-xs font-medium text-muted">{colName(c)}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <th className="whitespace-nowrap pr-2 text-left text-xs font-semibold">{rowName(r)}</th>
            {cols.map((c) => {
              const v = get(r, c);
              const p = v ? pct(v.ok, v.n) : null;
              return (
                <td key={c} title={v ? v.ok + " right of " + v.n : "no data"} className="h-10 min-w-10 rounded-md leading-tight" style={{ background: v ? tint(accTone(p), 18 + Math.min(1, v.n / 20) * 30) : "var(--raise)" }}>
                  {v ? <><span className="font-semibold">{p}%</span><span className="block text-[10px] text-muted">{v.n}</span></> : ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Cards per day, stacked by practice area, with the day's accuracy as a dot. */
export function DailyChart({ daily }: { daily: Stats["daily"] }) {
  const max = Math.max(5, ...daily.map((d) => d.cards));
  const step = Math.max(1, Math.ceil(daily.length / 10));
  return (
    <div>
      <div className="relative flex h-44 items-end gap-[2px] border-b border-line">
        {daily.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col-reverse" title={shortDay(d.day) + ": " + d.cards + " answers, " + (d.acc ?? "–") + "% right, " + d.minutes + " min"}>
            {AREA_ORDER.map((a) => d.areas[a] ? <div key={a} style={{ height: (100 * d.areas[a][0]) / max + "%", background: AREA_COLOR[a] }} className="w-full first:rounded-b-[2px] last:rounded-t-[3px] opacity-85 group-hover:opacity-100" /> : null)}
            {d.acc != null && <div className="absolute left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full border border-card" style={{ bottom: d.acc + "%", background: "var(--ink)" }} />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-muted">
        {daily.map((d, i) => <div key={d.day} className="flex-1 overflow-visible whitespace-nowrap">{i % step === 0 ? shortDay(d.day) : ""}</div>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        {AREA_ORDER.map((a) => <span key={a} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: AREA_COLOR[a] }} />{AREA_LABEL[a]}</span>)}
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-ink" />% right (height)</span>
      </div>
    </div>
  );
}

/** Practice minutes per day for the last 26 weeks. Green: the daily goal was reached. */
export function Calendar({ days, goal }: { days: Stats["calendar"]; goal: number }) {
  const by = new Map(days.map((d) => [d.day, d.minutes]));
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 7 * 25 - ((today.getDay() + 6) % 7));
  const weeks: { day: string; m: number; future: boolean }[][] = [];
  for (let w = 0; w < 26; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      col.push({ day: k, m: by.get(k) ?? 0, future: d > today });
    }
    weeks.push(col);
  }
  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {weeks.map((col, i) => (
        <div key={i} className="flex flex-col gap-[3px]">
          {col.map((c) => (
            <div key={c.day} title={shortDay(c.day) + ": " + Math.round(c.m) + " min"} className="h-3.5 w-3.5 rounded-[3px]"
              style={{ background: c.future ? "transparent" : !c.m ? "var(--raise)" : c.m >= goal ? "var(--ok)" : tint("var(--accent)", 25 + Math.min(1, c.m / goal) * 60) }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Answers and accuracy by hour of the day. */
export function Hours({ hours }: { hours: Stats["hours"] }) {
  const max = Math.max(1, ...hours.map((h) => h.n));
  const by = new Map(hours.map((h) => [h.hour, h]));
  return (
    <div>
      <div className="flex h-24 items-end gap-[2px]">
        {Array.from({ length: 24 }, (_, h) => {
          const v = by.get(h);
          const p = v ? pct(v.ok, v.n) : null;
          return <div key={h} className="flex-1 rounded-t-[3px]" title={h + ":00 " + (v ? v.n + " answers, " + p + "% right" : "")} style={{ height: v ? Math.max(4, (100 * v.n) / max) + "%" : "2px", background: v ? accTone(p) : "var(--line)" }} />;
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
    </div>
  );
}

/** A thin bar for a share. */
export function Meter({ value, color }: { value: number | null; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-line">
      <div className="h-full rounded" style={{ width: (value ?? 0) + "%", background: color ?? accTone(value) }} />
    </div>
  );
}

