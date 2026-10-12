import type React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Sfx } from "../components/Sfx";
import { Headline, SubText } from "../components/Text";
import { Backdrop, BoboFace, Card, CheckIcon, CrossIcon } from "../components/Ui";
import { CLAMP, pop, popStyle } from "../lib/anim";
import { C, CJK, SANS, TONE } from "../lib/theme";

const TILES: [string, string, string][] = [
  ["讀", "Read", TONE[1]],
  ["聽", "Listen", TONE[2]],
  ["說", "Speak", TONE[3]],
  ["寫", "Write", TONE[4]],
  ["認", "Recognize", C.ink],
];
const DOTS = [1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1];

/** Shot 2, 2.5-5.0 s: "Bobo watches every answer." Five practice tiles and an answers counter. */
export const Scene2Watch: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const count = Math.round(1284 * interpolate(frame, [14, 62], [0, 1], { ...CLAMP, easing: Easing.bezier(0.33, 0, 0.2, 1) }));
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Bobo watches every answer." at={-3} top={262} accent={["Bobo"]} />
      <SubText text="read · listen · speak · write · type" at={6} top={474} />
      {TILES.map(([hz, label, color], i) => (
        <Card
          key={hz}
          style={{
            left: 80 + i * 174,
            top: 590,
            width: 164,
            height: 216,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            ...popStyle(pop(frame, 8 + i * 4, fps)),
          }}
        >
          <span style={{ fontFamily: CJK, fontSize: 92, fontWeight: 700, color, lineHeight: 1 }}>{hz}</span>
          <span style={{ fontSize: 27, fontWeight: 700, color: C.ink }}>{label}</span>
        </Card>
      ))}
      <Card style={{ left: 80, top: 860, width: 860, height: 300, ...popStyle(pop(frame, 10, fps)) }}>
        <BoboFace size={220} style={{ position: "absolute", left: 38, top: 38, translate: `0px ${Math.sin((frame / fps) * Math.PI * 2 * 0.8) * 5}px` }} />
        <div style={{ position: "absolute", left: 300, top: 52, fontSize: 40, fontWeight: 600, color: C.muted }}>answers checked</div>
        <div style={{ position: "absolute", left: 296, top: 100, fontSize: 150, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {count.toLocaleString("en-US")}
        </div>
      </Card>
      {DOTS.map((ok, i) => {
        const s = pop(frame, 16 + i * 4, fps);
        const style = { position: "absolute" as const, left: 80 + i * (56 + 188 / 11), top: 1200, ...popStyle(s, 20, 0.4) };
        return ok ? <CheckIcon key={i} size={56} style={style} /> : <CrossIcon key={i} size={56} style={style} />;
      })}
      <Sfx name="pop.wav" at={0} />
      {[8, 12, 16, 20, 24].map((f) => (
        <Sfx key={f} name="pop.wav" at={f} volume={0.25} />
      ))}
      {DOTS.map((ok, i) => (
        <Sfx key={"t" + i} name={ok ? "tick.wav" : "boop.wav"} at={16 + i * 4} volume={ok ? 0.3 : 0.18} />
      ))}
    </AbsoluteFill>
  );
};
