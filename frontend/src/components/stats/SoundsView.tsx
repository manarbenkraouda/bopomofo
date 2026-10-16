"use client";

import { type Stats as Data } from "@/lib/api";
import { INITIALS } from "@/lib/zhuyin";
import Link from "next/link";
import { useState } from "react";
import { accTone, AREA_LABEL, Meter, pct, Segmented, tint } from "./charts";
import { mixups, said, trainHref } from "./display";

// ---------- Sounds (initials and finals) ----------

export function SoundsView({ data }: { data: Data }) {
  const parts = ["speaking", "listening"]
    .flatMap((area) => ["initial", "final"].map((kind) => ({ id: area + ":" + kind, area, kind })))
    .filter(({ area, kind }) => data.expected.some((e) => e.area === area && e.kind === kind));
  const [pick, setPick] = useState("");
  if (!parts.length)
    return (
      <div className="card p-6 text-muted">
        No initials or finals yet. Record sentences in Speaking, or use &quot;Which Bopomofo?&quot; in Listening.
      </div>
    );
  const part = parts.find((p) => p.id === pick) ?? parts[0];
  const { area, kind } = part;
  const exp = data.expected
    .filter((e) => e.area === area && e.kind === kind)
    .sort((a, b) =>
      kind === "initial"
        ? (a.expected === "∅" ? 99 : INITIALS.indexOf(a.expected)) -
          (b.expected === "∅" ? 99 : INITIALS.indexOf(b.expected))
        : b.n - a.n,
    );
  const hardest = exp
    .filter((e) => e.n >= 3)
    .sort((a, b) => (pct(a.ok, a.n) ?? 0) - (pct(b.ok, b.n) ?? 0))
    .slice(0, 3);
  const mix = mixups(data, kind, area).slice(0, 8);
  const maxErr = Math.max(1, ...mix.map((e) => e.n));
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {parts.length > 1 && (
        <Segmented
          options={parts.map((p) => ({
            id: p.id,
            label: AREA_LABEL[p.area] + " · " + (p.kind === "initial" ? "initials" : "finals"),
          }))}
          value={part.id}
          onChange={setPick}
        />
      )}
      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="card p-4 md:p-5">
          <h2 className="font-semibold">
            {AREA_LABEL[area]}: {kind === "initial" ? "initials" : "finals"}
          </h2>
          <p className="mb-3 text-xs text-muted">
            {area === "speaking" ? "What the speech model heard you say." : "The option you picked."} Click a sound to
            train it.
          </p>
          {hardest.length > 0 && (
            <p className="cjk mb-4 text-sm text-muted">
              Hardest:{" "}
              {hardest.map((e, i) => (
                <span key={e.expected}>
                  {i ? ", " : ""}
                  <b className="text-ink">{e.expected}</b> {pct(e.ok, e.n)}%
                </span>
              ))}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {exp.map((e) => {
              const p = pct(e.ok, e.n);
              return (
                <Link
                  key={e.expected}
                  href={trainHref(area, kind, [e.expected])}
                  title={e.ok + " right of " + e.n}
                  className="cjk flex min-w-14 flex-col items-center rounded-xl border px-2 py-1.5 transition hover:border-accent"
                  style={{ borderColor: tint(accTone(p), 60), background: tint(accTone(p), 14) }}
                >
                  <span className="text-xl leading-tight">{e.expected}</span>
                  <span className="text-[10px] tabular-nums text-muted">
                    {p}% · {e.n}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
        <section className="card p-4 md:p-5">
          <h2 className="mb-3 font-semibold">Most common mix-ups</h2>
          {mix.length ? (
            mix.map((e) => (
              <Link
                key={e.expected + e.actual}
                href={trainHref(area, kind, [e.expected, e.actual])}
                className="cjk flex items-center gap-3 rounded-lg px-1.5 py-1.5 text-sm hover:bg-raise"
              >
                <span className="w-20 shrink-0">
                  <b>{e.expected}</b> <span className="text-muted">→</span>{" "}
                  <span className="text-bad">{said(kind, e.actual)}</span>
                </span>
                <div className="flex-1">
                  <Meter value={(100 * e.n) / maxErr} color="var(--bad)" />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-muted">
                  {e.n}× · {e.share}%
                </span>
              </Link>
            ))
          ) : (
            <div className="text-sm text-muted">No mix-ups in this range.</div>
          )}
        </section>
      </div>
      {(data.mic_pairs ?? []).length > 0 && (
        <section className="card p-4 md:p-5">
          <h2 className="font-semibold">Sounds the microphone mixes up for you</h2>
          <p className="mb-3 text-xs text-muted">
            You typed what you said, and it was right. After 5 checks of the same pair, its older misses count as right
            too.
          </p>
          {data.mic_pairs.map((p) => (
            <div
              key={p.area + p.kind + p.expected + p.heard}
              className="cjk flex items-center gap-3 px-1.5 py-1.5 text-sm"
            >
              <span className="w-24 shrink-0 text-muted">{AREA_LABEL[p.area] ?? p.area}</span>
              <span>
                <b>{p.expected}</b> <span className="text-muted">heard as</span> <b>{p.heard}</b>
              </span>
              <span className="ml-auto text-xs tabular-nums text-muted">{p.n}×</span>
              {p.confirmed && <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok">fixed</span>}
            </div>
          ))}
        </section>
      )}
      {data.deep_check?.mode === "apply" && data.deep_check.applied > 0 && (
        <section className="card p-4 md:p-5">
          <h2 className="font-semibold">Answers corrected after analysis: {data.deep_check.corrected}</h2>
          <p className="mb-3 text-xs text-muted">
            A closer check of the recording found the right sound or tone where the first check missed it.
          </p>
          {data.deep_check.top_pairs.map((p) => (
            <div key={p.kind + p.expected + p.heard} className="cjk flex items-center gap-3 px-1.5 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-muted">{p.kind}</span>
              <span>
                <b>{p.kind === "tone" ? "tone " + p.expected : p.expected}</b>{" "}
                <span className="text-muted">first heard as</span>{" "}
                <b>{p.kind === "tone" ? "tone " + p.heard : p.heard}</b>
              </span>
              <span className="ml-auto text-xs tabular-nums text-muted">{p.n}×</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
