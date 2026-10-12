import type React from "react";
import { AbsoluteFill, interpolate, random } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline, SubText } from "../components/Text";
import { Backdrop, VMark } from "../components/Ui";
import { CLAMP, pop, popStyle } from "../lib/anim";
import { C, CJK, SANS } from "../lib/theme";

/** Scene frame where everything stops: 26.5 s + 2.0 s = 28.5 s. The last 1.5 s holds still. */
export const FREEZE = 60;
const HOPS = [8, 30];
const BOBO = { x: 540, y: 1130, width: 440 };

const GLYPHS = [
  { g: "ㄅ", x: 170, y: 700, at: 6, c: C.accent },
  { g: "ㄆ", x: 870, y: 680, at: 10, c: C.gold },
  { g: "ㄇ", x: 150, y: 1010, at: 14, c: C.ok },
  { g: "ㄈ", x: 880, y: 1000, at: 18, c: "#3b82c4" },
];

const COLORS = [C.accent, C.gold, C.ok, "#3b82c4", C.pink];
const PIECES = Array.from({ length: 46 }, (_, i) => ({
  burst: HOPS[i % 2] + 6,
  angle: -Math.PI / 2 + (random(`a${i}`) - 0.5) * Math.PI * 1.5,
  speed: 14 + random(`s${i}`) * 16,
  size: 12 + random(`z${i}`) * 12,
  spin: (random(`r${i}`) - 0.5) * 30,
  color: COLORS[i % COLORS.length],
}));

/** Shot 9, 26.5-30.0 s: end card. "Learn Bopomofo with Bobo." CTA "bopomofo.app". */
export const Scene9End: React.FC = () => {
  const raw = useFrame();
  const fps = BASE_FPS;
  const frame = Math.min(raw, FREEZE);
  const v = pop(frame, 2, fps);
  const cta = pop(frame, 22, fps);
  const sec = frame / fps;
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop variant="end" />
      <VMark
        width={1000}
        color={C.accentSoft}
        thickness={0.17}
        style={{ position: "absolute", left: 40, top: 560, opacity: v, translate: `0px ${(1 - v) * -200}px` }}
      />
      {GLYPHS.map((g, i) => {
        const s = pop(frame, g.at, fps);
        return (
          <div
            key={g.g}
            style={{
              position: "absolute",
              left: g.x - 55,
              top: g.y - 55,
              width: 110,
              height: 110,
              borderRadius: 26,
              background: C.card,
              border: `2px solid ${C.line}`,
              boxShadow: "0 16px 28px -16px rgba(36,32,27,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: CJK,
              fontWeight: 700,
              fontSize: 72,
              color: g.c,
              ...popStyle(s, 40, 0.4),
              translate: `0px ${(1 - s) * 40 + Math.sin(sec * 2.4 + i * 1.7) * 10}px`,
              rotate: `${Math.sin(sec * 1.8 + i) * 6}deg`,
            }}
          >
            {g.g}
          </div>
        );
      })}
      {PIECES.map((p, i) => {
        const t = frame - p.burst;
        if (t < 0) return null;
        const px = BOBO.x + Math.cos(p.angle) * p.speed * t;
        const py = BOBO.y - 300 + Math.sin(p.angle) * p.speed * t + 0.9 * t * t;
        const o = interpolate(t, [0, 3, 14, 22], [0, 1, 1, 0], CLAMP);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: px,
              top: py,
              width: p.size,
              height: p.size * 0.5,
              borderRadius: 3,
              background: p.color,
              opacity: o,
              rotate: `${p.spin * t}deg`,
            }}
          />
        );
      })}
      <Bobo pose="celebrate" x={BOBO.x} y={BOBO.y} width={BOBO.width} enterAt={0} disc={1.2} hops={HOPS} hopHeight={90} freezeAt={FREEZE} bob={6} />
      <Headline text="Learn Bopomofo with Bobo." at={4} top={262} size={100} align="center" accent={["Bobo."]} />
      <div style={{ position: "absolute", left: 0, width: 1080, top: 1196, display: "flex", justifyContent: "center", ...popStyle(cta, 40, 0.6) }}>
        <div
          style={{
            padding: "20px 64px",
            borderRadius: 999,
            background: C.accent,
            color: C.cream,
            fontSize: 60,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            boxShadow: "0 22px 40px -18px rgba(181,69,47,0.75)",
          }}
        >
          bopomofo.app
        </div>
      </div>
      <SubText text="Your AI Mandarin coach" at={30} top={1336} size={46} align="center" />
      <Sfx name="whoosh.wav" at={0} volume={0.4} />
      <Sfx name="pop.wav" at={4} />
      <Sfx name="sparkle.wav" at={14} volume={0.35} />
      <Sfx name="pop.wav" at={22} />
      <Sfx name="sparkle.wav" at={36} volume={0.35} />
      <Sfx name="chime.wav" at={40} volume={0.4} />
    </AbsoluteFill>
  );
};
