"use client";
import { useEffect, useRef } from "react";
import type { Pt } from "@/lib/matcher";

const BOX = 2150;

export function Pad({
  size,
  strokes,
  onChange,
  disabled,
  guide,
  overlay,
  state,
  inkWidth = 9,
}: {
  size: number;
  strokes: Pt[][];
  onChange: (s: Pt[][]) => void;
  disabled?: boolean;
  guide?: React.ReactNode;
  overlay?: React.ReactNode;
  state?: "ok" | "nearly" | "bad" | null;
  inkWidth?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Pt[] | null>(null);
  const live = useRef<Pt[][]>(strokes);
  live.current = strokes;

  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    if (disabled && overlay) return;
    const k = c.width / BOX;
    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = "#24201b";
    g.lineWidth = inkWidth * dpr * Math.max(0.6, size / 210);
    for (const s of [...live.current, ...(cur.current ? [cur.current] : [])]) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.stroke();
    }
  };
  useEffect(draw);

  const pos = (e: React.PointerEvent | PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOX, ((e.clientY - r.top) / r.height) * BOX];
  };
  const border =
    state === "ok" ? "border-ok" : state === "nearly" ? "border-rough" : state === "bad" ? "border-bad" : "border-line";
  return (
    <div
      className={"relative rounded-xl border-2 pad-grid touch-none select-none " + border}
      style={{ width: size, height: size }}
    >
      {guide && (
        <svg viewBox="0 0 2150 2150" className="absolute inset-0 w-full h-full pointer-events-none">
          {guide}
        </svg>
      )}
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
        <svg viewBox="0 0 2150 2150" className="absolute inset-0 w-full h-full pointer-events-none">
          {overlay}
        </svg>
      )}
    </div>
  );
}
