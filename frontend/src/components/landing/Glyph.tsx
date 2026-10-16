import { useId } from "react";
import type { StrokeData } from "@/lib/zhuyin";

type Stroke = StrokeData[string][number];

const pointsOf = (s: Stroke) => (s.track.length === 1 ? [s.track[0], s.track[0]] : s.track);

/** Start time and duration (ms) of each stroke. Same method as StrokeAnim: the length of the centre line sets the time. */
export function strokeTimes(strokes: Stroke[], rate: number, gap: number) {
  let t = 0;
  return strokes.map((s) => {
    const pts = pointsOf(s);
    const len = pts.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0) + 1;
    const dur = Math.max(260, len / rate);
    const out = { len, dur, start: t };
    t += dur + gap;
    return out;
  });
}

export function writeTime(strokes: Stroke[], rate: number, gap: number) {
  const last = strokeTimes(strokes, rate, gap).at(-1);
  return last ? last.start + last.dur : 0;
}

/**
 * A symbol in the colour of its text. Each MOE outline clips a thick centre line, and the dash of the line grows
 * in writing order. With play off, the symbol is shown complete. Change the key to write it again.
 */
export function Glyph({
  strokes,
  play,
  delay = 0,
  rate = 4,
  gap = 60,
  className = "",
  label,
}: {
  strokes: Stroke[];
  play: boolean;
  delay?: number;
  rate?: number;
  gap?: number;
  className?: string;
  label?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const times = strokeTimes(strokes, rate, gap);
  return (
    <svg
      viewBox="0 0 2150 2150"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        {strokes.map((s, i) => (
          <clipPath key={i} id={uid + "c" + i}>
            <path d={s.path} />
          </clipPath>
        ))}
      </defs>
      <g className="ghost">
        {strokes.map((s, i) => (
          <path key={i} d={s.path} />
        ))}
      </g>
      {strokes.map((s, i) => {
        const { len, dur, start } = times[i];
        return (
          <polyline
            key={i}
            points={pointsOf(s)
              .map((p) => p.join(","))
              .join(" ")}
            clipPath={"url(#" + uid + "c" + i + ")"}
            style={{
              strokeDasharray: len,
              strokeDashoffset: play ? len : 0,
              animation: play
                ? "draw " + dur + "ms cubic-bezier(0.45, 0, 0.25, 1) " + (delay + start) + "ms forwards"
                : undefined,
            }}
          />
        );
      })}
    </svg>
  );
}
