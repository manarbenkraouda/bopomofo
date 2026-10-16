"use client";
import { useId } from "react";
import type { StrokeData } from "@/lib/zhuyin";

export function StrokeAnim({
  sym,
  data,
  size = 160,
  playKey = 0,
  speed = 1,
  className = "",
  numbers = true,
}: {
  sym: string;
  data: StrokeData;
  size?: number;
  playKey?: number;
  speed?: number;
  className?: string;
  numbers?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const strokes = data[sym];
  if (!strokes) return <div style={{ width: size, height: size }} />;
  // Start time of each stroke: previous strokes' durations plus a short pause.
  const timing = strokes.reduce<{ len: number; dur: number; d: number }[]>((acc, s) => {
    const pts = s.track.length === 1 ? [s.track[0], s.track[0]] : s.track;
    const len = pts.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0) + 1;
    const dur = Math.max(0.35, len / 2400) / speed;
    const prev = acc[acc.length - 1];
    acc.push({ len, dur, d: prev ? prev.d + prev.dur + 0.25 / speed : 0 });
    return acc;
  }, []);
  return (
    <svg
      key={playKey}
      viewBox="0 0 2150 2150"
      width={size}
      height={size}
      className={"pad-grid rounded-xl border border-line " + className}
    >
      {strokes.map((s, i) => {
        const pts = s.track.length === 1 ? [s.track[0], s.track[0]] : s.track;
        const { len, dur, d } = timing[i];
        const id = uid + "c" + i;
        return (
          <g key={i}>
            <clipPath id={id}>
              <path d={s.path} />
            </clipPath>
            <path d={s.path} fill="#efe8dc" />
            <polyline
              points={pts.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="#b5452f"
              strokeWidth={300}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={"url(#" + id + ")"}
              style={{
                strokeDasharray: len,
                strokeDashoffset: len,
                animation: "draw " + dur + "s linear " + d + "s forwards",
              }}
            />
            {numbers && (
              <text
                x={s.track[0][0] - 110}
                y={s.track[0][1] - 40}
                fontSize={140}
                fontWeight={700}
                fill="#b5452f"
                opacity={0}
              >
                <animate attributeName="opacity" from="0" to="1" begin={d + "s"} dur="0.01s" fill="freeze" />
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
