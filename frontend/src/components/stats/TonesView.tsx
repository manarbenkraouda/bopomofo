"use client";

import { type Stats as Data } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AccGrid,
  accTone,
  AREA_COLOR,
  AREA_LABEL,
  AREA_ORDER,
  Disclosure,
  Matrix,
  Meter,
  pct,
  Segmented,
  tint,
} from "./charts";
import { confusionOf, mixups, percent, said, toneName, TONES, toneShort, trainHref } from "./display";
import { Trend } from "./Trend";

const MATRIX_INFO: Record<string, { title: string; note: string; cols: string[] }> = {
  speaking: {
    title: "Speaking",
    note: "Rows: the tone as it should be said (after tone changes). Columns: what the app heard. ? = not heard or not clear.",
    cols: [...TONES, "?"],
  },
  listening: { title: "Listening", note: "Rows: the tone you heard. Columns: your answer.", cols: TONES.slice(0, 4) },
  writing: {
    title: "Writing",
    note: "Rows: the tone to write. Columns: the mark you wrote. Tone 1 = no mark.",
    cols: TONES,
  },
};

type Ctx = "prev" | "next" | "position" | "sandhi" | "source";

export function TonesView({ data }: { data: Data }) {
  const router = useRouter();
  const toneAreas = AREA_ORDER.filter((a) => data.items.some((i) => i.area === a && i.kind === "tone"));
  const item = (a: string, t: string) => data.items.find((i) => i.area === a && i.kind === "tone" && i.expected === t);
  const rows = TONES.filter((t) => toneAreas.some((a) => item(a, t)));
  const weakest = data.items
    .filter((i) => i.kind === "tone" && i.n >= 5 && i.acc != null)
    .sort((x, y) => x.acc! - y.acc!)[0];
  const mix = mixups(data, "tone")
    .filter((m) => m.actual !== "?")
    .slice(0, 6);
  const matrixAreas = Object.keys(MATRIX_INFO).filter((a) =>
    data.confusion.some((c) => c.area === a && c.kind === "tone"),
  );
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
            Weakest:{" "}
            <b className="text-ink">{weakest.expected === "5" ? "the neutral tone" : "tone " + weakest.expected}</b> in{" "}
            {AREA_LABEL[weakest.area].toLowerCase()}, {percent(weakest.acc)} right over {weakest.n} answers.
          </p>
        )}
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-sm sm:border-spacing-1.5">
              <thead>
                <tr>
                  <th className="w-16 sm:w-20" />
                  {toneAreas.map((a) => (
                    <th key={a} className="pb-1 text-xs font-semibold" style={{ color: AREA_COLOR[a] }}>
                      {AREA_LABEL[a]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t}>
                    <th className="w-16 whitespace-nowrap pr-1 text-left text-sm font-semibold sm:w-20 sm:pr-2">
                      {toneName(t)}
                    </th>
                    {toneAreas.map((a) => {
                      const it = item(a, t);
                      if (!it)
                        return (
                          <td key={a} className="h-14 rounded-xl bg-raise/60 text-center text-xs text-muted">
                            –
                          </td>
                        );
                      const few = it.n < 5;
                      return (
                        <td key={a} className="h-14 p-0">
                          <Link
                            href={trainHref(a, "tone", [t, ...it.top.map((x) => x[0])].slice(0, 2))}
                            title={it.ok + " right of " + it.n}
                            className="flex h-full flex-col items-center justify-center rounded-xl transition hover:ring-2 hover:ring-accent"
                            style={{
                              background: few
                                ? "var(--raise)"
                                : tint(accTone(it.acc), 14 + Math.min(1, it.n / 30) * 26),
                            }}
                          >
                            <span className="flex items-baseline gap-1 text-base font-semibold tabular-nums">
                              {percent(it.acc)} <Trend it={it} />
                            </span>
                            <span className="text-[11px] tabular-nums text-muted">
                              {few ? (
                                "only " + it.n
                              ) : (
                                <>
                                  {it.n}
                                  <span className="max-sm:hidden"> answers</span>
                                </>
                              )}
                            </span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted">No tone answers in this range.</div>
        )}
      </section>

      <section className="card p-4 md:p-5">
        <h2 className="mb-3 font-semibold">What goes wrong</h2>
        {mix.length ? (
          <div className="flex flex-col gap-1">
            {mix.map((m) => (
              <Link
                key={m.area + m.expected + m.actual}
                href={trainHref(m.area, "tone", [m.expected, m.actual])}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-raise"
              >
                <span className="w-20 shrink-0 text-xs" style={{ color: AREA_COLOR[m.area] }}>
                  {AREA_LABEL[m.area]}
                </span>
                <span className="min-w-0 flex-1">
                  <b>{toneName(m.expected)}</b> <span className="text-muted">becomes</span>{" "}
                  <b className="text-bad">{said("tone", m.actual)}</b>
                </span>
                <span className="text-xs tabular-nums text-muted">
                  {m.n}× · {m.share}% of the time
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No mix-ups saved yet. Older answers only saved right or wrong. New answers also save the tone you said,
            heard, or wrote, so this list fills up as you practice.
          </p>
        )}
      </section>

      {matrixAreas.length > 0 && (
        <Disclosure title="Full mix-up tables" hint="Every tone against every answer, one area at a time">
          <div className="flex flex-col gap-3">
            {matrixAreas.length > 1 && (
              <Segmented
                options={matrixAreas.map((a) => ({ id: a, label: MATRIX_INFO[a].title }))}
                value={mArea}
                onChange={setMArea}
              />
            )}
            <p className="text-xs text-muted">{info.note} Click a row to train it.</p>
            <div className="max-w-2xl overflow-x-auto">
              <Matrix
                rows={TONES.filter((t) =>
                  data.confusion.some((c) => c.area === mArea && c.kind === "tone" && c.expected === t),
                )}
                cols={info.cols}
                get={confusionOf(data, mArea, "tone")}
                rowName={toneName}
                colName={toneShort}
                corner="expected ↓"
                onRow={(r) => {
                  const get = confusionOf(data, mArea, "tone");
                  const worst = info.cols.filter((c) => c !== r && c !== "?").sort((x, y) => get(r, y) - get(r, x))[0];
                  router.push(trainHref(mArea, "tone", get(r, worst) ? [r, worst] : [r]));
                }}
              />
            </div>
          </div>
        </Disclosure>
      )}

      {ctx.n > 0 && (
        <Disclosure
          title="Speaking in context"
          hint="How the tones around a syllable, its place, and tone changes affect your spoken tones"
        >
          <div className="flex flex-col gap-3">
            <Segmented<Ctx>
              value={view}
              onChange={setView}
              options={[
                { id: "prev", label: "After a tone" },
                { id: "next", label: "Before a tone" },
                { id: "position", label: "Place in sentence" },
                { id: "sandhi", label: "Tone changes" },
                { id: "source", label: "How it was judged" },
              ]}
            />
            <div className="max-w-2xl overflow-x-auto">
              {view === "prev" && (
                <>
                  <p className="mb-2 text-xs text-muted">
                    Accuracy of a tone (columns) when the tone before it is the row.
                  </p>
                  <AccGrid
                    rows={TONES}
                    cols={TONES}
                    get={look(ctx.prev)}
                    rowName={(r) => "after " + toneShort(r)}
                    colName={toneName}
                    corner="before ↓"
                  />
                </>
              )}
              {view === "next" && (
                <>
                  <p className="mb-2 text-xs text-muted">
                    Accuracy of a tone (rows) when the tone after it is the column.
                  </p>
                  <AccGrid
                    rows={TONES}
                    cols={TONES}
                    get={look(ctx.next)}
                    rowName={toneName}
                    colName={(c) => "→ " + toneShort(c)}
                    corner="tone ↓"
                  />
                </>
              )}
              {view === "position" && (
                <>
                  <p className="mb-2 text-xs text-muted">Alone = a single syllable, judged from your pitch.</p>
                  <AccGrid
                    rows={["alone", "first", "middle", "last"]}
                    cols={TONES}
                    get={look(ctx.position)}
                    rowName={(r) => r}
                    colName={toneName}
                  />
                </>
              )}
              {view === "sandhi" && (
                <>
                  <p className="mb-2 text-xs text-muted">
                    Syllables said in another tone than their own, such as 你好 (3 → 2) or 不是 (4 → 2).
                  </p>
                  {ctx.sandhi.length ? (
                    [...ctx.sandhi]
                      .sort((a, b) => b.n - a.n)
                      .map((s) => (
                        <BarRow
                          key={s.k.join()}
                          label={toneName(s.k[0]) + " said as " + toneShort(s.k[1])}
                          ok={s.ok}
                          n={s.n}
                        />
                      ))
                  ) : (
                    <div className="text-sm text-muted">No tone changes practiced in this range.</div>
                  )}
                </>
              )}
              {view === "source" && (
                <>
                  <p className="mb-2 text-xs text-muted">
                    Which signal judged the tone, and how often you were right by that signal.
                  </p>
                  {[...ctx.source]
                    .sort((a, b) => b.n - a.n)
                    .map((s) => (
                      <BarRow
                        key={s.k[0]}
                        label={
                          s.k[0] === "model"
                            ? "Speech model"
                            : s.k[0] === "pitch"
                              ? "Pitch curve"
                              : s.k[0] === "model+pitch"
                                ? "Model + your pitch range"
                                : s.k[0]
                        }
                        ok={s.ok}
                        n={s.n}
                      />
                    ))}
                  {ctx.uncertain > 0 && (
                    <p className="mt-2 text-xs text-muted">
                      {ctx.uncertain} of {ctx.n} tones: the model and the pitch curve disagreed.
                    </p>
                  )}
                </>
              )}
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
      <div className="flex-1">
        <Meter value={pct(ok, n)} />
      </div>
      <span className="w-10 text-right tabular-nums">{pct(ok, n)}%</span>
      <span className="w-8 text-right text-xs text-muted">{n}</span>
    </div>
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
      {!any && (
        <p className="mb-3 text-sm text-muted">
          No tone rule answers yet. Learn the 3-3, 不 and 一 rules before you say full sentences.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {rules.map((r) => {
          const few = r.n < 5;
          const quiz = r.areas.listening,
            speak = r.areas.speaking;
          return (
            <div key={r.rule} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex items-baseline gap-2">
                <b className="cjk">{r.name}</b>
                <span
                  className="ml-auto text-lg font-semibold tabular-nums"
                  style={{ color: few ? "var(--muted)" : accTone(r.acc) }}
                >
                  {r.n ? percent(r.acc) : "–"}
                </span>
              </div>
              <p className="text-xs text-muted cjk">{r.short}</p>
              {r.n > 0 && (
                <ul className="text-xs flex flex-col gap-0.5">
                  <li>
                    Quiz:{" "}
                    {quiz ? (
                      <>
                        {percent(quiz.acc)} of {quiz.n}
                      </>
                    ) : (
                      "not practiced"
                    )}{" "}
                    · Said aloud:{" "}
                    {speak ? (
                      <>
                        {percent(speak.acc)} of {speak.n}
                      </>
                    ) : (
                      "not practiced"
                    )}
                  </li>
                  {r.literal > 0 && (
                    <li className="text-bad">Read the written tone {r.literal}× where the rule changes it</li>
                  )}
                  {(r.errors.over ?? 0) > 0 && (
                    <li className="text-bad">Changed the tone {r.errors.over}× where it stays</li>
                  )}
                  {r.chars.filter((c) => c.ok < c.n).length > 0 && (
                    <li className="cjk">
                      Hardest:{" "}
                      {r.chars
                        .filter((c) => c.ok < c.n)
                        .map((c) => c.char + " " + c.ok + "/" + c.n)
                        .join(" · ")}
                    </li>
                  )}
                </ul>
              )}
              <div className="mt-auto flex gap-2 pt-1">
                <Link className="btn !py-1 text-xs" href={r.quiz_href}>
                  Quiz
                </Link>
                <Link className="btn !py-1 text-xs" href={r.speak_href}>
                  Say it
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
