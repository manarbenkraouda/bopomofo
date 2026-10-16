"use client";

import { PlayButton } from "@/components/PlayButton";
import { ZhuyinText, type Annot } from "@/components/ZhuyinText";
import { ttsUrl, type Sentence } from "@/lib/api";
import { useEffect, useRef } from "react";
import { scoreTone } from "./display";

export function Row({
  s,
  annot,
  showEn,
  active,
  fresh,
  small,
  onOpen,
}: {
  s: Sentence;
  annot: Annot;
  showEn: boolean;
  active: boolean;
  fresh: boolean;
  small: boolean;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    was.current = active;
  }, [active]);
  const p = s.practice;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      className={
        "group flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors md:px-4 " +
        (active ? "bg-accent-soft/50 lg:shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-raise")
      }
    >
      <span onClick={(e) => e.stopPropagation()}>
        <PlayButton
          src={ttsUrl(s.hanzi)}
          title="Listen"
          className="!h-9 !w-9 shrink-0 !rounded-full !p-0 justify-center"
        />
      </span>
      <div className="min-w-0 flex-1">
        <ZhuyinText items={s.items} annot={annot} size={small ? 22 : 26} />
        {showEn && <div className="mt-1 truncate text-sm text-muted">{s.english}</div>}
      </div>
      {p ? (
        <span
          className={"shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums " + scoreTone(p.best)}
          title={"Said " + p.said + " times · best " + p.best}
        >
          {p.best}
        </span>
      ) : fresh ? (
        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">New</span>
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent/70" title="Not said yet" />
      )}
      <span className="shrink-0 text-lg leading-none text-muted opacity-40 group-hover:opacity-100 lg:hidden">›</span>
    </div>
  );
}
