"use client";
// Small level pieces shared by the app shell, Home, and the level path:
// the stars of an item, a goal bar, the screen of a locked exercise, and Bobo's unlock celebration.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LevelGoal, LevelInfo, LevelNotice } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { itemLabel, ROUTE_EXERCISES, useLevels } from "@/lib/levels";
import type { RouteInfo } from "@/lib/routes";
import { Kbd } from "@/components/shell/Kbd";
import { BoboPose } from "@/components/mascot/Bobo";

/** 0 to 3 stars: seen, accurate, known (accurate, fast, on more than one day). */
export function Stars({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={"whitespace-nowrap tracking-tight " + className} aria-label={n + " of 3 stars"}>
      {[1, 2, 3].map((i) => <span key={i} className={i <= n ? "text-rough" : "text-line"}>★</span>)}
    </span>
  );
}

/** One goal of a level: a bar of the known items, and the items still missing when there are few. */
export function GoalBar({ g, missing = true }: { g: LevelGoal; missing?: boolean }) {
  const pct = Math.min(100, (100 * g.done) / Math.max(1, g.need));
  return (
    <div>
      <div className="flex items-baseline gap-2 text-sm">
        <span className={"flex-1 " + (g.met ? "text-ok" : "")}>{g.met ? "✓ " : ""}{g.label}</span>
        <span className="tabular-nums text-muted">{Math.min(g.done, g.need)}/{g.need}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
        <div className={"h-full rounded-full transition-all duration-500 " + (g.met ? "bg-ok" : "bg-accent")} style={{ width: pct + "%" }} />
      </div>
      {missing && !g.met && g.missing.length > 0 && g.missing.length <= 12 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {g.missing.map((m) => <span key={m} className="cjk rounded border border-line px-1.5 text-xs text-muted">{itemLabel(m)}</span>)}
        </div>
      )}
    </div>
  );
}

/** The lowest level that opens one of the exercises of a screen. */
export function levelForRoute(href: string, levels: LevelInfo[]): LevelInfo | null {
  const ex = ROUTE_EXERCISES[href] ?? [];
  return levels.find((l) => l.opens.some((o) => ex.includes(o.key))) ?? null;
}

/** Shown in place of a screen that opens at a higher level (for example after a link from an old bookmark). */
export function LockedScreen({ route }: { route: RouteInfo }) {
  const router = useRouter();
  const { lv } = useLevels();
  const need = lv ? levelForRoute(route.href, lv.levels) : null;
  const cur = lv?.levels.find((l) => l.current) ?? null;
  useHotkeys("locked", [
    { keys: ["Enter"], label: "See my path", run: () => router.push("/levels") },
    { keys: ["KeyH"], label: "Back to Home", run: () => router.push("/") },
  ]);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
      <BoboPose pose="encourage" className="w-32 md:w-40" />
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">🔒 Not open yet</div>
        <h1 className="mt-1 text-2xl font-semibold">{route.label} opens at level {need?.n ?? "?"}</h1>
        {need && <p className="mt-1 text-muted">Level {need.n}: {need.title}. {need.about}</p>}
      </div>
      {cur && lv && cur.n < lv.max_level && (
        <div className="card w-full p-4 text-left">
          <div className="mb-3 text-sm font-semibold">To open level {cur.n + 1}, reach the goals of level {cur.n}:</div>
          <div className="flex flex-col gap-3">{cur.goals.map((g) => <GoalBar key={g.key} g={g} missing={false} />)}</div>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/levels" className="btn btn-accent justify-center !rounded-xl !px-5 !py-3 font-semibold">See my path <Kbd className="max-md:!hidden">Enter</Kbd></Link>
        <Link href="/" className="btn justify-center !rounded-xl !px-5 !py-3">Back to Home <Kbd className="max-md:!hidden">H</Kbd></Link>
      </div>
    </div>
  );
}

/** Bobo celebrates a new level or new symbols, and offers to start a new exercise at once. */
export function UnlockOverlay({ notice, onGo, onClose }: { notice: LevelNotice; onGo: (href: string) => void; onClose: () => void }) {
  const { lv } = useLevels();
  const n = notice.key.startsWith("level:") ? Number(notice.key.slice(6)) : 0;
  const level = n && lv ? lv.levels[n - 1] : null;
  const chapter = notice.key.startsWith("chapter:") ? lv?.chapters.find((c) => "chapter:" + c.key === notice.key) ?? null : null;
  const opens = level?.opens ?? (chapter ? [{ key: "reading", label: "Say the new symbols", href: "/reading?syms=" + [...chapter.symbols].join(",") }] : []);
  useHotkeys("unlock", [
    ...opens.slice(0, 9).map((o, i) => ({ keys: ["Digit" + (i + 1), "Numpad" + (i + 1)], label: o.label, run: () => onGo(o.href), bar: false })),
    { keys: ["Enter"], label: opens[0] ? "Start: " + opens[0].label : "Close", run: () => (opens[0] ? onGo(opens[0].href) : onClose()) },
    { keys: ["Escape"], label: "Close", run: onClose },
  ], { modal: true, order: 10 });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm zq-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={notice.title}>
      <div className="card zq-pop w-[min(94vw,520px)] overflow-hidden p-6 text-center shadow-2xl">
        <BoboPose pose="celebrate" className="mx-auto w-36 md:w-44" />
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-accent">{level ? "New level!" : "Unlocked!"}</div>
        <h2 className="mt-1 text-2xl font-semibold">{notice.title}</h2>
        {chapter ? <div className="cjk mt-3 text-3xl tracking-widest text-accent">{chapter.symbols}</div> : <p className="mt-1 text-muted">{level?.about ?? notice.text}</p>}
        {opens.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 text-left">
            {opens.map((o, i) => (
              <button key={o.key} onClick={() => onGo(o.href)} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:border-accent">
                <Kbd className="max-md:!hidden">{i + 1}</Kbd>
                <span className="flex-1 font-medium">{o.label}</span>
                <span className="text-xs font-semibold text-ok">NEW</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {opens[0] && <button onClick={() => onGo(opens[0].href)} className="btn btn-accent justify-center !rounded-xl !px-5 !py-3 font-semibold">Start now <Kbd className="max-md:!hidden">Enter</Kbd></button>}
          <button onClick={onClose} className="btn justify-center !rounded-xl !px-5 !py-3">Later <Kbd className="max-md:!hidden">Esc</Kbd></button>
        </div>
      </div>
    </div>
  );
}

