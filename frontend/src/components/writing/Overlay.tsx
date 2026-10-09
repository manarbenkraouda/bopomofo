"use client";
import type { Pt, SymbolResult } from "@/lib/matcher";
import type { StrokeData } from "@/lib/zhuyin";

export const COLORS: Record<string, string> = { ok: "#2f9466", rough: "#d39418", wrong: "#d23f3f", reversed: "#d23f3f", missing: "#d23f3f", joined: "#8a55c8", extra: "#9a8f80", order: "#d23f3f" };

export function UserStrokes({ strokes, colors, dashed, tone }: { strokes: Pt[][]; colors: (string | undefined)[]; dashed?: boolean[]; tone?: boolean }) {
  const w = tone ? 70 : 85;
  return (
    <>
      {strokes.map((s, j) => {
        const color = colors[j] ?? COLORS.extra;
        return (
          <g key={j}>
            <polyline points={s.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed?.[j] ? "60 90" : undefined} opacity={0.9} />
            <circle cx={s[0][0]} cy={s[0][1]} r={95} fill={color} />
            <text x={s[0][0]} y={s[0][1] + 45} textAnchor="middle" fontSize={130} fontWeight={700} fill="#fff">{j + 1}</text>
          </g>
        );
      })}
    </>
  );
}

export function ResultOverlay({ r, strokes, data, tone }: { r: SymbolResult; strokes: Pt[][]; data: StrokeData; tone?: boolean }) {
  const f = r.frame ?? { scale: 1, tx: 0, ty: 0 };
  const exp = r.variant === "vertical" ? null : data[r.expected];
  const colors: (string | undefined)[] = strokes.map(() => undefined);
  const dashed = strokes.map(() => true);
  for (const s of r.strokes) {
    if (s.userIdx == null) continue;
    colors[s.userIdx] = COLORS[s.orderError ? "order" : s.status];
    dashed[s.userIdx] = false;
  }
  return (
    <>
      <g transform={"matrix(" + f.scale + " 0 0 " + f.scale + " " + f.tx + " " + f.ty + ")"}>
        {exp ? exp.map((s, i) => <path key={i} d={s.path} fill={r.strokes[i]?.status === "missing" ? "#f3c5c5" : "#ece4d6"} />)
          : <line x1={1075} y1={190} x2={1075} y2={1840} stroke="#ece4d6" strokeWidth={150} strokeLinecap="round" />}
      </g>
      <UserStrokes strokes={strokes} colors={colors} dashed={dashed} tone={tone} />
    </>
  );
}

export function Guide({ sym, data }: { sym: string; data: StrokeData }) {
  return <>{(data[sym] ?? []).map((s, i) => <path key={i} d={s.path} fill="#e9e1d3" />)}</>;
}
