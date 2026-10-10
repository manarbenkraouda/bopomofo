"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { allZones, deviceZone, offsetLabel, timeIn, zoneLabel } from "@/lib/timezones";

/** A search box and the list of time zones. Enter picks the first match. */
export function TimezonePicker({ value, onPick, autoFocus = true }: { value: string; onPick: (zone: string) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const device = deviceZone();
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  const list = useMemo(() => {
    const now = new Date();
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return allZones()
      .map((z) => ({ z, ...zoneLabel(z), off: offsetLabel(z, now), time: timeIn(z, now) }))
      .filter((x) => words.every((w) => (x.z + " " + x.city + " " + x.off).toLowerCase().includes(w)))
      .sort((a, b) => Number(b.z === device) - Number(a.z === device) || Number(b.z === value) - Number(a.z === value));
  }, [q, device, value]);
  return (
    <div className="flex flex-col gap-2">
      <input ref={input} className="input w-full" placeholder="Search a city or GMT+8" value={q} aria-label="Search time zones"
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { e.preventDefault(); e.stopPropagation(); onPick(list[0].z); } }} />
      <div className="card max-h-[min(46dvh,380px)] divide-y divide-line overflow-y-auto" role="listbox" aria-label="Time zones">
        {list.slice(0, 200).map((x) => (
          <button key={x.z} role="option" aria-selected={x.z === value} onClick={() => onPick(x.z)}
            className={"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raise " + (x.z === value ? "bg-accent-soft/40" : "")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{x.city}{x.z === device && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">This device</span>}</span>
              <span className="block truncate text-xs text-muted">{x.region}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-semibold tabular-nums">{x.time}</span>
              <span className="block text-xs text-muted">{x.off}</span>
            </span>
            {x.z === value && <span className="shrink-0 text-accent">✓</span>}
          </button>
        ))}
        {!list.length && <div className="px-4 py-6 text-center text-sm text-muted">No time zone matches “{q}”.</div>}
      </div>
    </div>
  );
}
