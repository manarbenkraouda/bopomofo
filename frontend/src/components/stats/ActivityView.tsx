"use client";

import { downloadExport, type Stats as Data } from "@/lib/api";
import { goalMinutes } from "@/lib/session";
import {
  accTone,
  AREA_COLOR,
  AREA_LABEL,
  AREA_ORDER,
  Calendar,
  DailyChart,
  Disclosure,
  Hours,
  pct,
  secs,
  shortDay,
} from "./charts";
import { said, toneShort } from "./display";

// ---------- Activity ----------

export function ActivityView({ data, phone }: { data: Data; phone: boolean }) {
  const goal = goalMinutes();
  const r = data.records;
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card p-4 md:p-5">
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact value={String(r.streak_now?.value ?? 0)} label="day streak now" icon="🔥" />
          <Fact value={r.streak ? String(r.streak.value) : "–"} label="longest streak" />
          <Fact value={String(r.total_minutes?.value ?? 0)} label="minutes in all" />
          <Fact
            value={String(r.days?.value ?? 0)}
            label={"days practiced" + (r.days?.day ? " since " + shortDay(r.days.day) : "")}
          />
        </div>
        <h2 className="mb-1 text-sm font-semibold">Practice calendar</h2>
        <p className="mb-2 text-xs text-muted">
          Minutes per day, last 26 weeks. Green: daily goal ({goal} min) reached.
        </p>
        <Calendar days={data.calendar} goal={goal} />
      </section>

      <section className="card p-4 md:p-5">
        <h2 className="mb-3 font-semibold">Answers per day</h2>
        <DailyChart daily={phone ? data.daily.slice(-30) : data.daily} />
      </section>

      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-2">
        <Records data={data} />
        <section className="card p-4 md:p-5">
          <h2 className="mb-1 font-semibold">Time of day</h2>
          <p className="mb-3 text-xs text-muted">Bar height: answers. Color: how often you were right.</p>
          <Hours hours={data.hours} />
        </section>
      </div>

      <Disclosure
        title={"Sessions (" + data.sessions.length + ")"}
        hint="Each practice session: when, how long, which areas, how often right"
      >
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {data.sessions.map((s) => {
            const d = new Date(s.start * 1000);
            const mins = Math.max(1, Math.round((s.end - s.start) / 60));
            return (
              <div key={s.start} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-raise">
                <span className="w-28 text-muted">
                  {d.toLocaleDateString("en", { month: "short", day: "numeric" })}{" "}
                  {d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
                <span className="w-14 tabular-nums">{mins} min</span>
                <span className="flex flex-1 gap-0.5">
                  {AREA_ORDER.filter((a) => s.areas[a]).map((a) => (
                    <i
                      key={a}
                      title={AREA_LABEL[a] + ": " + s.areas[a]}
                      className="h-2 rounded-full"
                      style={{ width: Math.max(6, s.areas[a] * 2) + "px", background: AREA_COLOR[a] }}
                    />
                  ))}
                </span>
                <span className="w-10 text-right tabular-nums">{s.cards}</span>
                <span className="w-10 text-right tabular-nums" style={{ color: accTone(pct(s.ok, s.cards)) }}>
                  {pct(s.ok, s.cards)}%
                </span>
              </div>
            );
          })}
          {!data.sessions.length && <div className="text-sm text-muted">No sessions in this range.</div>}
        </div>
      </Disclosure>

      <Disclosure title="Last answers" hint="Your most recent answers, with what went wrong">
        <div className="mb-3">
          <button
            className="btn !px-3 !py-1 text-xs"
            onClick={() => downloadExport().catch((e: Error) => alert(e.message))}
          >
            Export all answers as CSV
          </button>
        </div>
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {data.recent.map((e) => {
            // Speaking also saves whole syllables; the tone, initial, and final already say what went wrong.
            const wrong = e.units.filter(
              (u) =>
                u.ok === 0 &&
                u.actual != null &&
                u.actual !== u.expected &&
                u.kind !== "order" &&
                !(e.area === "speaking" && u.kind === "syllable"),
            );
            return (
              <div key={e.id} className="cjk flex items-baseline gap-2 rounded-lg px-2 py-1 text-sm hover:bg-raise">
                <span className={"w-4 font-bold " + (e.ok ? "text-ok" : "text-bad")}>{e.ok ? "✓" : "✗"}</span>
                <span className="w-12 shrink-0 text-[11px] text-muted">
                  {new Date(e.ts * 1000).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
                <span className="w-16 shrink-0 text-xs" style={{ color: AREA_COLOR[e.area] }}>
                  {AREA_LABEL[e.area] ?? e.area}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {e.item}
                  {wrong.slice(0, 3).map((u, i) => (
                    <span key={i} className="ml-2 text-xs text-bad">
                      {u.kind === "tone"
                        ? toneShort(u.expected) + "→" + toneShort(u.actual!)
                        : u.expected + "→" + said(u.kind, u.actual!)}
                    </span>
                  ))}
                </span>
                <span className="text-[11px] tabular-nums text-muted">
                  {e.score != null ? Math.round(e.score) : e.ms ? secs(e.ms) : ""}
                </span>
              </div>
            );
          })}
        </div>
      </Disclosure>
    </div>
  );
}

function Fact({ value, label, icon }: { value: string; label: string; icon?: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums md:text-3xl">
        {icon && <span className="mr-1 text-xl">{icon}</span>}
        {value}
      </div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Records({ data }: { data: Data }) {
  const r = data.records;
  const rows: [string, string, string, string | undefined][] = [
    ["⚡", r.combo ? "×" + r.combo.value : "–", "Longest run of right answers", r.combo?.day],
    ["◷", r.minutes_day ? r.minutes_day.value + " min" : "–", "Most practice in a day", r.minutes_day?.day],
    ["▦", r.cards_day ? String(r.cards_day.value) : "–", "Most answers in a day", r.cards_day?.day],
    ["◎", r.acc_day ? Math.round(r.acc_day.value) + "%" : "–", "Best day (30+ answers)", r.acc_day?.day],
    ["說", r.speaking ? String(Math.round(r.speaking.value)) : "–", "Best speaking score", r.speaking?.day],
    ["聽", r.listen_ms ? secs(r.listen_ms.value) : "–", "Fastest listening day", r.listen_ms?.day],
  ];
  return (
    <section className="card p-4 md:p-5">
      <h2 className="mb-3 font-semibold">Personal records</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(([icon, v, label, day]) => (
          <div key={label} className="flex items-center gap-3 rounded-xl bg-raise/60 px-3 py-2">
            <span className="cjk grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card">{icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold tabular-nums">{v}</span>
              <span className="block text-xs leading-snug text-muted">
                {label}
                {day ? " · " + shortDay(day) : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
