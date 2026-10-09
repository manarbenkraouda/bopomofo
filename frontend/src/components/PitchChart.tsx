"use client";
import type { SpeechResult } from "@/lib/api";

// Simple target pitch shapes in semitones relative to the speaker's median (Chao tone letters, adapted).
const SHAPES: Record<number, [number, number][]> = {
  1: [[0, 3], [1, 3]],
  2: [[0, -1], [0.25, -1.3], [1, 3.5]],
  3: [[0, -2], [0.6, -5], [1, -3.5]],
  4: [[0, 4.5], [1, -4]],
};

export function PitchChart({ result, height = 190 }: { result: SpeechResult; height?: number }) {
  const { times, semitones } = result.pitch;
  const voiced = semitones.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (voiced.length < 3) return <div className="text-sm text-muted">No clear pitch found in the recording.</div>;
  const spans = result.syllables.map((s) => s.span).filter(Boolean) as [number, number][];
  const t0 = Math.max(0, Math.min(times[voiced[0]], ...spans.map((s) => s[0])) - 0.08);
  const t1 = Math.max(times[voiced[voiced.length - 1]], ...spans.map((s) => s[1])) + 0.08;
  const W = 1000, H = height, lo = -8, hi = 8;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (st: number) => H - ((Math.max(lo, Math.min(hi, st)) - lo) / (hi - lo)) * H;
  const segs: string[] = [];
  let cur = "";
  semitones.forEach((v, i) => {
    if (v === null || times[i] < t0 || times[i] > t1) { if (cur) segs.push(cur); cur = ""; return; }
    cur += (cur ? " L" : "M") + x(times[i]).toFixed(1) + " " + y(v).toFixed(1);
  });
  if (cur) segs.push(cur);
  return (
    <svg viewBox={"0 0 " + W + " " + (H + 30)} className="w-full" preserveAspectRatio="none" style={{ height: H + 30 }}>
      {[-6, -3, 0, 3, 6].map((g) => <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="#eee5d6" strokeWidth={1} />)}
      {result.syllables.map((s, i) => {
        if (!s.span) return null;
        const [a, b] = s.span;
        const tone = s.expected.surface_tone;
        const shape = SHAPES[tone];
        const ok = s.tone_ok;
        return (
          <g key={i}>
            <rect x={x(a)} y={0} width={Math.max(2, x(b) - x(a))} height={H} fill={ok ? "#2f946614" : "#d23f3f14"} stroke={i % 2 ? "#e3dbcc" : "none"} />
            {shape && <path d={shape.map(([u, v], k) => (k ? "L" : "M") + (x(a) + u * (x(b) - x(a))).toFixed(1) + " " + y(v).toFixed(1)).join(" ")} fill="none" stroke={ok ? "#2f9466" : "#d23f3f"} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" opacity={0.18} />}
            <text x={(x(a) + x(b)) / 2} y={H + 22} textAnchor="middle" fontSize={20} fill={ok ? "#2f9466" : "#d23f3f"} className="cjk">{s.expected.char} {tone === 5 ? "˙" : tone}</text>
          </g>
        );
      })}
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#24201b" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}
