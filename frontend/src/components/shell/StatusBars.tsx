"use client";

import { routeIcon } from "@/components/mascot/Bobo";
import { AiEnergyBadge } from "@/components/quota/AiQuota";
import { type Health } from "@/lib/api";
import { type RouteInfo } from "@/lib/routes";
import { goalMinutes, type Today } from "@/lib/session";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

type Status = { cls: string; label: string; tip: string; ok: boolean };

export const statusOf = (health: Health | null | "down"): Status =>
  health === null
    ? { cls: "bg-muted", label: "Connecting…", tip: "", ok: true }
    : health === "down"
      ? { cls: "bg-bad", label: "Offline", tip: "Can't connect right now. Please try again in a moment.", ok: false }
      : health.speech_model === "ready"
        ? { cls: "bg-ok", label: "Ready", tip: "Everything is ready.", ok: true }
        : health.speech_model === "loading"
          ? {
              cls: "bg-rough animate-pulse",
              label: "Getting ready…",
              tip: "The speech check is getting ready (a few seconds).",
              ok: false,
            }
          : {
              cls: "bg-bad",
              label: "Speech check off",
              tip: "The speech check is not available right now. The other exercises still work.",
              ok: false,
            };

export function TopBar({
  route,
  status,
  dayStreak,
  today,
  sfxOn,
  full,
  onSfx,
  onFull,
  onHelp,
  onPalette,
}: {
  route: RouteInfo;
  status: Status;
  dayStreak: number | null;
  today: Today;
  sfxOn: boolean;
  full: boolean;
  onSfx: () => void;
  onFull: () => void;
  onHelp: () => void;
  onPalette: () => void;
}) {
  const goal = goalMinutes();
  const minutes = Math.floor(today.seconds / 60);
  const pct = Math.min(100, (100 * today.seconds) / (goal * 60));
  const acc = today.cards ? Math.round((100 * today.ok) / today.cards) : null;
  return (
    <header className="hidden min-w-0 items-center gap-4 border-b border-line bg-card px-5 md:flex">
      <div className="flex min-w-0 items-center gap-3">
        <span className="cjk grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg text-accent">
          {routeIcon(route, 36)}
        </span>
        <div className="min-w-0">
          <div className="font-semibold leading-tight">{route.label}</div>
          <div className="truncate text-xs text-muted">{route.desc}</div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
        <AiEnergyBadge />
        <span className="hud" title={status.tip}>
          <i className={"inline-block h-2 w-2 rounded-full " + status.cls} />
          {status.label}
        </span>
        <span className="hud hud-optional" title="Days in a row with practice">
          🔥 <b className="tabular-nums">{dayStreak ?? "–"}</b> <span className="text-muted">days</span>
        </span>
        <span
          className="hud"
          title={"Active practice today. Daily goal: " + goal + " minutes (change it in Settings)."}
        >
          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line">
            <span
              className={
                "absolute inset-y-0 left-0 rounded-full transition-all " + (today.goalHit ? "bg-ok" : "bg-accent")
              }
              style={{ width: pct + "%" }}
            />
          </span>
          <b className="tabular-nums">{minutes}</b>
          <span className="text-muted">/{goal} min</span>
          {today.goalHit && <span className="text-ok">✓</span>}
        </span>
        <span className="hud hud-optional" title="Answers today, and how many were right">
          <b className="tabular-nums">{today.cards}</b>{" "}
          <span className="text-muted">{today.cards === 1 ? "card" : "cards"}</span>
          {acc !== null && (
            <>
              <span className="text-muted">·</span>
              <b className="tabular-nums">{acc}%</b>
            </>
          )}
        </span>
        <span
          key={today.combo}
          className={"hud " + (today.combo >= 2 ? "zq-pop border-accent/60 text-accent" : "")}
          title={"Right answers in a row, on all screens. Best today: " + today.best}
        >
          ⚡ <b className="tabular-nums">×{today.combo}</b>
        </span>
        <div className="ml-1 flex items-center gap-1">
          <button className="icon-btn" onClick={onPalette} title="Commands (Ctrl+K)">
            ⌘
          </button>
          <button className="icon-btn" onClick={onSfx} title="Sounds (M)">
            {sfxOn ? "🔊" : "🔇"}
          </button>
          <button className="icon-btn" onClick={onFull} title="Full screen (Alt+Enter)">
            {full ? "🗗" : "⛶"}
          </button>
          <button className="icon-btn font-semibold" onClick={onHelp} title="Shortcuts (?)">
            ?
          </button>
          <span className="ml-1 grid h-9 w-9 place-items-center">
            <UserButton />
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * Phone top bar. In a practice mode it works like a lesson screen: ✕ back to Home, the daily-goal progress bar, and the combo.
 * On the other screens: the title, the day streak, and the combo.
 */
export function MobileTop({
  route,
  status,
  dayStreak,
  today,
  sfxOn,
  onSfx,
  lesson,
}: {
  route: RouteInfo;
  status: Status;
  dayStreak: number | null;
  today: Today;
  sfxOn: boolean;
  onSfx: () => void;
  lesson: boolean;
}) {
  const goal = goalMinutes();
  const minutes = Math.floor(today.seconds / 60);
  const pct = Math.min(100, (100 * today.seconds) / (goal * 60));
  const combo = (
    <span
      key={today.combo}
      className={
        "flex items-center gap-0.5 text-sm font-bold tabular-nums " +
        (today.combo >= 2 ? "text-accent zq-pop" : "text-muted")
      }
      title="Right answers in a row"
    >
      ⚡{today.combo}
    </span>
  );
  return (
    <header className="border-b border-line bg-card pt-[env(safe-area-inset-top)] md:hidden">
      {lesson ? (
        <div className="flex h-14 items-center gap-3 px-3">
          <Link href="/" aria-label="Back to Home" className="icon-btn !h-10 !w-10 text-xl">
            ✕
          </Link>
          <span className="cjk text-lg text-accent" aria-label={route.label}>
            {routeIcon(route, 28)}
          </span>
          <div
            className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line"
            title={"Daily goal: " + minutes + " of " + goal + " minutes"}
          >
            <div
              className={
                "absolute inset-y-0 left-0 rounded-full transition-all duration-500 " +
                (today.goalHit ? "bg-ok" : "bg-accent")
              }
              style={{ width: Math.max(4, pct) + "%" }}
            />
            <div
              className="absolute inset-x-2 top-[3px] h-1 rounded-full bg-white/25"
              style={{ width: "calc(" + Math.max(4, pct) + "% - 1rem)" }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums text-muted">
            {minutes}/{goal}m
          </span>
          {combo}
          <button className="icon-btn !h-9 !w-9" onClick={onSfx} aria-label={sfxOn ? "Mute sounds" : "Turn sounds on"}>
            {sfxOn ? "🔊" : "🔇"}
          </button>
        </div>
      ) : (
        <div className="flex h-14 items-center gap-2.5 px-4">
          <span
            className={
              "cjk grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg " +
              (route.area === "home" ? "bg-accent text-white" : "bg-accent-soft text-accent")
            }
          >
            {route.area === "home" ? "注" : routeIcon(route, 36)}
          </span>
          <div className="min-w-0 flex-1 truncate font-semibold">
            {route.area === "home" ? "bopomofo" : route.label}
          </div>
          <span className="hud !h-8 !px-2.5" title="Days in a row with practice">
            🔥<b className="tabular-nums">{dayStreak ?? "–"}</b>
          </span>
          <span className="hud !h-8 !px-2.5">{combo}</span>
          <button className="icon-btn !h-9 !w-9" onClick={onSfx} aria-label={sfxOn ? "Mute sounds" : "Turn sounds on"}>
            {sfxOn ? "🔊" : "🔇"}
          </button>
          <span className="grid h-9 w-9 place-items-center">
            <UserButton />
          </span>
        </div>
      )}
      <div className="flex justify-end border-t border-line px-4 py-1.5">
        <AiEnergyBadge />
      </div>
      {!status.ok && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-xs">
          <i className={"inline-block h-2 w-2 rounded-full " + status.cls} />
          <b>{status.label}</b>
          <span className="truncate text-muted">{status.tip}</span>
        </div>
      )}
    </header>
  );
}
