"use client";
// Today's practice, kept in the browser: active minutes, cards, accuracy, and the combo across all screens.
// The backend keeps the full history; this only drives the HUD and the daily goal.
import { useSyncExternalStore } from "react";
import { setPref } from "./prefs";

export type Today = { date: string; cards: number; ok: number; combo: number; best: number; seconds: number; goalHit: boolean; areas: Record<string, number> };

const KEY = "zhuyin.today";
const GOAL_KEY = "zhuyin.goal";
const IDLE_MS = 60_000; // no key, click, or answer for this long: the clock stops
const EMPTY: Today = { date: "", cards: 0, ok: 0, combo: 0, best: 0, seconds: 0, goalHit: false, areas: {} };

const dayOf = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const subs = new Set<() => void>();
let cache: Today | null = null;
let lastActive = 0;

function read(): Today {
  if (typeof window === "undefined") return EMPTY;
  const day = dayOf();
  if (cache && cache.date === day) return cache;
  let t: Today | null = null;
  try { t = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch {}
  cache = t && t.date === day ? { ...EMPTY, ...t } : { ...EMPTY, date: day };
  return cache;
}

function write(t: Today) {
  cache = t;
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
  subs.forEach((f) => f());
}

export const GOAL_KEY_NAME = GOAL_KEY;
export const goalMinutes = () => (typeof window === "undefined" ? 20 : Number(localStorage.getItem(GOAL_KEY)) || 20);
export const setGoalMinutes = (m: number) => {
  setPref(GOAL_KEY, String(m));
  const t = read();
  write({ ...t, goalHit: t.seconds >= m * 60 });
};

export const markActive = () => { lastActive = Date.now(); };

/** Called for every graded answer (from api.attempt). */
export function recordAttempt(area: string, ok: boolean) {
  markActive();
  const t = read();
  const combo = ok ? t.combo + 1 : 0;
  write({ ...t, cards: t.cards + 1, ok: t.ok + (ok ? 1 : 0), combo, best: Math.max(t.best, combo), areas: { ...t.areas, [area]: (t.areas[area] ?? 0) + 1 } });
}

/** Add active time. Returns true once, when this tick reaches the daily goal. */
export function tick(seconds: number): boolean {
  if (document.visibilityState !== "visible" || Date.now() - lastActive > IDLE_MS) return false;
  const t = read();
  const s = t.seconds + seconds;
  const hit = !t.goalHit && s >= goalMinutes() * 60;
  write({ ...t, seconds: s, goalHit: t.goalHit || hit });
  return hit;
}

export function useToday(): Today {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, read, () => EMPTY);
}
