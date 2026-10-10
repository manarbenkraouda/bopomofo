"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, exportUrl, type ItemStat, type Stats as Data } from "@/lib/api";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { setPref, usePref } from "@/lib/prefs";
import { goalMinutes } from "@/lib/session";
import { PHONE, useViewport } from "@/lib/useFit";
import { INITIALS } from "@/lib/zhuyin";
import { Kbd } from "@/components/shell/Kbd";
import { AccGrid, AREA_COLOR, AREA_LABEL, AREA_ORDER, accTone, Calendar, DailyChart, Hours, Matrix, Meter, pct, secs, shortDay, tint } from "./charts";

type Tab = "today" | "tones" | "sounds" | "symbols" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" }, { id: "tones", label: "Tones" }, { id: "sounds", label: "Sounds" }, { id: "symbols", label: "Symbols" }, { id: "history", label: "History" },
];
const RANGES = [1, 7, 30, 90, 0];
const RANGE_LABEL: Record<number, string> = { 1: "Today", 7: "7 days", 30: "30 days", 90: "90 days", 0: "All time" };
const AREAS = ["", ...AREA_ORDER];
const SYMS = [...INITIALS, ..."ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ"];
const GRID_COLS = 7;
const CHALLENGE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR"];
const TONES = ["1", "2", "3", "4", "5"];

const toneName = (t: string) => (t === "5" ? "Neutral" : t === "?" ? "Unclear" : "Tone " + t);
const toneShort = (t: string) => (t === "5" ? "N" : t === "?" ? "?" : t);
/** What was produced instead, in words. */
const said = (kind: string, a: string) => (a === "?" ? (kind === "tone" ? "unclear" : "not heard") : a === "∅" ? "nothing" : kind === "tone" ? toneName(a).toLowerCase() : a);
const itemName = (it: { kind: string; expected: string }) =>
  it.kind === "tone" ? toneName(it.expected) : it.kind === "initial" ? "Initial " + it.expected : it.kind === "final" ? "Final " + it.expected : it.expected;
const trainHref = (area: string, kind: string, vals: string[]) => {
  const v = encodeURIComponent(vals.filter((x) => x && x !== "∅" && x !== "?").join(","));
  if (kind === "tone") return area === "listening" ? "/listening?quiz=tone&tones=" + v : area === "writing" ? "/writing?mode=syllable&tones=" + v : "/speaking?source=syllable&tones=" + v;
  if (kind === "symbol") return area === "reading" ? "/reading?syms=" + v : area === "writing" ? "/writing?mode=symbol&syms=" + v : "/dictation?syms=" + v;
  return area === "listening" ? "/listening?quiz=zhuyin&syms=" + v : "/speaking?source=syllable&syms=" + v;
};

export function Stats() {
  const router = useRouter();
  const tab = usePref("zhuyin.stats.tab", "today") as Tab;
  const days = Number(usePref("zhuyin.stats.days", "30"));
  const area = usePref("zhuyin.stats.area", "");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(0); // selected weak spot (Today) or symbol (Symbols)
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
  const challenges = data?.challenges ?? [];
  const listLen = tab === "today" ? weak.length : tab === "symbols" ? SYMS.length : 0;
  const move = (d: number) => setSel((s) => Math.max(0, Math.min(listLen - 1, s + d)));
  const selectedHref = tab === "today" ? weak[sel]?.href : tab === "symbols" ? trainHref(area || "dictation", "symbol", [SYMS[sel]]) : undefined;

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
    <div className="flex flex-1 flex-col gap-4">
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
        <div className="card p-6 text-muted">No answers in this range yet. Practice a little, or choose a longer range with ] .</div>
      )}
      {data && tab === "today" && <TodayView data={data} sel={sel} setSel={setSel} days={days} />}
      {data && tab === "tones" && data.overview.cards > 0 && <TonesView data={data} />}
      {data && tab === "sounds" && data.overview.cards > 0 && <SoundsView data={data} />}
      {data && tab === "symbols" && data.overview.cards > 0 && (
        <SymbolsView data={data} area={area} sel={sel} onPick={(i) => { setSel(i); if (w < 1024) setSheet(true); }} sheet={sheet} closeSheet={() => setSheet(false)} />
      )}
      {data && tab === "history" && <HistoryView data={data} phone={w < PHONE} />}
    </div>
  );
}

// ---------- Today ----------

function TodayView({ data, sel, setSel, days }: { data: Data; sel: number; setSel: (i: number) => void; days: number }) {
  const o = data.overview;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="card p-4 md:p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">Today&apos;s challenges <span className="text-xs font-normal text-muted max-sm:hidden">picked from your weakest skills</span></h2>
          {data.challenges.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.challenges.map((c, i) => (
                <Link key={c.id} href={c.href} className={"tile relative flex flex-col gap-2 rounded-2xl border-2 p-3.5 transition hover:-translate-y-0.5 " + (c.done ? "border-ok/60 bg-ok/10" : "border-line bg-card hover:border-accent")}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: AREA_COLOR[c.area] }} />
                    <span className="cjk flex-1 font-semibold leading-snug">{c.title}</span>
                    {c.done ? <span className="font-bold text-ok">✓</span> : <Kbd className="max-md:!hidden">{"QWER"[i]}</Kbd>}
                  </div>
                  <div className="text-xs text-muted cjk">{c.why}</div>
                  <div className="flex items-center gap-2">
                    <Meter value={(100 * c.progress) / c.target} color={c.done ? "var(--ok)" : "var(--accent)"} />
                    <span className="text-xs tabular-nums text-muted">{c.progress}/{c.target}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : <div className="text-sm text-muted">Practice a few minutes to get challenges.</div>}
        </section>

        <section className="card p-4 md:p-5">
          <h2 className="mb-1 font-semibold">Weak spots to train</h2>
          <p className="mb-3 text-xs text-muted">First-try accuracy, with recent answers counting more. Press Enter to train the selected one.</p>
          {data.weak.length ? (
            <div className="flex flex-col gap-1">
              {data.weak.map((it, i) => (
                <Link key={it.area + it.kind + it.expected} href={it.href} onMouseEnter={() => setSel(i)} data-current={i === sel}
                  className={"grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2 transition " + (i === sel ? "border-accent/60 bg-accent-soft" : "border-transparent hover:bg-raise")}>
                  <span className="cjk grid h-10 min-w-10 place-items-center rounded-xl px-1.5 text-lg font-semibold" style={{ background: tint(accTone(it.post), 22), color: accTone(it.post) }}>
                    {it.kind === "tone" ? toneShort(it.expected) : it.expected}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="cjk font-medium">{itemName(it)}</span>
                      <span className="text-xs" style={{ color: AREA_COLOR[it.area] }}>{AREA_LABEL[it.area]}</span>
                    </span>
                    <span className="cjk block truncate text-xs text-muted">
                      {it.ok}/{it.n} right{it.top.length ? " · you " + it.verb + " " + it.top.map(([a, n]) => said(it.kind, a) + " ×" + n).join(", ") : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-right">
                    <Trend it={it} />
                    <span className="w-11 text-lg font-semibold tabular-nums" style={{ color: accTone(it.post) }}>{Math.round(it.post)}%</span>
                    {i === sel && <Kbd className="max-md:!hidden">Enter</Kbd>}
                  </span>
                </Link>
              ))}
            </div>
          ) : <div className="text-sm text-muted">No weak spots yet: each needs at least 3 answers. Keep practicing.</div>}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="card p-4 md:p-5">
          <h2 className="mb-3 font-semibold">{RANGE_LABEL[days]}{days ? " vs the " + (days === 1 ? "day" : days + " days") + " before" : ""}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <Big label="answers" value={String(o.cards)} delta={o.prev ? o.cards - o.prev.cards : null} />
            <Big label="right" value={o.acc == null ? "–" : Math.round(o.acc) + "%"} delta={o.prev && o.acc != null && o.prev.acc != null ? Math.round(o.acc - o.prev.acc) : null} unit=" pts" />
            <Big label="minutes" value={String(o.minutes)} delta={o.prev ? o.minutes - o.prev.minutes : null} />
            <Big label="to answer" value={secs(o.ms)} delta={o.prev && o.ms != null && o.prev.ms != null ? -Math.round((o.ms - o.prev.ms) / 100) / 10 : null} unit=" s faster" />
          </div>
        </section>

        <section className="card p-4 md:p-5">
          <h2 className="mb-3 font-semibold">By area</h2>
          <div className="flex flex-col gap-3">
            {AREA_ORDER.filter((a) => data.areas[a]).map((a) => {
              const s = data.areas[a];
              const main = s.acc; // for card modes an answer counts as right only on the first try without help
              return (
                <div key={a}>
                  <div className="mb-1 flex items-baseline gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[a] }} />
                    <span className="font-medium">{AREA_LABEL[a]}</span>
                    <span className="ml-auto tabular-nums" style={{ color: accTone(main) }}>{main == null ? "–" : Math.round(main) + "%"}</span>
                  </div>
                  <Meter value={main} />
                  <div className="mt-1 text-[11px] text-muted">
                    {[s.n + " answers", s.score != null ? "avg score " + s.score : "", s.ms ? secs(s.ms) + " to answer" : "", s.tries > 1.01 ? s.tries + " tries per card" : "", s.help ? s.help + "% with help" : "", s.replays ? s.replays + " replays" : ""].filter(Boolean).join(" · ")}
                  </div>
                </div>
              );
            })}
            {!Object.keys(data.areas).length && <div className="text-sm text-muted">No answers in this range.</div>}
          </div>
        </section>

        <Records data={data} />
      </div>
    </div>
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
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {delta != null && delta !== 0 && <div className={"text-[11px] font-semibold " + (delta > 0 ? "text-ok" : "text-bad")}>{delta > 0 ? "+" : "−"}{Math.abs(delta)}{unit}</div>}
    </div>
  );
}

function Records({ data }: { data: Data }) {
  const r = data.records;
  const rows: [string, string, string | undefined][] = [
    ["⚡", r.combo ? "×" + r.combo.value : "–", "Longest run of right answers"],
    ["🔥", r.streak ? r.streak.value + " days" : "–", "Longest day streak" + (r.streak_now?.value ? " (now " + r.streak_now.value + ")" : "")],
    ["◷", r.minutes_day ? r.minutes_day.value + " min" : "–", "Most practice in a day"],
    ["▦", r.cards_day ? String(r.cards_day.value) : "–", "Most answers in a day"],
    ["◎", r.acc_day ? Math.round(r.acc_day.value) + "%" : "–", "Best day accuracy (30+ answers)"],
    ["說", r.speaking ? String(Math.round(r.speaking.value)) : "–", "Best speaking score"],
    ["聽", r.listen_ms ? secs(r.listen_ms.value) : "–", "Fastest listening day (median, 15+ right)"],
  ];
  const days: (string | undefined)[] = [r.combo?.day, "", r.minutes_day?.day, r.cards_day?.day, r.acc_day?.day, r.speaking?.day, r.listen_ms?.day];
  return (
    <section className="card p-4 md:p-5">
      <h2 className="mb-3 font-semibold">Personal records</h2>
      <div className="flex flex-col gap-2">
        {rows.map(([icon, v, label], i) => (
          <div key={label} className="flex items-center gap-3 text-sm">
            <span className="cjk grid h-8 w-8 place-items-center rounded-lg bg-raise">{icon}</span>
            <span className="flex-1 text-muted">{label}</span>
            <span className="font-semibold tabular-nums">{v}</span>
            <span className="w-14 text-right text-[11px] text-muted">{days[i] ? shortDay(days[i]!) : ""}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-3 text-xs text-muted">
        {r.total?.value ?? 0} answers · {r.total_minutes?.value ?? 0} min · {r.days?.value ?? 0} days since {r.days?.day ? shortDay(r.days.day) : "–"}
      </div>
    </section>
  );
}

// ---------- Tones ----------

function confusionOf(data: Data, area: string, kind: string) {
  const m = new Map<string, number>();
  for (const c of data.confusion) if (c.area === area && c.kind === kind) m.set(c.expected + "|" + c.actual, c.n);
  return (r: string, c: string) => m.get(r + "|" + c) ?? 0;
}

function TonesView({ data }: { data: Data }) {
  const router = useRouter();
  const blocks = [
    { area: "speaking", title: "Speaking: the tone you said", note: "Rows: the tone as it should be said (after tone changes). ? = not heard or not clear.", cols: [...TONES, "?"] },
    { area: "listening", title: "Listening: the tone you picked", note: "Rows: the tone you heard. Columns: your answer.", cols: TONES.slice(0, 4) },
    { area: "writing", title: "Writing: the tone mark you wrote", note: "Tone 1 = no mark written.", cols: TONES },
  ].map((b) => {
    // Only answers that saved what you produced can fill the table (older answers saved right or wrong only).
    const rows = TONES.filter((t) => data.confusion.some((c) => c.area === b.area && c.kind === "tone" && c.expected === t));
    const has = rows.length > 0;
    return { ...b, has, rows };
  });
  const ctx = data.tone_ctx;
  const look = (list: { k: string[]; n: number; ok: number }[]) => {
    const m = new Map(list.map((x) => [x.k.join("|"), x]));
    return (r: string, c: string) => m.get(r + "|" + c);
  };
  const legacyOnly = blocks.every((b) => !b.has);
  return (
    <div className="flex flex-col gap-4">
      {legacyOnly && <div className="card p-3 text-sm text-muted">Your older answers only saved right or wrong. From now on every answer also saves the tone you said, heard, or wrote, so these tables fill up as you practice.</div>}
      <div className="grid gap-4 xl:grid-cols-3 lg:grid-cols-2">
        {blocks.filter((b) => b.has).map((b) => (
          <section key={b.area} className="card p-4">
            <h2 className="font-semibold" style={{ color: AREA_COLOR[b.area] }}>{b.title}</h2>
            <p className="mb-2 text-xs text-muted">{b.note} Click a row to train it.</p>
            <Matrix rows={b.rows} cols={b.cols} get={confusionOf(data, b.area, "tone")} rowName={toneName} colName={toneShort} corner="expected ↓"
              onRow={(r) => {
                const get = confusionOf(data, b.area, "tone");
                const worst = b.cols.filter((c) => c !== r && c !== "?").sort((x, y) => get(r, y) - get(r, x))[0];
                router.push(trainHref(b.area, "tone", get(r, worst) ? [r, worst] : [r]));
              }} />
          </section>
        ))}
      </div>

      <section className="card p-4">
        <h2 className="font-semibold">Tone accuracy by area</h2>
        <p className="mb-2 text-xs text-muted">First try, without help. The arrow compares this week with before.</p>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
          {AREA_ORDER.flatMap((a) => data.items.filter((i) => i.area === a && i.kind === "tone").sort((x, y) => Number(x.expected) - Number(y.expected))).map((it) => (
            <Link key={it.area + it.expected} href={trainHref(it.area, "tone", [it.expected, ...it.top.map((t) => t[0])].slice(0, 2))} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-raise">
              <span className="w-20 text-xs" style={{ color: AREA_COLOR[it.area] }}>{AREA_LABEL[it.area]}</span>
              <span className="w-16">{toneName(it.expected)}</span>
              <div className="flex-1"><Meter value={it.acc} /></div>
              <span className="w-10 text-right tabular-nums">{it.acc == null ? "–" : Math.round(it.acc) + "%"}</span>
              <span className="w-10 text-right text-xs text-muted">{it.n}</span>
              <span className="w-8 text-right"><Trend it={it} /></span>
            </Link>
          ))}
        </div>
      </section>

      {ctx.prev.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <h2 className="font-semibold">Speaking: tone after tone</h2>
            <p className="mb-2 text-xs text-muted">Accuracy of a tone (columns) when the tone before it is the row. Shows which tone pairs trip you up.</p>
            <AccGrid rows={TONES} cols={TONES} get={look(ctx.prev)} rowName={(r) => "after " + toneShort(r)} colName={toneName} corner="before ↓" />
          </section>
          <section className="card p-4">
            <h2 className="font-semibold">Speaking: tone before tone</h2>
            <p className="mb-2 text-xs text-muted">Accuracy of a tone (rows) when the tone after it is the column.</p>
            <AccGrid rows={TONES} cols={TONES} get={look(ctx.next)} rowName={toneName} colName={(c) => "→ " + toneShort(c)} corner="tone ↓" />
          </section>
          <section className="card p-4">
            <h2 className="font-semibold">Speaking: position in the sentence</h2>
            <p className="mb-2 text-xs text-muted">Alone = a single syllable, judged from your pitch.</p>
            <AccGrid rows={["alone", "first", "middle", "last"]} cols={TONES} get={look(ctx.position)} rowName={(r) => r} colName={toneName} />
          </section>
          <section className="card flex flex-col gap-3 p-4">
            <div>
              <h2 className="font-semibold">Speaking: tone changes</h2>
              <p className="mb-2 text-xs text-muted">Syllables said in another tone than their own, such as 你好 (3 → 2) or 不是 (4 → 2).</p>
              {ctx.sandhi.length ? ctx.sandhi.sort((a, b) => b.n - a.n).map((s) => (
                <div key={s.k.join()} className="flex items-center gap-2 py-0.5 text-sm">
                  <span className="w-40">{toneName(s.k[0])} said as {toneShort(s.k[1])}</span>
                  <div className="flex-1"><Meter value={pct(s.ok, s.n)} /></div>
                  <span className="w-10 text-right tabular-nums">{pct(s.ok, s.n)}%</span>
                  <span className="w-8 text-right text-xs text-muted">{s.n}</span>
                </div>
              )) : <div className="text-sm text-muted">No tone changes practiced in this range.</div>}
            </div>
            <div>
              <h3 className="text-sm font-semibold">Which signal judged the tone</h3>
              {ctx.source.sort((a, b) => b.n - a.n).map((s) => (
                <div key={s.k[0]} className="flex items-center gap-2 py-0.5 text-sm">
                  <span className="w-40 text-muted">{s.k[0] === "model" ? "Speech model" : s.k[0] === "pitch" ? "Pitch curve" : s.k[0] === "model+pitch" ? "Model + your pitch range" : s.k[0]}</span>
                  <div className="flex-1"><Meter value={pct(s.ok, s.n)} /></div>
                  <span className="w-10 text-right tabular-nums">{pct(s.ok, s.n)}%</span>
                  <span className="w-8 text-right text-xs text-muted">{s.n}</span>
                </div>
              ))}
              {ctx.uncertain > 0 && <p className="mt-1 text-xs text-muted">{ctx.uncertain} of {ctx.n} tones: the model and the pitch curve disagreed.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ---------- Sounds (initials and finals) ----------

function SoundsView({ data }: { data: Data }) {
  const parts = ["speaking", "listening"].flatMap((area) => ["initial", "final"].map((kind) => ({ area, kind })))
    .filter(({ area, kind }) => data.expected.some((e) => e.area === area && e.kind === kind));
  if (!parts.length) return <div className="card p-6 text-muted">No initials or finals yet. Record sentences in Speaking, or use &quot;Which Bopomofo?&quot; in Listening.</div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {parts.map(({ area, kind }) => {
        const exp = data.expected.filter((e) => e.area === area && e.kind === kind)
          .sort((a, b) => (kind === "initial" ? (a.expected === "∅" ? 99 : INITIALS.indexOf(a.expected)) - (b.expected === "∅" ? 99 : INITIALS.indexOf(b.expected)) : b.n - a.n));
        const errors = data.confusion.filter((c) => c.area === area && c.kind === kind && c.actual !== c.expected).sort((a, b) => b.n - a.n).slice(0, 10);
        const totals = new Map(exp.map((e) => [e.expected, e.n]));
        const maxErr = Math.max(1, ...errors.map((e) => e.n));
        return (
          <section key={area + kind} className="card p-4">
            <h2 className="font-semibold" style={{ color: AREA_COLOR[area] }}>{AREA_LABEL[area]}: {kind === "initial" ? "initials" : "finals"}</h2>
            <p className="mb-3 text-xs text-muted">{area === "speaking" ? "What the speech model heard you say." : "The option you picked."} Click to train.</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {exp.map((e) => {
                const p = pct(e.ok, e.n);
                return (
                  <Link key={e.expected} href={trainHref(area, kind, [e.expected])} title={e.ok + " right of " + e.n} className="cjk flex min-w-12 flex-col items-center rounded-lg border px-2 py-1 hover:border-accent" style={{ borderColor: tint(accTone(p), 60), background: tint(accTone(p), 14) }}>
                    <span className="text-lg leading-tight">{e.expected}</span>
                    <span className="text-[10px] tabular-nums text-muted">{p}% · {e.n}</span>
                  </Link>
                );
              })}
            </div>
            <h3 className="mb-1 text-sm font-semibold">Most common mix-ups</h3>
            {errors.length ? errors.map((e) => (
              <Link key={e.expected + e.actual} href={trainHref(area, kind, [e.expected, e.actual])} className="cjk flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-raise">
                <span className="w-24"><b>{e.expected}</b> <span className="text-muted">→</span> <span className="text-bad">{said(kind, e.actual)}</span></span>
                <div className="flex-1"><Meter value={(100 * e.n) / maxErr} color="var(--bad)" /></div>
                <span className="w-24 text-right text-xs tabular-nums text-muted">×{e.n} · {pct(e.n, totals.get(e.expected) ?? 0)}% of {e.expected}</span>
              </Link>
            )) : <div className="text-sm text-muted">No mix-ups in this range.</div>}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Symbols ----------

const SYM_AREAS = ["reading", "dictation", "writing"];
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
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="card p-4">
        <h2 className="font-semibold">Symbols <span className="text-xs font-normal text-muted">{areas.map((a) => AREA_LABEL[a]).join(", ")} · first try, without help</span></h2>
        <p className="mb-3 text-xs text-muted max-md:hidden">Arrow keys to move, Enter to train the selected symbol. Press A to change the area.</p>
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
      </section>
      {sheet && <div className="m-sheet-backdrop" onClick={closeSheet} />}
      <aside data-open={sheet} className="m-sheet card p-4 lg:sticky lg:top-0">
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
  const st = data.strokes.find((s) => s.sym === sym);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="cjk grid h-20 w-20 place-items-center rounded-2xl bg-raise text-6xl">{sym}</span>
        <div className="flex flex-wrap gap-1.5">
          {SYM_AREAS.map((a) => <Link key={a} className="btn !px-3 !py-1.5 text-sm" href={trainHref(a, "symbol", [sym])}>Train {AREA_LABEL[a].toLowerCase()}</Link>)}
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
              <span className="w-10 text-right font-semibold tabular-nums" style={{ color: accTone(it.acc) }}>{it.acc == null ? "–" : Math.round(it.acc) + "%"}</span>
            </div>
            <Meter value={it.acc} />
            {wrong.length > 0 && (
              <div className="cjk mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {a === "reading" ? "Heard instead:" : "Looked like:"}
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

// ---------- History ----------

function HistoryView({ data, phone }: { data: Data; phone: boolean }) {
  const goal = goalMinutes();
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="card p-4 lg:col-span-2">
        <h2 className="mb-3 font-semibold">Answers per day</h2>
        <DailyChart daily={phone ? data.daily.slice(-30) : data.daily} />
      </section>
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">Practice calendar</h2>
        <p className="mb-2 text-xs text-muted">Minutes per day, last 26 weeks. Green: daily goal ({goal} min) reached.</p>
        <Calendar days={data.calendar} goal={goal} />
      </section>
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">Time of day</h2>
        <p className="mb-2 text-xs text-muted">Bar height: answers. Color: accuracy.</p>
        <Hours hours={data.hours} />
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Sessions</h2>
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
      </section>
      <section className="card p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">Last answers</h2>
          <a className="btn ml-auto !px-3 !py-1 text-xs" href={exportUrl()} download>Export all as CSV</a>
        </div>
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
      </section>
    </div>
  );
}

