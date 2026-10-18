"use client";

import { type Stats as Data } from "@/lib/api";
import { BAND_LABEL, BANDS, digits, hanzi, type Band } from "@/lib/numbers";
import Link from "next/link";
import { useState } from "react";
import { accTone, Meter, pct, Segmented, tint } from "./charts";
import { percent } from "./display";

type Mode = "listen" | "speak";
const MODE_NAME: Record<Mode, string> = { listen: "By ear", speak: "Spoken" };
const href = (mode: string, q: string) => "/numbers?mode=" + (mode === "speak" ? "speak" : "listen") + q;
const safeHanzi = (s: string) => (/^\d+$/.test(s) ? hanzi(Number(s)) : "");

// ---------- Numbers (listen and speak) ----------

export function NumbersView({ data }: { data: Data }) {
  const num = data.numbers;
  const modes = Object.keys(num?.modes ?? {}).filter((m): m is Mode => m === "listen" || m === "speak");
  const [pick, setPick] = useState("");
  if (!num || !modes.length)
    return (
      <div className="card p-6 text-muted">
        No numbers yet. Open Numbers to hear numbers and pick them, or to say them out loud.
      </div>
    );
  const mode = modes.find((k) => k === pick) ?? modes[0];
  const m = num.modes[mode];
  const bands = BANDS.map((b) => num.bands.find((x) => x.mode === mode && x.band === b)).filter((x) => !!x);
  const errors = num.errors.filter((e) => e.mode === mode);
  const maxErr = Math.max(1, ...errors.map((e) => e.n));
  const missed = num.missed.filter((x) => x.mode === mode);
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {modes.length > 1 && (
        <Segmented options={modes.map((k) => ({ id: k, label: MODE_NAME[k] ?? k }))} value={mode} onChange={setPick} />
      )}
      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="card p-4 md:p-5">
          <h2 className="font-semibold">Numbers {mode === "speak" ? "you said" : "by ear"}</h2>
          <p className="mb-3 text-xs text-muted">
            {percent(m.acc)} right on the first try, of {m.n}
            {m.ms ? " · " + (m.ms / 1000).toFixed(1) + " s for a right answer" : ""}. Click a size to train it.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {bands.map((b) => (
              <Link
                key={b.band}
                href={href(mode, "&bands=" + encodeURIComponent(b.band))}
                title={b.ok + " right of " + b.n}
                className="cjk flex min-w-20 flex-col items-center rounded-xl border px-2 py-1.5 transition hover:border-accent"
                style={{ borderColor: tint(accTone(b.acc), 60), background: tint(accTone(b.acc), 14) }}
              >
                <span className="text-base leading-tight">{BAND_LABEL[b.band as Band] ?? b.band}</span>
                <span className="text-[10px] tabular-nums text-muted">
                  {percent(b.acc)} · {b.n}
                </span>
              </Link>
            ))}
          </div>
          {missed.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Missed most</h3>
              <div className="flex flex-wrap gap-1.5">
                {missed.map((x) => (
                  <Link
                    key={x.number}
                    href={href(mode, "&nums=" + x.number)}
                    className="chip cjk flex items-center gap-1.5"
                    title={x.ok + " right of " + x.n}
                  >
                    <b className="tabular-nums">{digits(Number(x.number))}</b>
                    <span className="text-muted">{safeHanzi(x.number)}</span>
                    <span className="text-xs text-bad">
                      {x.n - x.ok}/{x.n}
                    </span>
                  </Link>
                ))}
              </div>
              <Link
                className="btn mt-3 inline-flex"
                href={href(mode, "&nums=" + missed.map((x) => x.number).join(","))}
              >
                Train these numbers
              </Link>
            </>
          )}
        </section>
        <section className="card p-4 md:p-5">
          <h2 className="mb-3 font-semibold">Kinds of error</h2>
          {errors.length ? (
            errors.map((e) => (
              <div key={e.error} className="flex items-center gap-3 px-1.5 py-1.5 text-sm">
                <span className="w-40 shrink-0" title={num.error_names[e.error]}>
                  {num.error_names[e.error] ?? e.error}
                </span>
                <div className="flex-1">
                  <Meter value={(100 * e.n) / maxErr} color="var(--bad)" />
                </div>
                <span className="w-8 text-right text-xs tabular-nums text-muted">{e.n}×</span>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted">No errors in this range.</div>
          )}
          {mode === "listen" && num.mixups.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Heard instead</h3>
              {num.mixups.map((x) => (
                <Link
                  key={x.expected + ">" + x.picked}
                  href={href("listen", "&nums=" + x.expected + "," + x.picked)}
                  className="cjk flex items-center gap-3 rounded-lg px-1.5 py-1 text-sm hover:bg-raise"
                >
                  <b className="tabular-nums">{digits(Number(x.expected))}</b>
                  <span className="text-muted">→</span>
                  <span className="text-bad tabular-nums">{digits(Number(x.picked))}</span>
                  <span className="ml-auto text-xs text-muted">{x.n}×</span>
                </Link>
              ))}
            </>
          )}
          {mode === "speak" && num.chars.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Characters said wrong</h3>
              <div className="flex flex-wrap gap-1.5">
                {num.chars.map((c) => (
                  <span
                    key={c.char}
                    className="cjk flex min-w-12 flex-col items-center rounded-xl border px-2 py-1"
                    style={{ borderColor: tint(accTone(c.acc), 60), background: tint(accTone(c.acc), 14) }}
                    title={c.ok + " right of " + c.n}
                  >
                    <span className="text-xl leading-tight">{c.char}</span>
                    <span className="text-[10px] tabular-nums text-muted">{pct(c.ok, c.n)}%</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
