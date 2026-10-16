"use client";

import { deviceZone, offsetLabel, timeIn, zoneLabel } from "@/lib/timezones";
import { useEffect, useState } from "react";

/** The chosen zone with its clock now, and the time left before the next day starts there. */
export function ZoneCard({ zone, onChange }: { zone: string; onChange: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const { city, region } = zoneLabel(zone);
  const time = timeIn(zone, now);
  const [h, m] = time.split(":").map(Number);
  const left = 24 * 60 - (h * 60 + m);
  return (
    <div className="card relative overflow-hidden p-5">
      <span
        aria-hidden
        className="cjk pointer-events-none absolute -bottom-8 -right-2 select-none text-[150px] leading-none text-accent opacity-[.07]"
      >
        地
      </span>
      <div className="relative">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent">
          {zone === deviceZone() ? "Found on this device" : "Your time zone"}
        </div>
        <div className="mt-1 truncate text-3xl font-semibold">{city}</div>
        <div className="truncate text-muted">{region}</div>
        <div className="mt-4 flex items-end gap-3">
          <span className="text-5xl font-semibold tabular-nums">{time}</span>
          <span className="pb-1.5 font-medium text-muted">{offsetLabel(zone, now)}</span>
        </div>
        {Number.isFinite(left) && (
          <div className="mt-1 text-sm text-muted">
            A new day starts here in {Math.floor(left / 60)} h {String(left % 60).padStart(2, "0")} min.
          </div>
        )}
        <button className="btn mt-4" onClick={onChange}>
          Change time zone
        </button>
      </div>
    </div>
  );
}
