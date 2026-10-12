"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, downloadExport, type ItemStat, type Stats as Data } from "@/lib/api";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { exerciseOf, useLevels } from "@/lib/levels";
import { setPref, usePref } from "@/lib/prefs";
import { goalMinutes } from "@/lib/session";
import { PHONE, useViewport } from "@/lib/useFit";
import { INITIALS } from "@/lib/zhuyin";
import { Kbd } from "@/components/shell/Kbd";
import { BoboPose } from "@/components/mascot/Bobo";
import { AccGrid, AREA_COLOR, AREA_LABEL, AREA_ORDER, accTone, Calendar, DailyChart, Disclosure, Hours, Matrix, Meter, pct, secs, Segmented, shortDay, tint } from "./charts";

// The ids "today" and "history" are kept so the saved tab of older versions still opens.
type Tab = "today" | "tones" | "sounds" | "symbols" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Overview" }, { id: "tones", label: "Tones" }, { id: "sounds", label: "Sounds" }, { id: "symbols", label: "Symbols" }, { id: "history", label: "Activity" },
];
const RANGES = [1, 7, 30, 90, 0];
const RANGE_LABEL: Record<number, string> = { 1: "Today", 7: "7 days", 30: "30 days", 90: "90 days", 0: "All time" };
const rangeTitle = (d: number) => (d === 1 ? "Today" : d === 0 ? "All time" : "Last " + d + " days");
const AREAS = ["", ...AREA_ORDER];
const SYMS = [...INITIALS, ..."ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ"];
const GRID_COLS = 7;
const CHALLENGE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR"];
const TONES = ["1", "2", "3", "4", "5"];
const WEAK_SHOWN = 3;

const toneName = (t: string) => (t === "5" ? "Neutral" : t === "?" ? "Unclear" : "Tone " + t);
const toneShort = (t: string) => (t === "5" ? "N" : t === "?" ? "?" : t);
/** What was produced instead, in words. */
const said = (kind: string, a: string) => (a === "?" ? (kind === "tone" ? "unclear" : "not heard") : a === "∅" ? "nothing" : kind === "tone" ? toneName(a).toLowerCase() : a);
const itemName = (it: { kind: string; expected: string }) =>
  it.kind === "tone" ? toneName(it.expected) : it.kind === "initial" ? "Initial " + it.expected : it.kind === "final" ? "Final " + it.expected : it.expected;
const trainHref = (area: string, kind: string, vals: string[]) => {
  const v = encodeURIComponent(vals.filter((x) => x && x !== "∅" && x !== "?").join(","));
  if (kind === "tone") return area === "listening" ? "/listening?quiz=tone&tones=" + v : area === "writing" ? "/writing?mode=syllable&tones=" + v : "/speaking?source=syllable&tones=" + v;
  if (kind === "symbol") return area === "reading" ? "/reading?syms=" + v : area === "recognize" ? "/recognize?syms=" + v : area === "writing" ? "/writing?mode=symbol&syms=" + v : "/dictation?syms=" + v;
  return area === "listening" ? "/listening?quiz=zhuyin&syms=" + v : "/speaking?source=syllable&syms=" + v;
};
const percent = (p: number | null | undefined) => (p == null ? "–" : Math.round(p) + "%");

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
    api.stats(days, area).then((d) => { if (!stop) { setData(d); setError(""); } }).catch((e) => !stop && setError((e as Error).message));
    return () => { stop = true; };
  }, [days, area]);

  const setTab = (t: Tab) => { setPref("zhuyin.stats.tab", t); setSel(0); };
  const setDays = (d: number) => setPref("zhuyin.stats.days", String(d));
  const setArea = (a: string) => setPref("zhuyin.stats.area", a);

  const weak = data?.weak ?? [];
  const weakShown = allWeak ? weak : weak.slice(0, WEAK_SHOWN);
  const challenges = data?.challenges ?? [];
  const listLen = tab === "today" ? weakShown.length : tab === "symbols" ? SYMS.length : 0;
  const move = (d: number) => setSel((s) => Math.max(0, Math.min(listLen - 1, s + d)));
  const selectedHref = tab === "today" ? weakShown[sel]?.href : tab === "symbols" ? trainHref(area || "dictation", "symbol", [SYMS[sel]]) : undefined;

  useHotkeys("stats", [
    ...TABS.map((t, i) => ({ keys: ["Digit" + (i + 1), "Numpad" + (i + 1)], label: t.label, run: () => setTab(t.id), bar: false })),
    { keys: [], label: "View", show: ["1-5"] },
    ...cycleKeys("Range", RANGES, days, setDays),
    { keys: ["KeyA"], label: "Area: " + (AREA_LABEL[area] ?? "all"), run: () => setArea(AREAS[(AREAS.indexOf(area) + 1) % AREAS.length]) },
    { keys: ["Shift+KeyA"], label: "Previous area", run: () => setArea(AREAS[(AREAS.indexOf(area) + AREAS.length - 1) % AREAS.length]), bar: false },
    { keys: ["ArrowDown", "KeyJ"], label: "Next", run: () => move(tab === "symbols" ? GRID_COLS : 1), when: listLen > 0, repeat: true, bar: false },
    { keys: ["ArrowUp", "KeyK"], label: "Previous", run: () => move(tab === "symbols" ? -GRID_COLS : -1), when: listLen > 0, repeat: true, bar: false },
    { keys: ["ArrowRight", "KeyL"], label: "Right", run: () => move(1), when: tab === "symbols", repeat: true, bar: false },
    { keys: ["ArrowLeft", "KeyH"], label: "Left", run: () => move(-1), when: tab === "symbols", repeat: true, bar: false },
    { keys: [], label: "Select", show: ["↑", "↓"], when: listLen > 0 },
    { keys: ["Enter"], label: "Train this", run: () => selectedHref && router.push(selectedHref), when: !!selectedHref },
    ...CHALLENGE_KEYS.map((k, i) => ({ keys: [k], label: "Challenge " + (i + 1) + ": " + (challenges[i]?.title ?? ""), run: () => router.push(challenges[i].href), when: tab === "today" && !!challenges[i], bar: false })),
    { keys: [], label: "Challenges", show: ["Q", "W", "E", "R"], when: tab === "today" && challenges.length > 0 },
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-5">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 bg-bg/90 px-4 pb-2 pt-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
        <div className="chips -mx-1 flex w-full gap-1.5 overflow-x-auto px-1 md:w-auto">
          {TABS.map((t, i) => (
            <button key={t.id} className="chip flex shrink-0 items-center gap-1.5" data-active={tab === t.id} onClick={() => setTab(t.id)}>
              <Kbd className="max-md:!hidden">{i + 1}</Kbd>{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 md:ml-auto">
          <select className="input !py-1.5 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} title="Range ([ and ])">
            {RANGES.map((d) => <option key={d} value={d}>{RANGE_LABEL[d]}</option>)}
          </select>
          <select className="input !py-1.5 text-sm" value={area} onChange={(e) => setArea(e.target.value)} title="Area (A)">
            {AREAS.map((a) => <option key={a} value={a}>{a ? AREA_LABEL[a] : "All areas"}</option>)}
          </select>
          <span className="flex gap-0.5 max-md:hidden"><Kbd>[</Kbd><Kbd>]</Kbd><Kbd>A</Kbd></span>
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-bad">{error}</div>}
      {!data && !error && <div className="text-muted">Loading your history…</div>}
      {data && !data.overview.cards && tab !== "history" && tab !== "today" && (
        <div className="card flex items-center gap-4 p-6 text-muted"><BoboPose pose="investigate" className="w-20 md:w-24" />Bobo found no answers in this range yet. Practice a little, or choose a longer range with ] .</div>
      )}
      {data && tab === "today" && (
        <OverviewView data={data} days={days} weak={weakShown} sel={sel} setSel={setSel} allWeak={allWeak} toggleWeak={() => { setAllWeak((v) => !v); setSel(0); }} />
      )}
      {data && tab === "tones" && data.overview.cards > 0 && <TonesView data={data} />}
      {data && tab === "sounds" && data.overview.cards > 0 && <SoundsView data={data} />}
      {data && tab === "symbols" && data.overview.cards > 0 && (
        <SymbolsView data={data} area={area} sel={sel} onPick={(i) => { setSel(i); if (w < 1024) setSheet(true); }} sheet={sheet} closeSheet={() => setSheet(false)} />
      )}
      {data && tab === "history" && <ActivityView data={data} phone={w < PHONE} />}
    </div>
  );
}

// ---------- Overview ----------

function OverviewView({ data, days, weak, sel, setSel, allWeak, toggleWeak }: {
  data: Data; days: number; weak: Data["weak"]; sel: number; setSel: (i: number) => void; allWeak: boolean; toggleWeak: () => void;
}) {
  const o = data.overview;
  // Areas with enough answers to compare, best first.
  const ranked = AREA_ORDER.filter((a) => data.areas[a]?.acc != null && data.areas[a].n >= 10).sort((x, y) => data.areas[y].acc! - data.areas[x].acc!);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const vs = days ? "vs the " + (days === 1 ? "day" : days + " days") + " before" : "";
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card relative overflow-hidden p-5 md:p-6">
        <div className="pointer-events-none absolute -bottom-10 -right-2 select-none cjk text-[140px] leading-none text-accent opacity-[.06]">成績</div>
        <div className="relative text-xs font-semibold uppercase tracking-wide text-accent">{rangeTitle(days)}</div>
        {o.cards ? (
          <>
            <p className="relative mt-2 max-w-3xl text-xl font-semibold leading-snug md:text-2xl">
              {best && worst ? <>{AREA_LABEL[best]} is your strongest skill. {AREA_LABEL[worst]} needs the most work.</>
                : best ? <>{AREA_LABEL[best]} is where you practice most.</> : <>You are just getting started.</>}
            </p>
            <div className="relative mt-5 grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-4">
              <Big label="answers" value={String(o.cards)} delta={o.prev ? o.cards - o.prev.cards : null} />
              <Big label="right" value={percent(o.acc)} delta={o.prev && o.acc != null && o.prev.acc != null ? Math.round(o.acc - o.prev.acc) : null} unit=" pts" />
              <Big label="minutes" value={String(o.minutes)} delta={o.prev ? o.minutes - o.prev.minutes : null} />
              {o.ms != null && <Big label="per answer" value={secs(o.ms)} delta={o.prev && o.prev.ms != null ? -Math.round((o.ms - o.prev.ms) / 100) / 10 : null} unit=" s faster" />}
            </div>
            {vs && o.prev && <div className="relative mt-2 text-[11px] text-muted">Changes: {vs}</div>}
          </>
        ) : <p className="relative mt-2 flex items-center gap-4 text-muted"><BoboPose pose="investigate" className="w-20" />Bobo found no answers in this range yet. Practice a little, or choose a longer range with ] .</p>}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold">Your skills <span className="font-normal text-muted">· first try, without help</span></h2>
        {/* Phone: one compact list. Wider: a tile per skill. */}
        <div className="card flex flex-col divide-y divide-line sm:hidden">
          {AREA_ORDER.map((a) => {
            const s = data.areas[a];
            const few = !s || s.n < 5;
            return (
              <Link key={a} href={"/" + a} className="flex items-center gap-3 px-4 py-3">
                <span className="flex w-24 shrink-0 items-center gap-2 text-sm font-semibold"><i className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[a] }} />{AREA_LABEL[a]}</span>
                <span className="flex-1">{s?.n ? <Meter value={s.acc} color={few ? "var(--muted)" : undefined} /> : <span className="text-xs text-muted">not practiced</span>}</span>
                <span className="w-11 text-right text-lg font-semibold tabular-nums" style={{ color: few ? "var(--muted)" : accTone(s.acc) }}>{s?.n ? percent(s.acc) : ""}</span>
              </Link>
            );
          })}
        </div>
        <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-5">
          {AREA_ORDER.map((a) => <SkillTile key={a} area={a} s={data.areas[a]} />)}
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
              {weak.map((it, i) => <WeakRow key={it.area + it.kind + it.expected} it={it} active={i === sel} onHover={() => setSel(i)} />)}
            </div>
          ) : <div className="text-sm text-muted">No weak spots yet: each needs at least 3 answers. Keep practicing.</div>}
          {data.weak.length > WEAK_SHOWN && (
            <button className="mt-3 text-sm text-accent hover:underline" onClick={toggleWeak}>{allWeak ? "Show the top " + WEAK_SHOWN : "Show all " + data.weak.length}</button>
          )}
        </section>

        <section className="card p-4 md:p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="font-semibold">Today&apos;s challenges</h2>
            <span className="text-xs text-muted">{data.challenges.filter((c) => c.done).length}/{data.challenges.length} done</span>
          </div>
          {data.challenges.length ? (
            <div className="flex flex-col gap-1">
              {data.challenges.map((c, i) => (
                <Link key={c.id} href={c.href} title={c.why} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raise">
                  <span className={"grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-xs font-bold " + (c.done ? "border-ok bg-ok text-white" : "border-line")}
                    style={c.done ? undefined : { borderColor: tint(AREA_COLOR[c.area], 70) }}>{c.done ? "✓" : ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className={"cjk block truncate text-sm font-medium " + (c.done ? "text-muted line-through decoration-muted/50" : "")}>{c.title}</span>
                    {!c.done && <span className="mt-1 block"><Meter value={(100 * c.progress) / c.target} color="var(--accent)" /></span>}
                  </span>
                  <span className="text-xs tabular-nums text-muted">{c.progress}/{c.target}</span>
                  {!c.done && <Kbd className="max-md:!hidden">{"QWER"[i]}</Kbd>}
                </Link>
              ))}
            </div>
          ) : <div className="text-sm text-muted">Practice a few minutes to get challenges.</div>}
        </section>
      </div>
    </div>
  );
}

function SkillTile({ area, s }: { area: string; s: Data["areas"][string] | undefined }) {
  if (!s || !s.n) {
    return (
      <Link href={"/" + area} className="card tile flex flex-col gap-1.5 border-dashed p-4 transition hover:border-accent/60">
        <span className="flex items-center gap-2 text-sm font-semibold"><i className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[area] }} />{AREA_LABEL[area]}</span>
        <span className="text-sm text-muted">Not practiced in this range</span>
        <span className="mt-auto text-xs text-accent">Start →</span>
      </Link>
    );
  }
  // A few answers say nothing yet: show them, but not as a red or green verdict.
  const few = s.n < 5;
  const extra = few ? "too few to judge" : area === "speaking" && s.score != null ? "avg score " + Math.round(s.score) : s.help && s.help >= 25 ? "help on " + Math.round(s.help) + "%" : "";
  return (
    <Link href={"/" + area} className="card tile flex flex-col gap-2 p-4 transition hover:border-accent/60">
      <span className="flex items-center gap-2 text-sm font-semibold"><i className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[area] }} />{AREA_LABEL[area]}</span>
      <span className="text-3xl font-semibold tabular-nums" style={{ color: few ? "var(--muted)" : accTone(s.acc) }}>{percent(s.acc)}</span>
      <Meter value={s.acc} color={few ? "var(--muted)" : undefined} />
      <span className="text-xs text-muted">{s.n} answer{s.n === 1 ? "" : "s"}{extra ? " · " + extra : ""}</span>
    </Link>
  );
}

function WeakRow({ it, active, onHover }: { it: Data["weak"][number]; active: boolean; onHover: () => void }) {
  return (
    <Link href={it.href} onMouseEnter={onHover} data-current={active}
      className={"grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition " + (active ? "border-accent/60 bg-accent-soft" : "border-transparent hover:bg-raise")}>
      <span className="cjk grid h-11 min-w-11 place-items-center rounded-xl px-1.5 text-lg font-semibold" style={{ background: tint(accTone(it.post), 22), color: accTone(it.post) }}>
        {it.kind === "tone" ? toneShort(it.expected) : it.expected}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="cjk font-semibold">{itemName(it)}</span>
          <span className="text-xs" style={{ color: AREA_COLOR[it.area] }}>{AREA_LABEL[it.area]}</span>
        </span>
        <span className="cjk block truncate text-xs text-muted">
          {it.ok} of {it.n} right{it.top.length ? " · often " + said(it.kind, it.top[0][0]) + " instead" : ""}
        </span>
      </span>
      <span className="flex items-center gap-2 text-right">
        <Trend it={it} />
        <span className="w-12 text-xl font-semibold tabular-nums" style={{ color: accTone(it.post) }}>{Math.round(it.post)}%</span>
        {active && <Kbd className="max-md:!hidden">Enter</Kbd>}
      </span>
    </Link>
  );
}

function Trend({ it }: { it: ItemStat }) {
  if (it.recent == null || it.before == null || it.recent_n < 3) return null;
  const d = Math.round(it.recent - it.before);
  if (Math.abs(d) < 5) return <span className="text-xs text-muted" title="This week vs before">→</span>;
  return <span className={"text-xs font-semibold " + (d > 0 ? "text-ok" : "text-bad")} title="This week vs before">{d > 0 ? "↑" : "↓"}{Math.abs(d)}</span>;
}

function Big({ label, value, delta, unit = "" }: { label: string; value: string; delta: number | null; unit?: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums md:text-3xl">{value}</div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted">
        {label}
        {delta != null && delta !== 0 && <span className={"font-semibold " + (delta > 0 ? "text-ok" : "text-bad")}>{delta > 0 ? "+" : "−"}{Math.abs(delta)}{unit}</span>}
      </div>
    </div>
  );
}

// ---------- Tones ----------

function confusionOf(data: Data, area: string, kind: string) {
  const m = new Map<string, number>();
  for (const c of data.confusion) if (c.area === area && c.kind === kind) m.set(c.expected + "|" + c.actual, c.n);
  return (r: string, c: string) => m.get(r + "|" + c) ?? 0;
}

/** The most frequent mix-ups of a kind, in words: expected, produced instead, count, and share of the expected item. */
function mixups(data: Data, kind: string, area?: string) {
  const totals = new Map<string, number>();
  for (const c of data.confusion) if (c.kind === kind && (!area || c.area === area)) totals.set(c.area + "|" + c.expected, (totals.get(c.area + "|" + c.expected) ?? 0) + c.n);
  return data.confusion
    .filter((c) => c.kind === kind && (!area || c.area === area) && c.actual !== c.expected)
    .map((c) => ({ ...c, share: pct(c.n, totals.get(c.area + "|" + c.expected) ?? 0) }))
    .sort((a, b) => b.n - a.n);
}

const MATRIX_INFO: Record<string, { title: string; note: string; cols: string[] }> = {
  speaking: { title: "Speaking", note: "Rows: the tone as it should be said (after tone changes). Columns: what the app heard. ? = not heard or not clear.", cols: [...TONES, "?"] },
  listening: { title: "Listening", note: "Rows: the tone you heard. Columns: your answer.", cols: TONES.slice(0, 4) },
  writing: { title: "Writing", note: "Rows: the tone to write. Columns: the mark you wrote. Tone 1 = no mark.", cols: TONES },
};
type Ctx = "prev" | "next" | "position" | "sandhi" | "source";

function TonesView({ data }: { data: Data }) {
  const router = useRouter();
  const toneAreas = AREA_ORDER.filter((a) => data.items.some((i) => i.area === a && i.kind === "tone"));
  const item = (a: string, t: string) => data.items.find((i) => i.area === a && i.kind === "tone" && i.expected === t);
  const rows = TONES.filter((t) => toneAreas.some((a) => item(a, t)));
  const weakest = data.items.filter((i) => i.kind === "tone" && i.n >= 5 && i.acc != null).sort((x, y) => x.acc! - y.acc!)[0];
  const mix = mixups(data, "tone").filter((m) => m.actual !== "?").slice(0, 6);
  const matrixAreas = Object.keys(MATRIX_INFO).filter((a) => data.confusion.some((c) => c.area === a && c.kind === "tone"));
  const [mArea, setMArea] = useState(matrixAreas[0] ?? "speaking");
  const ctx = data.tone_ctx;
  const [view, setView] = useState<Ctx>("prev");
  const look = (list: { k: string[]; n: number; ok: number }[]) => {
    const m = new Map(list.map((x) => [x.k.join("|"), x]));
    return (r: string, c: string) => m.get(r + "|" + c);
  };
  const info = MATRIX_INFO[mArea];
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <RulesSection data={data} />
      <section className="card p-4 md:p-5">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
          <h2 className="font-semibold">Tones at a glance</h2>
          <span className="text-xs text-muted">first try, without help · click a cell to train it</span>
        </div>
        {weakest && (
          <p className="mb-4 text-sm text-muted">
            Weakest: <b className="text-ink">{weakest.expected === "5" ? "the neutral tone" : "tone " + weakest.expected}</b> in {AREA_LABEL[weakest.area].toLowerCase()}, {percent(weakest.acc)} right over {weakest.n} answers.
          </p>
        )}
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-sm sm:border-spacing-1.5">
              <thead>
                <tr>
                  <th className="w-16 sm:w-20" />
                  {toneAreas.map((a) => <th key={a} className="pb-1 text-xs font-semibold" style={{ color: AREA_COLOR[a] }}>{AREA_LABEL[a]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t}>
                    <th className="w-16 whitespace-nowrap pr-1 text-left text-sm font-semibold sm:w-20 sm:pr-2">{toneName(t)}</th>
                    {toneAreas.map((a) => {
                      const it = item(a, t);
                      if (!it) return <td key={a} className="h-14 rounded-xl bg-raise/60 text-center text-xs text-muted">–</td>;
                      const few = it.n < 5;
                      return (
                        <td key={a} className="h-14 p-0">
                          <Link href={trainHref(a, "tone", [t, ...it.top.map((x) => x[0])].slice(0, 2))} title={it.ok + " right of " + it.n}
                            className="flex h-full flex-col items-center justify-center rounded-xl transition hover:ring-2 hover:ring-accent"
                            style={{ background: few ? "var(--raise)" : tint(accTone(it.acc), 14 + Math.min(1, it.n / 30) * 26) }}>
                            <span className="flex items-baseline gap-1 text-base font-semibold tabular-nums">{percent(it.acc)} <Trend it={it} /></span>
                            <span className="text-[11px] tabular-nums text-muted">{few ? "only " + it.n : <>{it.n}<span className="max-sm:hidden"> answers</span></>}</span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-sm text-muted">No tone answers in this range.</div>}
      </section>

      <section className="card p-4 md:p-5">
        <h2 className="mb-3 font-semibold">What goes wrong</h2>
        {mix.length ? (
          <div className="flex flex-col gap-1">
            {mix.map((m) => (
              <Link key={m.area + m.expected + m.actual} href={trainHref(m.area, "tone", [m.expected, m.actual])} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-raise">
                <span className="w-20 shrink-0 text-xs" style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</span>
                <span className="min-w-0 flex-1"><b>{toneName(m.expected)}</b> <span className="text-muted">becomes</span> <b className="text-bad">{said("tone", m.actual)}</b></span>
                <span className="text-xs tabular-nums text-muted">{m.n}× · {m.share}% of the time</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No mix-ups saved yet. Older answers only saved right or wrong. New answers also save the tone you said, heard, or wrote, so this list fills up as you practice.</p>
        )}
      </section>

      {matrixAreas.length > 0 && (
        <Disclosure title="Full mix-up tables" hint="Every tone against every answer, one area at a time">
          <div className="flex flex-col gap-3">
            {matrixAreas.length > 1 && <Segmented options={matrixAreas.map((a) => ({ id: a, label: MATRIX_INFO[a].title }))} value={mArea} onChange={setMArea} />}
            <p className="text-xs text-muted">{info.note} Click a row to train it.</p>
            <div className="max-w-2xl overflow-x-auto">
              <Matrix rows={TONES.filter((t) => data.confusion.some((c) => c.area === mArea && c.kind === "tone" && c.expected === t))} cols={info.cols}
                get={confusionOf(data, mArea, "tone")} rowName={toneName} colName={toneShort} corner="expected ↓"
                onRow={(r) => {
                  const get = confusionOf(data, mArea, "tone");
                  const worst = info.cols.filter((c) => c !== r && c !== "?").sort((x, y) => get(r, y) - get(r, x))[0];
                  router.push(trainHref(mArea, "tone", get(r, worst) ? [r, worst] : [r]));
                }} />
            </div>
          </div>
        </Disclosure>
      )}

      {ctx.n > 0 && (
        <Disclosure title="Speaking in context" hint="How the tones around a syllable, its place, and tone changes affect your spoken tones">
          <div className="flex flex-col gap-3">
            <Segmented<Ctx> value={view} onChange={setView} options={[
              { id: "prev", label: "After a tone" }, { id: "next", label: "Before a tone" }, { id: "position", label: "Place in sentence" },
              { id: "sandhi", label: "Tone changes" }, { id: "source", label: "How it was judged" },
            ]} />
            <div className="max-w-2xl overflow-x-auto">
              {view === "prev" && <>
                <p className="mb-2 text-xs text-muted">Accuracy of a tone (columns) when the tone before it is the row.</p>
                <AccGrid rows={TONES} cols={TONES} get={look(ctx.prev)} rowName={(r) => "after " + toneShort(r)} colName={toneName} corner="before ↓" />
              </>}
              {view === "next" && <>
                <p className="mb-2 text-xs text-muted">Accuracy of a tone (rows) when the tone after it is the column.</p>
                <AccGrid rows={TONES} cols={TONES} get={look(ctx.next)} rowName={toneName} colName={(c) => "→ " + toneShort(c)} corner="tone ↓" />
              </>}
              {view === "position" && <>
                <p className="mb-2 text-xs text-muted">Alone = a single syllable, judged from your pitch.</p>
                <AccGrid rows={["alone", "first", "middle", "last"]} cols={TONES} get={look(ctx.position)} rowName={(r) => r} colName={toneName} />
              </>}
              {view === "sandhi" && <>
                <p className="mb-2 text-xs text-muted">Syllables said in another tone than their own, such as 你好 (3 → 2) or 不是 (4 → 2).</p>
                {ctx.sandhi.length ? [...ctx.sandhi].sort((a, b) => b.n - a.n).map((s) => (
                  <BarRow key={s.k.join()} label={toneName(s.k[0]) + " said as " + toneShort(s.k[1])} ok={s.ok} n={s.n} />
                )) : <div className="text-sm text-muted">No tone changes practiced in this range.</div>}
              </>}
              {view === "source" && <>
                <p className="mb-2 text-xs text-muted">Which signal judged the tone, and how often you were right by that signal.</p>
                {[...ctx.source].sort((a, b) => b.n - a.n).map((s) => (
                  <BarRow key={s.k[0]} label={s.k[0] === "model" ? "Speech model" : s.k[0] === "pitch" ? "Pitch curve" : s.k[0] === "model+pitch" ? "Model + your pitch range" : s.k[0]} ok={s.ok} n={s.n} />
                ))}
                {ctx.uncertain > 0 && <p className="mt-2 text-xs text-muted">{ctx.uncertain} of {ctx.n} tones: the model and the pitch curve disagreed.</p>}
              </>}
            </div>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

function BarRow({ label, ok, n }: { label: string; ok: number; n: number }) {
  return (
    <div className="flex items-center gap-3 py-1 text-sm">
      <span className="w-44 shrink-0">{label}</span>
      <div className="flex-1"><Meter value={pct(ok, n)} /></div>
      <span className="w-10 text-right tabular-nums">{pct(ok, n)}%</span>
      <span className="w-8 text-right text-xs text-muted">{n}</span>
    </div>
  );
}

// ---------- Sounds (initials and finals) ----------

function SoundsView({ data }: { data: Data }) {
  const parts = ["speaking", "listening"].flatMap((area) => ["initial", "final"].map((kind) => ({ id: area + ":" + kind, area, kind })))
    .filter(({ area, kind }) => data.expected.some((e) => e.area === area && e.kind === kind));
  const [pick, setPick] = useState("");
  if (!parts.length) return <div className="card p-6 text-muted">No initials or finals yet. Record sentences in Speaking, or use &quot;Which Bopomofo?&quot; in Listening.</div>;
  const part = parts.find((p) => p.id === pick) ?? parts[0];
  const { area, kind } = part;
  const exp = data.expected.filter((e) => e.area === area && e.kind === kind)
    .sort((a, b) => (kind === "initial" ? (a.expected === "∅" ? 99 : INITIALS.indexOf(a.expected)) - (b.expected === "∅" ? 99 : INITIALS.indexOf(b.expected)) : b.n - a.n));
  const hardest = exp.filter((e) => e.n >= 3).sort((a, b) => (pct(a.ok, a.n) ?? 0) - (pct(b.ok, b.n) ?? 0)).slice(0, 3);
  const mix = mixups(data, kind, area).slice(0, 8);
  const maxErr = Math.max(1, ...mix.map((e) => e.n));
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {parts.length > 1 && (
        <Segmented options={parts.map((p) => ({ id: p.id, label: AREA_LABEL[p.area] + " · " + (p.kind === "initial" ? "initials" : "finals") }))} value={part.id} onChange={setPick} />
      )}
      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="card p-4 md:p-5">
          <h2 className="font-semibold">{AREA_LABEL[area]}: {kind === "initial" ? "initials" : "finals"}</h2>
          <p className="mb-3 text-xs text-muted">{area === "speaking" ? "What the speech model heard you say." : "The option you picked."} Click a sound to train it.</p>
          {hardest.length > 0 && (
            <p className="cjk mb-4 text-sm text-muted">Hardest: {hardest.map((e, i) => <span key={e.expected}>{i ? ", " : ""}<b className="text-ink">{e.expected}</b> {pct(e.ok, e.n)}%</span>)}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {exp.map((e) => {
              const p = pct(e.ok, e.n);
              return (
                <Link key={e.expected} href={trainHref(area, kind, [e.expected])} title={e.ok + " right of " + e.n} className="cjk flex min-w-14 flex-col items-center rounded-xl border px-2 py-1.5 transition hover:border-accent" style={{ borderColor: tint(accTone(p), 60), background: tint(accTone(p), 14) }}>
                  <span className="text-xl leading-tight">{e.expected}</span>
                  <span className="text-[10px] tabular-nums text-muted">{p}% · {e.n}</span>
                </Link>
              );
            })}
          </div>
        </section>
        <section className="card p-4 md:p-5">
          <h2 className="mb-3 font-semibold">Most common mix-ups</h2>
          {mix.length ? mix.map((e) => (
            <Link key={e.expected + e.actual} href={trainHref(area, kind, [e.expected, e.actual])} className="cjk flex items-center gap-3 rounded-lg px-1.5 py-1.5 text-sm hover:bg-raise">
              <span className="w-20 shrink-0"><b>{e.expected}</b> <span className="text-muted">→</span> <span className="text-bad">{said(kind, e.actual)}</span></span>
              <div className="flex-1"><Meter value={(100 * e.n) / maxErr} color="var(--bad)" /></div>
              <span className="w-16 text-right text-xs tabular-nums text-muted">{e.n}× · {e.share}%</span>
            </Link>
          )) : <div className="text-sm text-muted">No mix-ups in this range.</div>}
        </section>
      </div>
      {(data.mic_pairs ?? []).length > 0 && (
        <section className="card p-4 md:p-5">
          <h2 className="font-semibold">Sounds the microphone mixes up for you</h2>
          <p className="mb-3 text-xs text-muted">You typed what you said, and it was right. After 5 checks of the same pair, its older misses count as right too.</p>
          {data.mic_pairs.map((p) => (
            <div key={p.area + p.kind + p.expected + p.heard} className="cjk flex items-center gap-3 px-1.5 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-muted">{AREA_LABEL[p.area] ?? p.area}</span>
              <span><b>{p.expected}</b> <span className="text-muted">heard as</span> <b>{p.heard}</b></span>
              <span className="ml-auto text-xs tabular-nums text-muted">{p.n}×</span>
              {p.confirmed && <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok">fixed</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------- Symbols ----------

const SYM_AREAS = ["reading", "recognize", "dictation", "writing"];
const SYM_INSTEAD: Record<string, string> = { reading: "Heard instead:", recognize: "Typed instead:" };
const STATUS_LABEL: Record<string, string> = { ok: "clean", rough: "rough shape", wrong: "wrong shape", reversed: "wrong direction", missing: "missing", joined: "joined", extra: "extra stroke" };

function SymbolsView({ data, area, sel, onPick, sheet, closeSheet }: { data: Data; area: string; sel: number; onPick: (i: number) => void; sheet: boolean; closeSheet: () => void }) {
  const areas = useMemo(() => (area && SYM_AREAS.includes(area) ? [area] : SYM_AREAS), [area]);
  const agg = useMemo(() => {
    const m = new Map<string, { n: number; ok: number }>();
    for (const it of data.items) if (it.kind === "symbol" && areas.includes(it.area)) {
      const v = m.get(it.expected) ?? { n: 0, ok: 0 };
      v.n += it.n;
      v.ok += it.ok;
      m.set(it.expected, v);
    }
    return m;
  }, [data, areas]);
  const sym = SYMS[sel] ?? SYMS[0];
  const practiced = SYMS.filter((s) => agg.has(s)).length;
  // Silent recognition: which symbol the typed pinyin stood for. Each pair trains as a contrast.
  const typedMix = useMemo(() => (areas.includes("recognize") ? mixups(data, "symbol", "recognize").filter((c) => c.actual !== "∅").slice(0, 8) : []), [data, areas]);
  return (
    <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,560px)_minmax(320px,1fr)]">
      <section className="card p-4 md:p-5">
        <h2 className="font-semibold">Symbols <span className="text-xs font-normal text-muted">{areas.map((a) => AREA_LABEL[a]).join(", ")} · first try, without help</span></h2>
        <p className="mb-3 text-xs text-muted">{practiced} of 37 practiced in this range. Greener means more often right. <span className="max-md:hidden">Arrow keys to move, Enter to train.</span></p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(" + GRID_COLS + ", minmax(0, 1fr))" }}>
          {SYMS.map((s, i) => {
            const v = agg.get(s);
            const p = v ? Math.round((100 * (v.ok + 1)) / (v.n + 2)) : null;
            return (
              <button key={s} onClick={() => onPick(i)} data-active={i === sel}
                className={"cjk flex aspect-square flex-col items-center justify-center rounded-xl border-2 transition " + (i === sel ? "border-accent" : "border-transparent")}
                style={{ background: v ? tint(accTone(p), 12 + Math.min(1, v.n / 10) * 30) : "var(--raise)" }} title={v ? v.ok + " right of " + v.n : "not practiced"}>
                <span className="text-2xl leading-none md:text-3xl">{s}</span>
                <span className="mt-1 text-[10px] tabular-nums text-muted">{v ? v.ok + "/" + v.n : "–"}</span>
              </button>
            );
          })}
        </div>
        {typedMix.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Taken for another symbol <span className="text-xs font-normal text-muted">Recognize · the pinyin you typed belongs to</span></h3>
            <div className="mt-1.5 flex flex-col">
              {typedMix.map((c) => (
                <Link key={c.expected + c.actual} href={trainHref("recognize", "symbol", [c.expected, c.actual])} className="cjk flex items-center gap-3 rounded-lg px-1.5 py-1 text-sm hover:bg-raise">
                  <span className="w-20 shrink-0"><b>{c.expected}</b> <span className="text-muted">→</span> <span className="text-bad">{c.actual}</span></span>
                  <div className="flex-1"><Meter value={c.share} color="var(--bad)" /></div>
                  <span className="w-16 text-right text-xs tabular-nums text-muted">{c.n}× · {c.share}%</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
      {sheet && <div className="m-sheet-backdrop" onClick={closeSheet} />}
      <aside data-open={sheet} className="m-sheet card p-4 md:p-5 lg:sticky lg:top-0">
        <div className="m-sheet-head mb-2 flex items-center justify-between">
          <span className="font-semibold">Details</span>
          <button className="icon-btn !h-9 !w-9 text-lg" onClick={closeSheet} aria-label="Close">✕</button>
        </div>
        <SymbolDetails data={data} sym={sym} />
      </aside>
    </div>
  );
}

function SymbolDetails({ data, sym }: { data: Data; sym: string }) {
  const { open } = useLevels();
  const trainAreas = SYM_AREAS.filter((a) => { const ex = exerciseOf(trainHref(a, "symbol", [sym])); return !ex || open(ex); });
  const st = data.strokes.find((s) => s.sym === sym);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="cjk grid h-20 w-20 place-items-center rounded-2xl bg-raise text-6xl">{sym}</span>
        <div className="flex flex-wrap gap-1.5">
          {trainAreas.map((a) => <Link key={a} className="btn !px-3 !py-1.5 text-sm" href={trainHref(a, "symbol", [sym])}>Train {AREA_LABEL[a].toLowerCase()}</Link>)}
        </div>
      </div>
      {SYM_AREAS.map((a) => {
        const it = data.items.find((i) => i.area === a && i.kind === "symbol" && i.expected === sym);
        if (!it) return null;
        const wrong = data.confusion.filter((c) => c.area === a && c.kind === "symbol" && c.expected === sym && c.actual !== sym).sort((x, y) => y.n - x.n);
        return (
          <div key={a}>
            <div className="mb-1 flex items-baseline gap-2 text-sm">
              <span className="font-medium" style={{ color: AREA_COLOR[a] }}>{AREA_LABEL[a]}</span>
              <span className="text-muted">{it.ok}/{it.n} first try</span>
              <span className="ml-auto"><Trend it={it} /></span>
              <span className="w-10 text-right font-semibold tabular-nums" style={{ color: accTone(it.acc) }}>{percent(it.acc)}</span>
            </div>
            <Meter value={it.acc} />
            {wrong.length > 0 && (
              <div className="cjk mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {SYM_INSTEAD[a] ?? "Looked like:"}
                {wrong.slice(0, 6).map((c) => <span key={c.actual} className="rounded-md bg-bad/15 px-1.5 py-0.5 text-sm text-ink">{said("symbol", c.actual)} <span className="text-muted">×{c.n}</span></span>)}
              </div>
            )}
          </div>
        );
      })}
      {st && st.n > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Strokes <span className="font-normal text-muted">({st.clean ?? "–"}% clean of {st.n})</span></h3>
          <div className="flex flex-wrap gap-1 text-xs">
            {Object.entries(st.status).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} className={"rounded-md px-1.5 py-0.5 " + (k === "ok" ? "bg-ok/15" : k === "rough" ? "bg-rough/15" : "bg-bad/15")}>{STATUS_LABEL[k] ?? k} ×{n}</span>
            ))}
          </div>
          {Object.keys(st.by_stroke).length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
              {Object.entries(st.by_stroke).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => (
                <div key={k}>{k === "0" ? "Extra strokes" : "Stroke " + k}: {Object.entries(v).map(([s, n]) => (STATUS_LABEL[s] ?? s) + " ×" + n).join(", ")}</div>
              ))}
            </div>
          )}
          {st.order_n > 0 && <div className="mt-1 text-xs text-muted">Stroke order wrong in {st.order_err} of {st.order_n} tries.</div>}
        </div>
      )}
      {!data.items.some((i) => i.kind === "symbol" && i.expected === sym) && <div className="text-sm text-muted">Not practiced in this range.</div>}
    </div>
  );
}

// ---------- Activity ----------

function ActivityView({ data, phone }: { data: Data; phone: boolean }) {
  const goal = goalMinutes();
  const r = data.records;
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card p-4 md:p-5">
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact value={String(r.streak_now?.value ?? 0)} label="day streak now" icon="🔥" />
          <Fact value={r.streak ? String(r.streak.value) : "–"} label="longest streak" />
          <Fact value={String(r.total_minutes?.value ?? 0)} label="minutes in all" />
          <Fact value={String(r.days?.value ?? 0)} label={"days practiced" + (r.days?.day ? " since " + shortDay(r.days.day) : "")} />
        </div>
        <h2 className="mb-1 text-sm font-semibold">Practice calendar</h2>
        <p className="mb-2 text-xs text-muted">Minutes per day, last 26 weeks. Green: daily goal ({goal} min) reached.</p>
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

      <Disclosure title={"Sessions (" + data.sessions.length + ")"} hint="Each practice session: when, how long, which areas, how often right">
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {data.sessions.map((s) => {
            const d = new Date(s.start * 1000);
            const mins = Math.max(1, Math.round((s.end - s.start) / 60));
            return (
              <div key={s.start} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-raise">
                <span className="w-28 text-muted">{d.toLocaleDateString("en", { month: "short", day: "numeric" })} {d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                <span className="w-14 tabular-nums">{mins} min</span>
                <span className="flex flex-1 gap-0.5">{AREA_ORDER.filter((a) => s.areas[a]).map((a) => <i key={a} title={AREA_LABEL[a] + ": " + s.areas[a]} className="h-2 rounded-full" style={{ width: Math.max(6, s.areas[a] * 2) + "px", background: AREA_COLOR[a] }} />)}</span>
                <span className="w-10 text-right tabular-nums">{s.cards}</span>
                <span className="w-10 text-right tabular-nums" style={{ color: accTone(pct(s.ok, s.cards)) }}>{pct(s.ok, s.cards)}%</span>
              </div>
            );
          })}
          {!data.sessions.length && <div className="text-sm text-muted">No sessions in this range.</div>}
        </div>
      </Disclosure>

      <Disclosure title="Last answers" hint="Your most recent answers, with what went wrong">
        <div className="mb-3"><button className="btn !px-3 !py-1 text-xs" onClick={() => downloadExport().catch((e: Error) => alert(e.message))}>Export all answers as CSV</button></div>
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {data.recent.map((e) => {
            // Speaking also saves whole syllables; the tone, initial, and final already say what went wrong.
            const wrong = e.units.filter((u) => u.ok === 0 && u.actual != null && u.actual !== u.expected && u.kind !== "order" && !(e.area === "speaking" && u.kind === "syllable"));
            return (
              <div key={e.id} className="cjk flex items-baseline gap-2 rounded-lg px-2 py-1 text-sm hover:bg-raise">
                <span className={"w-4 font-bold " + (e.ok ? "text-ok" : "text-bad")}>{e.ok ? "✓" : "✗"}</span>
                <span className="w-12 shrink-0 text-[11px] text-muted">{new Date(e.ts * 1000).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                <span className="w-16 shrink-0 text-xs" style={{ color: AREA_COLOR[e.area] }}>{AREA_LABEL[e.area] ?? e.area}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.item}
                  {wrong.slice(0, 3).map((u, i) => <span key={i} className="ml-2 text-xs text-bad">{u.kind === "tone" ? toneShort(u.expected) + "→" + toneShort(u.actual!) : u.expected + "→" + said(u.kind, u.actual!)}</span>)}
                </span>
                <span className="text-[11px] tabular-nums text-muted">{e.score != null ? Math.round(e.score) : e.ms ? secs(e.ms) : ""}</span>
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
      <div className="text-2xl font-semibold tabular-nums md:text-3xl">{icon && <span className="mr-1 text-xl">{icon}</span>}{value}</div>
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
              <span className="block text-xs leading-snug text-muted">{label}{day ? " · " + shortDay(day) : ""}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}


/** The tone rules (3-3, 不, 一): accuracy in the rule quiz and in recordings, the written tone read by mistake, and the hardest characters. */
function RulesSection({ data }: { data: Data }) {
  const rules = data.rules ?? [];
  const any = rules.some((r) => r.n > 0);
  return (
    <section className="card p-4 md:p-5">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-semibold">Tone rules</h2>
        <span className="text-xs text-muted">the Bopomofo shows the written tone; these rules change it in words</span>
      </div>
      {!any && <p className="mb-3 text-sm text-muted">No tone rule answers yet. Learn the 3-3, 不 and 一 rules before you say full sentences.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {rules.map((r) => {
          const few = r.n < 5;
          const quiz = r.areas.listening, speak = r.areas.speaking;
          return (
            <div key={r.rule} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex items-baseline gap-2">
                <b className="cjk">{r.name}</b>
                <span className="ml-auto text-lg font-semibold tabular-nums" style={{ color: few ? "var(--muted)" : accTone(r.acc) }}>{r.n ? percent(r.acc) : "–"}</span>
              </div>
              <p className="text-xs text-muted cjk">{r.short}</p>
              {r.n > 0 && (
                <ul className="text-xs flex flex-col gap-0.5">
                  <li>Quiz: {quiz ? <>{percent(quiz.acc)} of {quiz.n}</> : "not practiced"} · Said aloud: {speak ? <>{percent(speak.acc)} of {speak.n}</> : "not practiced"}</li>
                  {r.literal > 0 && <li className="text-bad">Read the written tone {r.literal}× where the rule changes it</li>}
                  {(r.errors.over ?? 0) > 0 && <li className="text-bad">Changed the tone {r.errors.over}× where it stays</li>}
                  {r.chars.filter((c) => c.ok < c.n).length > 0 && (
                    <li className="cjk">Hardest: {r.chars.filter((c) => c.ok < c.n).map((c) => c.char + " " + c.ok + "/" + c.n).join(" · ")}</li>
                  )}
                </ul>
              )}
              <div className="mt-auto flex gap-2 pt-1">
                <Link className="btn !py-1 text-xs" href={r.quiz_href}>Quiz</Link>
                <Link className="btn !py-1 text-xs" href={r.speak_href}>Say it</Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

