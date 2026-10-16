"use client";
import { useEffect, useRef } from "react";
import type { Pt } from "@/lib/matcher";
import { BOX, type Cluster } from "./segment";

/**
 * One sheet of paper for a whole answer: ruled lines, each BOX units high. The ink is kept in sheet units, so a symbol that fills a line
 * has the size of its stroke template. Thin bars under the ink show how the writing is split: one bar per symbol, a short orange bar per tone mark.
 */
export function Sheet({
  rows,
  cols,
  rowH,
  strokes,
  onChange,
  clusters,
  disabled,
  guide,
  overlay,
  state,
}: {
  rows: number;
  cols: number;
  rowH: number;
  strokes: Pt[][];
  onChange: (s: Pt[][]) => void;
  clusters: Cluster[];
  disabled?: boolean;
  guide?: React.ReactNode;
  overlay?: React.ReactNode;
  state?: "ok" | "nearly" | "bad" | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Pt[] | null>(null);
  const live = useRef<Pt[][]>(strokes);
  live.current = strokes;
  const W = Math.round(cols * rowH),
    H = rows * rowH;
  const VW = cols * BOX,
    VH = rows * BOX;

  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    if (disabled && overlay) return;
    const k = c.width / VW;
    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = "#24201b";
    g.lineWidth = 9 * dpr * Math.max(0.55, rowH / 200);
    for (const s of [...live.current, ...(cur.current ? [cur.current] : [])]) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.stroke();
    }
  };
  useEffect(draw);

  const pos = (e: React.PointerEvent | PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VW, ((e.clientY - r.top) / r.height) * VH];
  };
  const border =
    state === "ok" ? "border-ok" : state === "nearly" ? "border-rough" : state === "bad" ? "border-bad" : "border-line";
  return (
    <div
      className={"relative max-w-full rounded-xl border-2 sheet-paper touch-none select-none " + border}
      style={{ width: W, height: H }}
    >
      <svg
        viewBox={"0 0 " + VW + " " + VH}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        {Array.from({ length: rows }, (_, r) => (
          <g key={r}>
            <line
              x1={0}
              x2={VW}
              y1={(r + 0.07) * BOX}
              y2={(r + 0.07) * BOX}
              stroke="#eadfd0"
              strokeWidth={12}
              strokeDasharray="40 50"
            />
            <line x1={0} x2={VW} y1={(r + 0.88) * BOX} y2={(r + 0.88) * BOX} stroke="#e2d4c0" strokeWidth={16} />
            {r > 0 && <line x1={0} x2={VW} y1={r * BOX} y2={r * BOX} stroke="#efe6d8" strokeWidth={10} />}
          </g>
        ))}
        {guide}
        {!disabled &&
          clusters.map((c, i) => (
            <rect
              key={i}
              x={c.x0}
              y={(c.row + 0.93) * BOX}
              width={Math.max(60, c.x1 - c.x0)}
              height={c.mark ? 40 : 55}
              rx={25}
              fill={c.mark ? "#e08a3c" : "#b9a88f"}
              opacity={0.75}
            />
          ))}
      </svg>
      <canvas
        ref={canvas}
        className={"absolute inset-0 w-full h-full " + (disabled ? "" : "cursor-crosshair")}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          cur.current = [pos(e)];
          draw();
        }}
        onPointerMove={(e) => {
          if (!cur.current) return;
          const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
          for (const ev of evs) {
            const p = pos(ev),
              q = cur.current[cur.current.length - 1];
            if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 6) cur.current.push(p);
          }
          draw();
        }}
        onPointerUp={() => {
          if (!cur.current) return;
          const s =
            cur.current.length === 1
              ? [cur.current[0], [cur.current[0][0] + 1, cur.current[0][1] + 1] as Pt]
              : cur.current;
          cur.current = null;
          onChange([...live.current, s]);
        }}
        onPointerCancel={() => {
          cur.current = null;
          draw();
        }}
      />
      {overlay && (
        <svg
          viewBox={"0 0 " + VW + " " + VH}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {overlay}
        </svg>
      )}
    </div>
  );
}
