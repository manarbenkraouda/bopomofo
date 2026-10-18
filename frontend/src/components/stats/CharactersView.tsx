"use client";

import { type Stats as Data } from "@/lib/api";
import Link from "next/link";
import { accTone, tint } from "./charts";
import { percent } from "./display";

const href = (words: string[]) => "/characters?chars=" + encodeURIComponent(words.join(","));
const SOURCE_NAME: Record<string, string> = { deck: "Course words", sentence: "Words of your sentences" };

// ---------- Characters (read for meaning) ----------

export function CharactersView({ data }: { data: Data }) {
  const ch = data.characters;
  if (!ch || !ch.words.length)
    return (
      <div className="card p-6 text-muted">
        No characters yet. Open Characters to read traditional characters and pick their meaning.
      </div>
    );
  const weak = ch.words.filter((w) => w.ok < w.n).slice(0, 8);
  return (
    <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[1.3fr_1fr]">
      <section className="card p-4 md:p-5">
        <h2 className="font-semibold">Characters read</h2>
        <p className="mb-3 text-xs text-muted">
          {Object.entries(ch.sources)
            .map(([k, s]) => (SOURCE_NAME[k] ?? k) + ": " + percent(s.acc) + " right of " + s.n)
            .join(" · ")}
          . Click a word to train it.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ch.words.map((w) => (
            <Link
              key={w.text}
              href={href([w.text])}
              title={(w.english ? w.english + " · " : "") + w.ok + " right of " + w.n}
              className="cjk flex min-w-14 flex-col items-center rounded-xl border px-2 py-1.5 transition hover:border-accent"
              style={{ borderColor: tint(accTone(w.acc), 60), background: tint(accTone(w.acc), 14) }}
            >
              <span className="text-xl leading-tight">{w.text}</span>
              <span className="text-[10px] tabular-nums text-muted">
                {percent(w.acc)} · {w.n}
              </span>
            </Link>
          ))}
        </div>
        {weak.length > 0 && (
          <Link className="btn mt-4 inline-flex" href={href(weak.map((w) => w.text))}>
            Train the missed words
          </Link>
        )}
      </section>
      <section className="card p-4 md:p-5">
        <h2 className="mb-3 font-semibold">Taken for another word</h2>
        {ch.mixups.length ? (
          ch.mixups.map((x) => (
            <Link
              key={x.expected + ">" + x.picked}
              href={href([x.expected, x.picked])}
              className="cjk flex items-center gap-3 rounded-lg px-1.5 py-1 text-sm hover:bg-raise"
            >
              <b className="text-lg">{x.expected}</b>
              <span className="text-muted">→</span>
              <span className="text-bad text-lg">{x.picked}</span>
              {x.lookalike && <span className="text-xs text-muted">look-alike</span>}
              <span className="ml-auto text-xs text-muted">{x.n}×</span>
            </Link>
          ))
        ) : (
          <div className="text-sm text-muted">No mix-ups in this range.</div>
        )}
        {ch.never.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-sm font-semibold">Course words not practiced yet</h3>
            <Link href={href(ch.never)} className="cjk text-lg leading-relaxed hover:text-accent">
              {ch.never.join(" ")}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
