"use client";

import { PlayButton } from "@/components/PlayButton";
import { Kbd } from "@/components/shell/Kbd";
import { ZhuyinText, type Annot } from "@/components/ZhuyinText";
import { ttsUrl, type Sentence } from "@/lib/api";
import Link from "next/link";
import { hearSyllable, sayWord, scoreTone, topicName } from "./display";

export function Detail({
  s,
  annot,
  onClose,
  onDelete,
  phone,
}: {
  s: Sentence;
  annot: Annot;
  onClose: () => void;
  onDelete: () => void;
  phone: boolean;
}) {
  const p = s.practice;
  return (
    <div className="flex flex-col gap-4">
      <div className="m-sheet-head -mb-2 flex items-center justify-between">
        <span className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <button className="icon-btn absolute right-4 top-4 !h-9 !w-9 text-lg" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{topicName(s.topic)}</span>
        <span className="rounded-full bg-raise px-2 py-0.5 text-muted">{s.level}</span>
        <span className="text-muted">
          {new Date(s.created * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}
        </span>
      </div>
      <div>
        <ZhuyinText
          items={s.items}
          annot={annot === "none" ? "zhuyin" : annot}
          size={phone ? 34 : 40}
          onSyllable={(i) => hearSyllable(s.items, i)}
        />
      </div>
      <div className="-mt-1 text-[15px] text-muted">{s.english}</div>
      <div className="flex gap-2">
        <PlayButton src={ttsUrl(s.hanzi)} label="Listen" className="flex-1 justify-center" />
        <PlayButton src={ttsUrl(s.hanzi, -35)} label="Slow" className="flex-1 justify-center" />
      </div>
      {s.words.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Words · tap to hear</div>
          <Words words={s.words} />
        </div>
      )}
      <div className="rounded-xl bg-raise p-3">
        {p ? (
          <div className="flex items-center gap-3">
            <span
              className={
                "grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums " +
                scoreTone(p.best)
              }
            >
              {p.best}
            </span>
            <div className="text-sm">
              <div className="font-medium">Best score {p.best}</div>
              <div className="text-muted">
                Said {p.said} time{p.said === 1 ? "" : "s"} · last {p.last}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">Not said aloud yet. Your first recording sets the score.</div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Link className="btn btn-accent justify-center !py-2.5" href={"/speaking?sentence=" + s.id}>
          說 Practice speaking <Kbd className="max-md:!hidden">S</Kbd>
        </Link>
        <Link className="btn justify-center !py-2.5" href={"/writing?sentence=" + s.id}>
          寫 Write the words <Kbd className="max-md:!hidden">W</Kbd>
        </Link>
        <button className="mt-1 self-center text-xs text-muted hover:text-bad" onClick={onDelete}>
          Delete this sentence
        </button>
      </div>
    </div>
  );
}

export function Words({ words }: { words: { text: string; english: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.map((w, i) => (
        <button
          key={i}
          onClick={() => sayWord(w.text)}
          className="flex items-baseline gap-1.5 rounded-xl border border-line bg-bg/60 px-2.5 py-1.5 text-sm transition hover:border-accent"
        >
          <span className="cjk text-base">{w.text}</span>
          <span className="text-muted">{w.english}</span>
        </button>
      ))}
    </div>
  );
}
