"use client";
// The level path on the client: which exercises are open, and the level that opens each locked one.
// One provider in the app shell loads GET /api/levels, and loads it again after a screen change or a level message.
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type LevelInfo, type Levels } from "./api";

/** The exercises of each screen. The first open one is the default variant of the screen. */
export const ROUTE_EXERCISES: Record<string, string[]> = {
  "/symbols": ["symbols"],
  "/reading": ["reading"],
  "/recognize": ["recognize"],
  "/dictation": ["dictation"],
  "/listening": ["listening/tone", "listening/zhuyin", "listening/rule"],
  "/writing": ["writing/symbol", "writing/syllable", "writing/word"],
  "/speaking": ["speaking/syllable", "speaking/word", "speaking/sentence", "speaking/custom", "speaking/rule"],
  "/sentences": ["sentences"],
};

/** One short line per exercise, for the Home tiles and the level path. */
export const EXERCISE_DESC: Record<string, string> = {
  symbols: "The symbols, with their sound and strokes",
  reading: "See a symbol, say it out loud",
  recognize: "See a symbol, type its pinyin",
  "listening/tone": "Hear a syllable, name its tone",
  "listening/zhuyin": "Hear a syllable, pick its Bopomofo",
  "listening/rule": "Hear how tones change in words",
  dictation: "Hear a symbol, write it",
  "writing/symbol": "Write symbols, stroke by stroke",
  "writing/syllable": "Hear a syllable, write it",
  "writing/word": "Hear a word, write it",
  "speaking/syllable": "Say syllables, get every sound checked",
  "speaking/rule": "Say the tone changes in words",
  "speaking/word": "Say the words of your sentences",
  "speaking/sentence": "Say sentences about your life",
  "speaking/custom": "Say any text you type",
  sentences: "Make sentences on any topic",
};

/** The exercise of a link, like levels.exercise_of in the backend: /listening?quiz=zhuyin is "listening/zhuyin". */
export function exerciseOf(href: string): string | null {
  const [path, query = ""] = href.split("?");
  const q = new URLSearchParams(query);
  if (path === "/listening")
    return (
      ({ zhuyin: "listening/zhuyin", rule: "listening/rule" } as Record<string, string>)[q.get("quiz") ?? ""] ??
      "listening/tone"
    );
  if (path === "/speaking") {
    const s = q.get("source") ?? "";
    return (
      "speaking/" + (["syllable", "word", "custom", "rule"].includes(s) ? s : q.get("text") ? "custom" : "sentence")
    );
  }
  if (path === "/writing") {
    const m = q.get("mode") ?? "";
    return "writing/" + (m === "symbol" || m === "word" ? m : "syllable");
  }
  const key = path.replace(/^\/+|\/+$/g, "");
  return ROUTE_EXERCISES["/" + key] ? key : null;
}

/** The name of a goal item: "tone 3", "neutral tone", "3-3 rule", or the symbol itself. */
export function itemLabel(item: string): string {
  if (item === "tone:5") return "neutral tone";
  if (item.startsWith("tone:")) return "tone " + item.slice(5);
  if (item.startsWith("rule:"))
    return (
      ({ "3-3": "3-3 rule", bu: "不 rule", yi: "一 rule" } as Record<string, string>)[item.slice(5)] ?? item.slice(5)
    );
  return item;
}

type Ctx = {
  lv: Levels | null;
  /** True when the level path is loaded, or could not load (then every exercise counts as open). */
  known: boolean;
  open: (exercise: string) => boolean;
  /** A screen is open when one of its exercises is open. Screens without exercises (Home, Stats, Settings) are always open. */
  routeOpen: (href: string) => boolean;
  /** The level that opens an exercise. */
  levelOf: (exercise: string) => LevelInfo | null;
  /** The open exercises of a screen, in their default order. */
  openOf: (href: string) => string[];
  refresh: () => void;
};

const LevelsContext = createContext<Ctx | null>(null);

export function LevelsProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [lv, setLv] = useState<Levels | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  const refresh = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    let stop = false;
    api
      .levels()
      .then((r) => {
        if (stop) return;
        setLv(r);
        setFailed(false);
        // Unseen messages (for example an unlock from the placement, or from another device) go to the app shell like the messages of an answer.
        if (r.notices?.length) window.dispatchEvent(new CustomEvent("zs:levels", { detail: r.notices }));
      })
      .catch(() => {
        if (!stop) setFailed(true);
      });
    return () => {
      stop = true;
    };
  }, [path, n]);

  const value = useMemo<Ctx>(() => {
    const set = new Set(lv?.exercises ?? []);
    const open = (ex: string) => (lv ? set.has(ex) : failed);
    const openOf = (href: string) => (ROUTE_EXERCISES[href.split("?")[0]] ?? []).filter(open);
    return {
      lv,
      known: !!lv || failed,
      open,
      openOf,
      routeOpen: (href: string) => {
        const ex = ROUTE_EXERCISES[href.split("?")[0]];
        return !ex || ex.some(open);
      },
      levelOf: (ex: string) => lv?.levels.find((l) => l.opens.some((o) => o.key === ex)) ?? null,
      refresh,
    };
  }, [lv, failed, refresh]);

  return <LevelsContext.Provider value={value}>{children}</LevelsContext.Provider>;
}

const NONE: Ctx = {
  lv: null,
  known: true,
  open: () => true,
  routeOpen: () => true,
  levelOf: () => null,
  openOf: (h) => ROUTE_EXERCISES[h] ?? [],
  refresh: () => {},
};

/** The level path. Outside the provider (tests, the onboarding), every exercise counts as open. */
export const useLevels = (): Ctx => useContext(LevelsContext) ?? NONE;
