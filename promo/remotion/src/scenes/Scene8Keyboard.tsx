import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline, SubText } from "../components/Text";
import { Backdrop, Card, CardLabel, CheckIcon, GlyphTile, LockOpenIcon } from "../components/Ui";
import { CLAMP, pop, popStyle } from "../lib/anim";
import { C, SANS } from "../lib/theme";

const KEYS = [
  { label: "z", at: 12, w: 112 },
  { label: "h", at: 18, w: 112 },
  { label: "Enter", at: 26, w: 230 },
];
const STARS = [34, 38, 42];

const Star: React.FC<{ readonly size: number; readonly fill: string }> = ({ size, fill }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M50 6 L62 37 L95 38 L69 59 L78 92 L50 73 L22 92 L31 59 L5 38 L38 37 Z" fill={fill} stroke={fill} strokeWidth={6} strokeLinejoin="round" />
  </svg>
);

/** Shot 8, 23.5-26.5 s: "Keyboard first. No guessing." Recognize card, typed keys, stars, Level 2 open. */
export const Scene8Keyboard: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const typed = frame >= 18 ? "zh" : frame >= 12 ? "z" : "";
  const right = frame >= 29;
  const caret = !right && Math.floor(frame / 8) % 2 === 0;
  const badge = pop(frame, 48, fps);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Keyboard first. No guessing." at={-3} top={262} accent={["Keyboard"]} />
      <SubText text="★★★ only when it's right, fast, and on 2 days" at={8} top={472} size={42} />
      <Card style={{ left: 80, top: 610, width: 860, height: 470, ...popStyle(pop(frame, 4, fps)) }}>
        <div style={{ position: "absolute", left: 36, top: 26 }}>
          <CardLabel dot={C.gold}>Recognize · type the sound</CardLabel>
        </div>
        <GlyphTile glyph="ㄓ" size={210} style={{ position: "absolute", left: 36, top: 86, fontSize: 150 }} />
        <div
          style={{
            position: "absolute",
            left: 280,
            top: 96,
            width: 544,
            height: 112,
            boxSizing: "border-box",
            borderRadius: 18,
            border: `3px solid ${right ? C.ok : C.line}`,
            background: right ? "#eaf5ef" : "#fbf7f0",
            display: "flex",
            alignItems: "center",
            padding: "0 28px",
            fontSize: 64,
            fontWeight: 700,
            color: C.ink,
          }}
        >
          {typed}
          <span style={{ width: 4, height: 62, marginLeft: 4, background: C.ink, opacity: caret ? 1 : 0 }} />
          <span style={{ flex: 1 }} />
          {right ? <CheckIcon size={66} style={popStyle(pop(frame, 29, fps), 0, 0.3)} /> : null}
        </div>
        <div
          style={{
            position: "absolute",
            left: 280,
            top: 228,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 36,
            fontWeight: 800,
            color: C.ok,
            ...popStyle(pop(frame, 30, fps), 20),
          }}
        >
          Right · 1.4 s
        </div>
        <div style={{ position: "absolute", left: 36, top: 334, display: "flex", gap: 18 }}>
          {KEYS.map((k) => {
            const down = interpolate(frame, [k.at - 1, k.at, k.at + 4], [0, 1, 0], CLAMP);
            return (
              <div
                key={k.label}
                style={{
                  width: k.w,
                  height: 100,
                  boxSizing: "border-box",
                  borderRadius: 16,
                  background: down > 0.3 ? C.accentSoft : C.card,
                  border: `2px solid ${C.line}`,
                  boxShadow: `0 ${8 - down * 6}px 0 ${C.line}`,
                  translate: `0px ${down * 6}px`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: k.label === "Enter" ? 38 : 50,
                  fontWeight: 700,
                  color: C.ink,
                }}
              >
                {k.label}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 556, top: 330, display: "flex", gap: 6 }}>
          {STARS.map((at, i) => {
            const s = pop(frame, at, fps);
            const on = frame >= at;
            return (
              <div key={i} style={{ scale: on ? String(0.7 + 0.3 * s) : "0.85", rotate: on ? `${(1 - s) * -60}deg` : "0deg" }}>
                <Star size={84} fill={on ? C.gold : C.line} />
              </div>
            );
          })}
        </div>
      </Card>
      <Bobo pose="story-plan" x={220} y={1545} width={330} enterAt={8} disc={1.28} exitAt={84} hops={[48]} hopHeight={60} />
      <div
        style={{
          position: "absolute",
          left: 420,
          top: 1170,
          width: 520,
          height: 124,
          boxSizing: "border-box",
          borderRadius: 20,
          background: C.accent,
          color: C.cream,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          fontSize: 48,
          fontWeight: 800,
          boxShadow: "0 22px 40px -18px rgba(181,69,47,0.7)",
          ...popStyle(badge, 40, 0.5),
        }}
      >
        <LockOpenIcon size={56} color={C.cream} />
        Level 2 open
      </div>
      <Sfx name="pop.wav" at={0} />
      {KEYS.map((k) => (
        <Sfx key={k.label} name="click.wav" at={k.at} volume={0.7} />
      ))}
      <Sfx name="chime.wav" at={29} volume={0.45} />
      {STARS.map((at) => (
        <Sfx key={at} name="sparkle.wav" at={at} volume={0.25} />
      ))}
      <Sfx name="pop.wav" at={48} />
    </AbsoluteFill>
  );
};
