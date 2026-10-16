"use client";
import { useEffect, useState } from "react";
import { onPlaying, playAudio } from "@/lib/audio";

export function PlayButton({
  src,
  label,
  big,
  title,
  className = "",
}: {
  src: string;
  label?: string;
  big?: boolean;
  title?: string;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => onPlaying((s) => setPlaying(s === src)), [src]);
  if (big) {
    return (
      <button
        title={title ?? "Play"}
        onClick={() => playAudio(src)}
        className={
          "grid place-items-center w-16 h-16 shrink-0 rounded-full bg-accent text-white text-2xl shadow-sm transition " +
          (playing ? "ring-8 ring-accent-soft" : "") +
          " " +
          className
        }
      >
        ▶
      </button>
    );
  }
  return (
    <button
      title={title ?? "Play"}
      onClick={() => playAudio(src)}
      className={"btn " + (playing ? "border-accent text-accent " : "") + className}
    >
      <span>{playing ? "♪" : "▶"}</span>
      {label}
    </button>
  );
}
