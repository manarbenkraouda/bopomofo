import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline } from "../components/Text";
import { Backdrop, Card, CardLabel, GlyphTile } from "../components/Ui";
import { CLAMP, pop, popStyle, ramp } from "../lib/anim";
import { C, SANS, TONE } from "../lib/theme";

const BARS = [
  { tone: 1, value: 96, label: "96%" },
  { tone: 2, value: 91, label: "91%" },
  { tone: 3, value: 88, label: "88%" },
  { tone: 4, value: 78.6, label: "78.6% on 28" },
];

/** Shot 5, 11.5-15.5 s: "Bobo finds your weak spots." Stats screen with a confusion row and tone bars. */
export const Scene5Stats: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const count = Math.round(interpolate(frame, [18, 38], [0, 6], CLAMP));
  const pulseOn = frame >= 60;
  const pulse = pulseOn ? 0.5 - 0.5 * Math.cos(((frame - 60) / fps) * Math.PI * 2 * 1.4) : 0;
  const chip = pop(frame, 64, fps);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Bobo finds your weak spots." at={-3} top={262} accent={["weak", "spots"]} />
      <Card style={{ left: 80, top: 500, width: 860, height: 636, ...popStyle(pop(frame, 6, fps)) }}>
        <div style={{ position: "absolute", left: 36, top: 26 }}>
          <CardLabel>Stats · what Bobo found</CardLabel>
        </div>
        <div
          style={{
            position: "absolute",
            left: 36,
            top: 84,
            width: 788,
            height: 150,
            boxSizing: "border-box",
            padding: "0 28px",
            borderRadius: 18,
            background: C.accentSoft,
            display: "flex",
            alignItems: "center",
            gap: 22,
            ...popStyle(pop(frame, 14, fps), 30, 0.9),
          }}
        >
          <GlyphTile glyph="ㄓ" size={108} bg={C.card} />
          <span style={{ fontSize: 40, fontWeight: 700, color: C.ink }}>taken for</span>
          <GlyphTile glyph="ㄗ" size={108} bg={C.card} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 80, fontWeight: 800, color: C.bad, fontVariantNumeric: "tabular-nums" }}>{count}x</span>
        </div>
        <div style={{ position: "absolute", left: 36, top: 266, ...popStyle(pop(frame, 20, fps), 20) }}>
          <CardLabel dot={C.gold}>Tones by ear</CardLabel>
        </div>
        {BARS.map((b, i) => {
          const grow = ramp(frame, 24 + i * 6, 50 + i * 6);
          const weak = b.tone === 4;
          const fill = weak && pulseOn ? (pulse > 0.5 ? C.bad : TONE[4]) : TONE[b.tone];
          return (
            <div
              key={b.tone}
              style={{
                position: "absolute",
                left: 36,
                top: 322 + i * 76,
                width: 788,
                height: 60,
                display: "flex",
                alignItems: "center",
                gap: 18,
                opacity: interpolate(frame, [20 + i * 6, 28 + i * 6], [0, 1], CLAMP),
              }}
            >
              <div style={{ width: 150, display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700, color: C.ink }}>
                <span style={{ width: 18, height: 18, borderRadius: 9, background: TONE[b.tone] }} />
                Tone {b.tone}
              </div>
              <div style={{ width: 400, height: 34, borderRadius: 17, background: C.track, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: 34,
                    width: (400 * b.value * grow) / 100,
                    borderRadius: 17,
                    background: fill,
                    boxShadow: weak && pulseOn ? `0 0 0 ${4 + pulse * 10}px rgba(210,63,63,${0.12 + pulse * 0.18})` : undefined,
                  }}
                />
              </div>
              <div
                style={{
                  flex: 1,
                  textAlign: "right",
                  fontSize: weak ? 34 : 34,
                  fontWeight: 800,
                  color: weak ? C.bad : C.ink,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {b.label}
              </div>
            </div>
          );
        })}
      </Card>
      <Bobo pose="investigate" x={760} y={1545} width={360} enterAt={10} disc={1.25} lean={{ at: 40, scale: 1.06, rotate: -3 }} />
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 1180,
          width: 440,
          boxSizing: "border-box",
          padding: "22px 28px",
          background: C.accentSoft,
          borderRadius: 20,
          fontSize: 40,
          fontWeight: 600,
          lineHeight: 1.24,
          color: C.ink,
          transformOrigin: "50% 0%",
          ...popStyle(chip, 30, 0.7),
        }}
      >
        <b style={{ color: C.bad }}>Tone 4</b> is often heard as <b style={{ borderBottom: `5px solid ${TONE[2]}` }}>tone 2</b>
      </div>
      <Sfx name="pop.wav" at={0} />
      <Sfx name="pop.wav" at={6} volume={0.3} />
      <Sfx name="tick.wav" at={18} volume={0.35} />
      <Sfx name="tick.wav" at={26} volume={0.35} />
      <Sfx name="tick.wav" at={34} volume={0.35} />
      <Sfx name="brush.wav" at={24} volume={0.3} />
      <Sfx name="boop.wav" at={60} volume={0.45} />
      <Sfx name="pop.wav" at={64} />
    </AbsoluteFill>
  );
};
