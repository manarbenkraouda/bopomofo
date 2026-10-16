"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { Kbd } from "@/components/shell/Kbd";
import { api, type Stats as Data } from "@/lib/api";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { setPref, usePref } from "@/lib/prefs";
import { PHONE, useViewport } from "@/lib/useFit";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActivityView } from "./ActivityView";
import { AREA_LABEL, AREA_ORDER } from "./charts";
import { GRID_COLS, SYMS, trainHref, WEAK_SHOWN } from "./display";
import { OverviewView } from "./OverviewView";
import { SoundsView } from "./SoundsView";
import { SymbolsView } from "./SymbolsView";
import { TonesView } from "./TonesView";

// The ids "today" and "history" are kept so the saved tab of older versions still opens.
type Tab = "today" | "tones" | "sounds" | "symbols" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Overview" },
  { id: "tones", label: "Tones" },
  { id: "sounds", label: "Sounds" },
  { id: "symbols", label: "Symbols" },
  { id: "history", label: "Activity" },
];

const RANGES = [1, 7, 30, 90, 0];

const RANGE_LABEL: Record<number, string> = { 1: "Today", 7: "7 days", 30: "30 days", 90: "90 days", 0: "All time" };

const AREAS = ["", ...AREA_ORDER];

const CHALLENGE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR"];

/**
 * The stats page. Overview answers three questions: how am I doing, how is each skill, what should I train next.
 * The other tabs show one summary each; the full tables open on request.
 */
export function Stats() {
  const router = useRouter();
  const tab = usePref("zhuyin.stats.tab", "today") as Tab;
  const days = Number(usePref("zhuyin.stats.days", "30"));
  const area = usePref("zhuyin.stats.area", "");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(0); // selected weak spot (Overview) or symbol (Symbols)
  const [allWeak, setAllWeak] = useState(false);
  const [sheet, setSheet] = useState(false); // phone: symbol details as a bottom sheet
  const { w } = useViewport();

  useEffect(() => {
    let stop = false;
    api
      .stats(days, area)
      .then((d) => {
        if (!stop) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => !stop && setError((e as Error).message));
    return () => {
      stop = true;
    };
  }, [days, area]);

  const setTab = (t: Tab) => {
    setPref("zhuyin.stats.tab", t);
    setSel(0);
  };
  const setDays = (d: number) => setPref("zhuyin.stats.days", String(d));
  const setArea = (a: string) => setPref("zhuyin.stats.area", a);

  const weak = data?.weak ?? [];
  const weakShown = allWeak ? weak : weak.slice(0, WEAK_SHOWN);
  const challenges = data?.challenges ?? [];
  const listLen = tab === "today" ? weakShown.length : tab === "symbols" ? SYMS.length : 0;
  const move = (d: number) => setSel((s) => Math.max(0, Math.min(listLen - 1, s + d)));
  const selectedHref =
    tab === "today"
      ? weakShown[sel]?.href
      : tab === "symbols"
        ? trainHref(area || "dictation", "symbol", [SYMS[sel]])
        : undefined;

  useHotkeys("stats", [
    ...TABS.map((t, i) => ({
      keys: ["Digit" + (i + 1), "Numpad" + (i + 1)],
      label: t.label,
      run: () => setTab(t.id),
      bar: false,
    })),
    { keys: [], label: "View", show: ["1-5"] },
    ...cycleKeys("Range", RANGES, days, setDays),
    {
      keys: ["KeyA"],
      label: "Area: " + (AREA_LABEL[area] ?? "all"),
      run: () => setArea(AREAS[(AREAS.indexOf(area) + 1) % AREAS.length]),
    },
    {
      keys: ["Shift+KeyA"],
      label: "Previous area",
      run: () => setArea(AREAS[(AREAS.indexOf(area) + AREAS.length - 1) % AREAS.length]),
      bar: false,
    },
    {
      keys: ["ArrowDown", "KeyJ"],
      label: "Next",
      run: () => move(tab === "symbols" ? GRID_COLS : 1),
      when: listLen > 0,
      repeat: true,
      bar: false,
    },
    {
      keys: ["ArrowUp", "KeyK"],
      label: "Previous",
      run: () => move(tab === "symbols" ? -GRID_COLS : -1),
      when: listLen > 0,
      repeat: true,
      bar: false,
    },
    {
      keys: ["ArrowRight", "KeyL"],
      label: "Right",
      run: () => move(1),
      when: tab === "symbols",
      repeat: true,
      bar: false,
    },
    {
      keys: ["ArrowLeft", "KeyH"],
      label: "Left",
      run: () => move(-1),
      when: tab === "symbols",
      repeat: true,
      bar: false,
    },
    { keys: [], label: "Select", show: ["↑", "↓"], when: listLen > 0 },
    {
      keys: ["Enter"],
      label: "Train this",
      run: () => selectedHref && router.push(selectedHref),
      when: !!selectedHref,
    },
    ...CHALLENGE_KEYS.map((k, i) => ({
      keys: [k],
      label: "Challenge " + (i + 1) + ": " + (challenges[i]?.title ?? ""),
      run: () => router.push(challenges[i].href),
      when: tab === "today" && !!challenges[i],
      bar: false,
    })),
    { keys: [], label: "Challenges", show: ["Q", "W", "E", "R"], when: tab === "today" && challenges.length > 0 },
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-5">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 bg-bg/90 px-4 pb-2 pt-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
        <div className="chips -mx-1 flex w-full gap-1.5 overflow-x-auto px-1 md:w-auto">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              className="chip flex shrink-0 items-center gap-1.5"
              data-active={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <Kbd className="max-md:!hidden">{i + 1}</Kbd>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 md:ml-auto">
          <select
            className="input !py-1.5 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            title="Range ([ and ])"
          >
            {RANGES.map((d) => (
              <option key={d} value={d}>
                {RANGE_LABEL[d]}
              </option>
            ))}
          </select>
          <select
            className="input !py-1.5 text-sm"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            title="Area (A)"
          >
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a ? AREA_LABEL[a] : "All areas"}
              </option>
            ))}
          </select>
          <span className="flex gap-0.5 max-md:hidden">
            <Kbd>[</Kbd>
            <Kbd>]</Kbd>
            <Kbd>A</Kbd>
          </span>
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-bad">{error}</div>}
      {!data && !error && <div className="text-muted">Loading your history…</div>}
      {data && !data.overview.cards && tab !== "history" && tab !== "today" && (
        <div className="card flex items-center gap-4 p-6 text-muted">
          <BoboPose pose="investigate" className="w-20 md:w-24" />
          Bobo found no answers in this range yet. Practice a little, or choose a longer range with ] .
        </div>
      )}
      {data && tab === "today" && (
        <OverviewView
          data={data}
          days={days}
          weak={weakShown}
          sel={sel}
          setSel={setSel}
          allWeak={allWeak}
          toggleWeak={() => {
            setAllWeak((v) => !v);
            setSel(0);
          }}
        />
      )}
      {data && tab === "tones" && data.overview.cards > 0 && <TonesView data={data} />}
      {data && tab === "sounds" && data.overview.cards > 0 && <SoundsView data={data} />}
      {data && tab === "symbols" && data.overview.cards > 0 && (
        <SymbolsView
          data={data}
          area={area}
          sel={sel}
          onPick={(i) => {
            setSel(i);
            if (w < 1024) setSheet(true);
          }}
          sheet={sheet}
          closeSheet={() => setSheet(false)}
        />
      )}
      {data && tab === "history" && <ActivityView data={data} phone={w < PHONE} />}
    </div>
  );
}
