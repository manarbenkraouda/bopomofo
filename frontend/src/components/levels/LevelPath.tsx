"use client";
// The level path: every level, what it opens, its goals, and the stars of each symbol.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LevelInfo, Levels } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { EXERCISE_DESC, itemLabel, useLevels } from "@/lib/levels";
import { Kbd } from "@/components/shell/Kbd";
import { BoboPose } from "@/components/mascot/Bobo";
import { GoalBar, Stars } from "./LevelUi";

const SYMS = "ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ";

/** The best stars of a symbol over every open exercise that tests symbols. */
function symbolStars(lv: Levels, s: string): number {
  return Math.max(0, ...lv.exercises.map((ex) => lv.stars?.[ex]?.[s]?.stars ?? 0));
}

export function LevelPath() {
  const router = useRouter();
  const { lv, known } = useLevels();
  const cur = lv?.levels.find((l) => l.current) ?? null;
  useHotkeys("levels", [
    ...(cur?.opens ?? [])
      .slice(0, 9)
      .map((o, i) => ({
        keys: ["Digit" + (i + 1), "Numpad" + (i + 1)],
        label: o.label,
        run: () => router.push(o.href),
        bar: false,
      })),
    {
      keys: [],
      label: "Start an exercise of your level",
      show: ["1–" + (cur?.opens.length ?? 1)],
      when: !!cur?.opens.length,
    },
    { keys: ["KeyH"], label: "Back to Home", run: () => router.push("/") },
  ]);
  if (!lv)
    return (
      <div className="py-16 text-center text-muted">
        {known ? "Your path is not available right now. Please try again in a moment." : "Loading your path…"}
      </div>
    );
  const rules = lv.rules;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="card relative overflow-hidden p-5 md:p-6 lg:col-span-2">
        <div className="pointer-events-none absolute -bottom-12 right-6 select-none cjk text-[150px] leading-none text-accent opacity-[.06]">
          級
        </div>
        <div className="relative flex items-center gap-5">
          <BoboPose pose="plan" className="hidden w-28 sm:block md:w-32" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">
              Level {lv.level} of {lv.max_level}
            </div>
            <h1 className="mt-1 text-2xl font-semibold md:text-3xl">{lv.title}</h1>
            {cur && lv.level < lv.max_level && (
              <>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-700"
                      style={{ width: cur.progress + "%" }}
                    />
                  </div>
                  <span className="text-sm tabular-nums text-muted">{cur.progress}%</span>
                </div>
                <p className="mt-2 text-sm text-muted">
                  Reach the goals below to open level {lv.level + 1}: {lv.next?.title}.
                </p>
              </>
            )}
            {lv.level >= lv.max_level && (
              <p className="mt-2 text-sm text-muted">
                Every exercise is open. Keep your known items fresh: Bobo plans a review when one slips.
              </p>
            )}
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-muted">
          <span>
            <Stars n={1} /> seen
          </span>
          <span>
            <Stars n={2} /> accurate
          </span>
          <span>
            <Stars n={3} /> known: right and fast (from level 3, also on {rules.min_days}+ days)
          </span>
          <span>Luck does not count: a known item needs a good score over its last answers, not one right answer.</span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {lv.levels.map((l) => (
          <LevelCard key={l.n} l={l} lv={lv} />
        ))}
      </section>

      <aside className="flex flex-col gap-5">
        <section className="card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Your symbols</h2>
            <span className="text-xs text-muted">
              {[...SYMS].filter((s) => symbolStars(lv, s) >= 3).length}/37 known
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-6 xl:grid-cols-8">
            {[...SYMS].map((s) => {
              const open = lv.symbols.includes(s);
              const n = symbolStars(lv, s);
              return open ? (
                <Link
                  key={s}
                  href={"/reading?syms=" + s}
                  title={"Practice " + s}
                  className={
                    "flex flex-col items-center rounded-lg border px-1 py-1 hover:border-accent " +
                    (n >= 3 ? "border-ok/60 bg-ok/10" : "border-line")
                  }
                >
                  <span className="cjk text-xl leading-tight">{s}</span>
                  <Stars n={n} className="text-[9px]" />
                </Link>
              ) : (
                <span
                  key={s}
                  title="Opens with the next chapter"
                  className="flex flex-col items-center rounded-lg border border-dashed border-line px-1 py-1 opacity-40"
                >
                  <span className="cjk text-xl leading-tight">{s}</span>
                  <span className="text-[9px]">🔒</span>
                </span>
              );
            })}
          </div>
        </section>
        {lv.drops.length > 0 && (
          <section className="card p-5">
            <h2 className="font-semibold">To review</h2>
            <p className="mt-1 text-xs text-muted">
              You knew these well, and they slipped. Your level stays; Bobo adds a short review to your plan.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {lv.drops.map((d) => {
                const ex = lv.levels.flatMap((l) => l.opens).find((o) => o.key === d.exercise);
                return (
                  <span key={d.exercise + d.item} className="chip cjk !cursor-default text-sm">
                    ↻ {itemLabel(d.item)} <span className="text-xs text-muted">· {ex?.label ?? d.exercise}</span>
                  </span>
                );
              })}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function LevelCard({ l, lv }: { l: LevelInfo; lv: Levels }) {
  const done = l.unlocked && !l.current;
  return (
    <div className={"card p-4 md:p-5 " + (l.current ? "border-accent/60" : !l.unlocked ? "opacity-70" : "")}>
      <div className="flex items-center gap-3">
        <span
          className={
            "grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold " +
            (done ? "bg-ok text-white" : l.current ? "bg-accent text-white" : "bg-line text-muted")
          }
        >
          {done ? "✓" : l.unlocked ? l.n : "🔒"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            Level {l.n}
            {l.current ? " · you are here" : ""}
          </div>
          <div className="font-semibold">{l.title}</div>
        </div>
        {l.current && l.n < lv.max_level && <span className="text-sm tabular-nums text-muted">{l.progress}%</span>}
      </div>
      {!done && <p className="mt-2 text-sm text-muted">{l.about}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {l.opens.map((o, i) =>
          l.unlocked ? (
            <Link
              key={o.key}
              href={o.href}
              title={EXERCISE_DESC[o.key]}
              className="chip flex items-center gap-1.5 text-sm hover:!border-accent"
            >
              {l.current && <Kbd className="max-md:!hidden !h-5 !min-w-5 text-[10px]">{i + 1}</Kbd>}
              {o.label}
            </Link>
          ) : (
            <span key={o.key} title={EXERCISE_DESC[o.key]} className="chip !cursor-default text-sm text-muted">
              🔒 {o.label}
            </span>
          ),
        )}
      </div>
      {l.n === 1 && l.current && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {lv.chapters.map((c) => (
            <div
              key={c.key}
              className={
                "rounded-xl border p-2 text-center " + (c.open ? "border-line" : "border-dashed border-line opacity-50")
              }
              title={c.open ? c.accurate + " of " + c.of + " accurate" : "Opens when the chapter before is accurate"}
            >
              <div className="text-xs font-semibold">
                {c.open ? "" : "🔒 "}
                {c.title}
              </div>
              <div className="cjk truncate text-sm text-muted">{c.symbols}</div>
              {c.open && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-line">
                  <div className="h-full bg-accent" style={{ width: (100 * c.accurate) / c.of + "%" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!done && l.n < lv.max_level && l.goals.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
          <div className="text-xs uppercase tracking-wide text-muted">Goals to open level {l.n + 1}</div>
          {l.goals.map((g) => (
            <GoalBar key={g.key} g={g} missing={l.current} />
          ))}
        </div>
      )}
    </div>
  );
}
