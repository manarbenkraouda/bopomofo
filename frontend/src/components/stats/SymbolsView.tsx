"use client";

import { type Stats as Data } from "@/lib/api";
import { exerciseOf, useLevels } from "@/lib/levels";
import Link from "next/link";
import { useMemo } from "react";
import { accTone, AREA_COLOR, AREA_LABEL, Meter, tint } from "./charts";
import { GRID_COLS, mixups, percent, said, SYMS, trainHref } from "./display";
import { Trend } from "./Trend";

// ---------- Symbols ----------

const SYM_AREAS = ["reading", "recognize", "dictation", "writing"];

const SYM_INSTEAD: Record<string, string> = { reading: "Heard instead:", recognize: "Typed instead:" };

const STATUS_LABEL: Record<string, string> = {
  ok: "clean",
  rough: "rough shape",
  wrong: "wrong shape",
  reversed: "wrong direction",
  missing: "missing",
  joined: "joined",
  extra: "extra stroke",
};

export function SymbolsView({
  data,
  area,
  sel,
  onPick,
  sheet,
  closeSheet,
}: {
  data: Data;
  area: string;
  sel: number;
  onPick: (i: number) => void;
  sheet: boolean;
  closeSheet: () => void;
}) {
  const areas = useMemo(() => (area && SYM_AREAS.includes(area) ? [area] : SYM_AREAS), [area]);
  const agg = useMemo(() => {
    const m = new Map<string, { n: number; ok: number }>();
    for (const it of data.items)
      if (it.kind === "symbol" && areas.includes(it.area)) {
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
  const typedMix = useMemo(
    () =>
      areas.includes("recognize")
        ? mixups(data, "symbol", "recognize")
            .filter((c) => c.actual !== "∅")
            .slice(0, 8)
        : [],
    [data, areas],
  );
  return (
    <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,560px)_minmax(320px,1fr)]">
      <section className="card p-4 md:p-5">
        <h2 className="font-semibold">
          Symbols{" "}
          <span className="text-xs font-normal text-muted">
            {areas.map((a) => AREA_LABEL[a]).join(", ")} · first try, without help
          </span>
        </h2>
        <p className="mb-3 text-xs text-muted">
          {practiced} of 37 practiced in this range. Greener means more often right.{" "}
          <span className="max-md:hidden">Arrow keys to move, Enter to train.</span>
        </p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(" + GRID_COLS + ", minmax(0, 1fr))" }}>
          {SYMS.map((s, i) => {
            const v = agg.get(s);
            const p = v ? Math.round((100 * (v.ok + 1)) / (v.n + 2)) : null;
            return (
              <button
                key={s}
                onClick={() => onPick(i)}
                data-active={i === sel}
                className={
                  "cjk flex aspect-square flex-col items-center justify-center rounded-xl border-2 transition " +
                  (i === sel ? "border-accent" : "border-transparent")
                }
                style={{ background: v ? tint(accTone(p), 12 + Math.min(1, v.n / 10) * 30) : "var(--raise)" }}
                title={v ? v.ok + " right of " + v.n : "not practiced"}
              >
                <span className="text-2xl leading-none md:text-3xl">{s}</span>
                <span className="mt-1 text-[10px] tabular-nums text-muted">{v ? v.ok + "/" + v.n : "–"}</span>
              </button>
            );
          })}
        </div>
        {typedMix.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">
              Taken for another symbol{" "}
              <span className="text-xs font-normal text-muted">Recognize · the pinyin you typed belongs to</span>
            </h3>
            <div className="mt-1.5 flex flex-col">
              {typedMix.map((c) => (
                <Link
                  key={c.expected + c.actual}
                  href={trainHref("recognize", "symbol", [c.expected, c.actual])}
                  className="cjk flex items-center gap-3 rounded-lg px-1.5 py-1 text-sm hover:bg-raise"
                >
                  <span className="w-20 shrink-0">
                    <b>{c.expected}</b> <span className="text-muted">→</span>{" "}
                    <span className="text-bad">{c.actual}</span>
                  </span>
                  <div className="flex-1">
                    <Meter value={c.share} color="var(--bad)" />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-muted">
                    {c.n}× · {c.share}%
                  </span>
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
          <button className="icon-btn !h-9 !w-9 text-lg" onClick={closeSheet} aria-label="Close">
            ✕
          </button>
        </div>
        <SymbolDetails data={data} sym={sym} />
      </aside>
    </div>
  );
}

function SymbolDetails({ data, sym }: { data: Data; sym: string }) {
  const { open } = useLevels();
  const trainAreas = SYM_AREAS.filter((a) => {
    const ex = exerciseOf(trainHref(a, "symbol", [sym]));
    return !ex || open(ex);
  });
  const st = data.strokes.find((s) => s.sym === sym);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="cjk grid h-20 w-20 place-items-center rounded-2xl bg-raise text-6xl">{sym}</span>
        <div className="flex flex-wrap gap-1.5">
          {trainAreas.map((a) => (
            <Link key={a} className="btn !px-3 !py-1.5 text-sm" href={trainHref(a, "symbol", [sym])}>
              Train {AREA_LABEL[a].toLowerCase()}
            </Link>
          ))}
        </div>
      </div>
      {SYM_AREAS.map((a) => {
        const it = data.items.find((i) => i.area === a && i.kind === "symbol" && i.expected === sym);
        if (!it) return null;
        const wrong = data.confusion
          .filter((c) => c.area === a && c.kind === "symbol" && c.expected === sym && c.actual !== sym)
          .sort((x, y) => y.n - x.n);
        return (
          <div key={a}>
            <div className="mb-1 flex items-baseline gap-2 text-sm">
              <span className="font-medium" style={{ color: AREA_COLOR[a] }}>
                {AREA_LABEL[a]}
              </span>
              <span className="text-muted">
                {it.ok}/{it.n} first try
              </span>
              <span className="ml-auto">
                <Trend it={it} />
              </span>
              <span className="w-10 text-right font-semibold tabular-nums" style={{ color: accTone(it.acc) }}>
                {percent(it.acc)}
              </span>
            </div>
            <Meter value={it.acc} />
            {wrong.length > 0 && (
              <div className="cjk mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {SYM_INSTEAD[a] ?? "Looked like:"}
                {wrong.slice(0, 6).map((c) => (
                  <span key={c.actual} className="rounded-md bg-bad/15 px-1.5 py-0.5 text-sm text-ink">
                    {said("symbol", c.actual)} <span className="text-muted">×{c.n}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {st && st.n > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">
            Strokes{" "}
            <span className="font-normal text-muted">
              ({st.clean ?? "–"}% clean of {st.n})
            </span>
          </h3>
          <div className="flex flex-wrap gap-1 text-xs">
            {Object.entries(st.status)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <span
                  key={k}
                  className={
                    "rounded-md px-1.5 py-0.5 " +
                    (k === "ok" ? "bg-ok/15" : k === "rough" ? "bg-rough/15" : "bg-bad/15")
                  }
                >
                  {STATUS_LABEL[k] ?? k} ×{n}
                </span>
              ))}
          </div>
          {Object.keys(st.by_stroke).length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
              {Object.entries(st.by_stroke)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([k, v]) => (
                  <div key={k}>
                    {k === "0" ? "Extra strokes" : "Stroke " + k}:{" "}
                    {Object.entries(v)
                      .map(([s, n]) => (STATUS_LABEL[s] ?? s) + " ×" + n)
                      .join(", ")}
                  </div>
                ))}
            </div>
          )}
          {st.order_n > 0 && (
            <div className="mt-1 text-xs text-muted">
              Stroke order wrong in {st.order_err} of {st.order_n} tries.
            </div>
          )}
        </div>
      )}
      {!data.items.some((i) => i.kind === "symbol" && i.expected === sym) && (
        <div className="text-sm text-muted">Not practiced in this range.</div>
      )}
    </div>
  );
}
