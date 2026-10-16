"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { Kbd } from "@/components/shell/Kbd";
import { type Stats as Data } from "@/lib/api";
import Link from "next/link";
import { accTone, AREA_COLOR, AREA_LABEL, AREA_ORDER, Meter, secs, tint } from "./charts";
import { itemName, percent, rangeTitle, said, toneShort, WEAK_SHOWN } from "./display";
import { Trend } from "./Trend";

// ---------- Overview ----------

export function OverviewView({
  data,
  days,
  weak,
  sel,
  setSel,
  allWeak,
  toggleWeak,
}: {
  data: Data;
  days: number;
  weak: Data["weak"];
  sel: number;
  setSel: (i: number) => void;
  allWeak: boolean;
  toggleWeak: () => void;
}) {
  const o = data.overview;
  // Areas with enough answers to compare, best first.
  const ranked = AREA_ORDER.filter((a) => data.areas[a]?.acc != null && data.areas[a].n >= 10).sort(
    (x, y) => data.areas[y].acc! - data.areas[x].acc!,
  );
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const vs = days ? "vs the " + (days === 1 ? "day" : days + " days") + " before" : "";
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card relative overflow-hidden p-5 md:p-6">
        <div className="pointer-events-none absolute -bottom-10 -right-2 select-none cjk text-[140px] leading-none text-accent opacity-[.06]">
          成績
        </div>
        <div className="relative text-xs font-semibold uppercase tracking-wide text-accent">{rangeTitle(days)}</div>
        {o.cards ? (
          <>
            <p className="relative mt-2 max-w-3xl text-xl font-semibold leading-snug md:text-2xl">
              {best && worst ? (
                <>
                  {AREA_LABEL[best]} is your strongest skill. {AREA_LABEL[worst]} needs the most work.
                </>
              ) : best ? (
                <>{AREA_LABEL[best]} is where you practice most.</>
              ) : (
                <>You are just getting started.</>
              )}
            </p>
            <div className="relative mt-5 grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-4">
              <Big label="answers" value={String(o.cards)} delta={o.prev ? o.cards - o.prev.cards : null} />
              <Big
                label="right"
                value={percent(o.acc)}
                delta={o.prev && o.acc != null && o.prev.acc != null ? Math.round(o.acc - o.prev.acc) : null}
                unit=" pts"
              />
              <Big label="minutes" value={String(o.minutes)} delta={o.prev ? o.minutes - o.prev.minutes : null} />
              {o.ms != null && (
                <Big
                  label="per answer"
                  value={secs(o.ms)}
                  delta={o.prev && o.prev.ms != null ? -Math.round((o.ms - o.prev.ms) / 100) / 10 : null}
                  unit=" s faster"
                />
              )}
            </div>
            {vs && o.prev && <div className="relative mt-2 text-[11px] text-muted">Changes: {vs}</div>}
          </>
        ) : (
          <p className="relative mt-2 flex items-center gap-4 text-muted">
            <BoboPose pose="investigate" className="w-20" />
            Bobo found no answers in this range yet. Practice a little, or choose a longer range with ] .
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold">
          Your skills <span className="font-normal text-muted">· first try, without help</span>
        </h2>
        {/* Phone: one compact list. Wider: a tile per skill. */}
        <div className="card flex flex-col divide-y divide-line sm:hidden">
          {AREA_ORDER.map((a) => {
            const s = data.areas[a];
            const few = !s || s.n < 5;
            return (
              <Link key={a} href={"/" + a} className="flex items-center gap-3 px-4 py-3">
                <span className="flex w-24 shrink-0 items-center gap-2 text-sm font-semibold">
                  <i className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[a] }} />
                  {AREA_LABEL[a]}
                </span>
                <span className="flex-1">
                  {s?.n ? (
                    <Meter value={s.acc} color={few ? "var(--muted)" : undefined} />
                  ) : (
                    <span className="text-xs text-muted">not practiced</span>
                  )}
                </span>
                <span
                  className="w-11 text-right text-lg font-semibold tabular-nums"
                  style={{ color: few ? "var(--muted)" : accTone(s.acc) }}
                >
                  {s?.n ? percent(s.acc) : ""}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-5">
          {AREA_ORDER.map((a) => (
            <SkillTile key={a} area={a} s={data.areas[a]} />
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-4 md:p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="font-semibold">Train next</h2>
            <span className="text-xs text-muted">your weakest spots</span>
          </div>
          {weak.length ? (
            <div className="flex flex-col gap-1.5">
              {weak.map((it, i) => (
                <WeakRow key={it.area + it.kind + it.expected} it={it} active={i === sel} onHover={() => setSel(i)} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted">No weak spots yet: each needs at least 3 answers. Keep practicing.</div>
          )}
          {data.weak.length > WEAK_SHOWN && (
            <button className="mt-3 text-sm text-accent hover:underline" onClick={toggleWeak}>
              {allWeak ? "Show the top " + WEAK_SHOWN : "Show all " + data.weak.length}
            </button>
          )}
        </section>

        <section className="card p-4 md:p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="font-semibold">Today&apos;s challenges</h2>
            <span className="text-xs text-muted">
              {data.challenges.filter((c) => c.done).length}/{data.challenges.length} done
            </span>
          </div>
          {data.challenges.length ? (
            <div className="flex flex-col gap-1">
              {data.challenges.map((c, i) => (
                <Link
                  key={c.id}
                  href={c.href}
                  title={c.why}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raise"
                >
                  <span
                    className={
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-xs font-bold " +
                      (c.done ? "border-ok bg-ok text-white" : "border-line")
                    }
                    style={c.done ? undefined : { borderColor: tint(AREA_COLOR[c.area], 70) }}
                  >
                    {c.done ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        "cjk block truncate text-sm font-medium " +
                        (c.done ? "text-muted line-through decoration-muted/50" : "")
                      }
                    >
                      {c.title}
                    </span>
                    {!c.done && (
                      <span className="mt-1 block">
                        <Meter value={(100 * c.progress) / c.target} color="var(--accent)" />
                      </span>
                    )}
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {c.progress}/{c.target}
                  </span>
                  {!c.done && <Kbd className="max-md:!hidden">{"QWER"[i]}</Kbd>}
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted">Practice a few minutes to get challenges.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function SkillTile({ area, s }: { area: string; s: Data["areas"][string] | undefined }) {
  if (!s || !s.n) {
    return (
      <Link
        href={"/" + area}
        className="card tile flex flex-col gap-1.5 border-dashed p-4 transition hover:border-accent/60"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <i className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[area] }} />
          {AREA_LABEL[area]}
        </span>
        <span className="text-sm text-muted">Not practiced in this range</span>
        <span className="mt-auto text-xs text-accent">Start →</span>
      </Link>
    );
  }
  // A few answers say nothing yet: show them, but not as a red or green verdict.
  const few = s.n < 5;
  const extra = few
    ? "too few to judge"
    : area === "speaking" && s.score != null
      ? "avg score " + Math.round(s.score)
      : s.help && s.help >= 25
        ? "help on " + Math.round(s.help) + "%"
        : "";
  return (
    <Link href={"/" + area} className="card tile flex flex-col gap-2 p-4 transition hover:border-accent/60">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <i className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[area] }} />
        {AREA_LABEL[area]}
      </span>
      <span className="text-3xl font-semibold tabular-nums" style={{ color: few ? "var(--muted)" : accTone(s.acc) }}>
        {percent(s.acc)}
      </span>
      <Meter value={s.acc} color={few ? "var(--muted)" : undefined} />
      <span className="text-xs text-muted">
        {s.n} answer{s.n === 1 ? "" : "s"}
        {extra ? " · " + extra : ""}
      </span>
    </Link>
  );
}

function WeakRow({ it, active, onHover }: { it: Data["weak"][number]; active: boolean; onHover: () => void }) {
  return (
    <Link
      href={it.href}
      onMouseEnter={onHover}
      data-current={active}
      className={
        "grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition " +
        (active ? "border-accent/60 bg-accent-soft" : "border-transparent hover:bg-raise")
      }
    >
      <span
        className="cjk grid h-11 min-w-11 place-items-center rounded-xl px-1.5 text-lg font-semibold"
        style={{ background: tint(accTone(it.post), 22), color: accTone(it.post) }}
      >
        {it.kind === "tone" ? toneShort(it.expected) : it.expected}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="cjk font-semibold">{itemName(it)}</span>
          <span className="text-xs" style={{ color: AREA_COLOR[it.area] }}>
            {AREA_LABEL[it.area]}
          </span>
        </span>
        <span className="cjk block truncate text-xs text-muted">
          {it.ok} of {it.n} right{it.top.length ? " · often " + said(it.kind, it.top[0][0]) + " instead" : ""}
        </span>
      </span>
      <span className="flex items-center gap-2 text-right">
        <Trend it={it} />
        <span className="w-12 text-xl font-semibold tabular-nums" style={{ color: accTone(it.post) }}>
          {Math.round(it.post)}%
        </span>
        {active && <Kbd className="max-md:!hidden">Enter</Kbd>}
      </span>
    </Link>
  );
}

function Big({
  label,
  value,
  delta,
  unit = "",
}: {
  label: string;
  value: string;
  delta: number | null;
  unit?: string;
}) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums md:text-3xl">{value}</div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted">
        {label}
        {delta != null && delta !== 0 && (
          <span className={"font-semibold " + (delta > 0 ? "text-ok" : "text-bad")}>
            {delta > 0 ? "+" : "−"}
            {Math.abs(delta)}
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
