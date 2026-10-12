import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline } from "../components/Text";
import { Backdrop, Card, CardLabel, CheckIcon, Zhuyin } from "../components/Ui";
import { CLAMP, pop, popStyle } from "../lib/anim";
import { PA_STROKES, type Stroke } from "../lib/strokes";
import { C, SANS } from "../lib/theme";

const polyLen = (pts: [number, number][]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** Ink that follows each stroke centerline, clipped to the stroke outline. */
const Strokes: React.FC<{ readonly id: string; readonly strokes: Stroke[]; readonly progress: number[]; readonly colors: string[]; readonly reverse?: boolean[] }> = ({
  id,
  strokes,
  progress,
  colors,
  reverse = [],
}) => (
  <svg viewBox="0 0 2048 2048" width={470} height={470} style={{ position: "absolute", left: 0, top: 0 }}>
    <defs>
      {strokes.map((s, i) => (
        <clipPath key={i} id={`${id}-clip-${i}`}>
          <path d={s.path} />
        </clipPath>
      ))}
    </defs>
    {strokes.map((s, i) => {
      const p = progress[i];
      if (p <= 0) return null;
      if (p >= 1) return <path key={i} d={s.path} fill={colors[i]} />;
      const pts = reverse[i] ? [...s.track].reverse() : s.track;
      const len = polyLen(pts);
      return (
        <polyline
          key={i}
          points={pts.map((q) => q.join(",")).join(" ")}
          fill="none"
          stroke={colors[i]}
          strokeWidth={240}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${len} ${len}`}
          strokeDashoffset={len * (1 - p)}
          clipPath={`url(#${id}-clip-${i})`}
        />
      );
    })}
  </svg>
);

/**
 * Shot 4, 9.0-11.5 s: "...and every stroke."
 * The app data gives ㄅ one stroke, so the stroke-2 error is shown on ㄆ (2 strokes, same data).
 */
export const Scene4Stroke: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const a1 = interpolate(frame, [8, 21], [0, 1], CLAMP);
  const a2 = interpolate(frame, [22, 33], [0, 1], CLAMP);
  const isWrong = frame >= 34;
  const tryOpacity = interpolate(frame, [44, 50], [1, 0.22], CLAMP);
  const g1 = interpolate(frame, [46, 55], [0, 1], CLAMP);
  const g2 = interpolate(frame, [55, 66], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="...and every stroke." at={-3} top={262} size={96} />
      <Card style={{ left: 80, top: 490, width: 860, height: 660, ...popStyle(pop(frame, 2, fps)) }}>
        <div style={{ position: "absolute", left: 36, top: 26 }}>
          <CardLabel dot={C.gold}>
            Writing · <Zhuyin style={{ color: C.ink }}>ㄆ</Zhuyin>
          </CardLabel>
        </div>
        <div
          style={{
            position: "absolute",
            left: 195,
            top: 84,
            width: 470,
            height: 470,
            borderRadius: 18,
            background: "#fbf7ef",
            border: `3px solid ${C.line}`,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <svg width={470} height={470} style={{ position: "absolute", left: -3, top: -3 }}>
            <line x1={235} y1={0} x2={235} y2={470} stroke={C.line} strokeWidth={3} strokeDasharray="12 12" />
            <line x1={0} y1={235} x2={470} y2={235} stroke={C.line} strokeWidth={3} strokeDasharray="12 12" />
          </svg>
          <div style={{ position: "absolute", left: -3, top: -3, width: 470, height: 470 }}>
            <svg viewBox="0 0 2048 2048" width={470} height={470} style={{ position: "absolute", left: 0, top: 0 }}>
              {PA_STROKES.map((s, i) => (
                <path key={i} d={s.path} fill="#ebe3d3" />
              ))}
            </svg>
            <div style={{ opacity: tryOpacity }}>
              <Strokes id="try" strokes={PA_STROKES} progress={[a1, a2]} colors={[C.ink, isWrong ? C.pink : C.ink]} reverse={[false, true]} />
            </div>
            <Strokes id="fix" strokes={PA_STROKES} progress={[g1, g2]} colors={[C.ok, C.ok]} />
          </div>
        </div>
        {frame >= 66 ? <CheckIcon size={76} style={{ position: "absolute", left: 620, top: 56, ...popStyle(pop(frame, 66, fps), 0, 0.3) }} /> : null}
        <div style={{ position: "absolute", left: 0, width: 860, top: 574, display: "flex", justifyContent: "center", ...popStyle(pop(frame, 34, fps), 20, 0.6) }}>
          <div style={{ padding: "12px 30px", borderRadius: 999, background: C.accentSoft, border: `3px solid ${C.pink}`, fontSize: 38, fontWeight: 800, color: C.bad }}>
            Stroke 2: wrong direction
          </div>
        </div>
      </Card>
      <Bobo pose="writing" x={540} y={1530} width={330} enterAt={6} />
      <Sfx name="pop.wav" at={0} />
      <Sfx name="brush.wav" at={8} volume={0.6} />
      <Sfx name="brush.wav" at={22} volume={0.6} />
      <Sfx name="boop.wav" at={34} volume={0.55} />
      <Sfx name="pop.wav" at={35} volume={0.4} />
      <Sfx name="brush.wav" at={46} volume={0.5} />
      <Sfx name="brush.wav" at={55} volume={0.5} />
      <Sfx name="chime.wav" at={66} volume={0.45} />
    </AbsoluteFill>
  );
};
