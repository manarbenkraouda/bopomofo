import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline } from "../components/Text";
import { Backdrop, BoboFace, Card, CardLabel } from "../components/Ui";
import { CLAMP, pop, popStyle } from "../lib/anim";
import { C, SANS, TONE } from "../lib/theme";

const TICK0 = 10;
const TICK_GAP = 4;

/** Shot 7, 20.5-23.5 s: "Every 10 answers, Bobo adjusts." Step 1 fills in 10 ticks, then a checkpoint toast. */
export const Scene7Adjust: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const done = Math.max(0, Math.min(10, Math.floor((frame - TICK0) / TICK_GAP) + 1));
  const acc = interpolate(frame, [TICK0, TICK0 + TICK_GAP * 10], [78.6, 86], CLAMP);
  const toast = pop(frame, 50, fps);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Every 10 answers, Bobo adjusts." at={-3} top={262} accent={["adjusts."]} />
      <Card style={{ left: 80, top: 500, width: 860, height: 370, ...popStyle(pop(frame, 4, fps)) }}>
        <div style={{ position: "absolute", left: 36, top: 26 }}>
          <CardLabel dot={C.ok}>Coach plan · step 1</CardLabel>
        </div>
        <div style={{ position: "absolute", left: 36, top: 72, fontSize: 46, fontWeight: 800 }}>Tone 4 by ear</div>
        <div style={{ position: "absolute", right: 36, top: 60, textAlign: "right" }}>
          <div style={{ fontSize: 64, fontWeight: 800, color: acc >= 86 ? C.ok : C.ink, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {acc >= 86 ? "86" : acc.toFixed(1)}%
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: C.muted, marginTop: 6 }}>target 90%</div>
        </div>
        <div style={{ position: "absolute", left: 36, top: 170, width: 788, display: "flex", gap: 10 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const k = pop(frame, TICK0 + i * TICK_GAP, fps);
            const on = i < done;
            return (
              <div key={i} style={{ flex: 1, height: 62, borderRadius: 12, background: C.track, position: "relative", overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 12,
                    background: TONE[1],
                    opacity: on ? 1 : 0,
                    scale: on ? `1 ${Math.min(1.15, k)}` : "1 0",
                    transformOrigin: "50% 100%",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 36, top: 250, fontSize: 30, fontWeight: 700, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
          {done} / 10 answers
        </div>
        <div style={{ position: "absolute", left: 36, top: 306, width: 788, height: 22, borderRadius: 11, background: C.track }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 22, width: (788 * acc) / 100, borderRadius: 11, background: TONE[4] }} />
          <div style={{ position: "absolute", left: 788 * 0.9 - 3, top: -10, width: 6, height: 42, borderRadius: 3, background: C.ink }} />
        </div>
      </Card>
      <Card style={{ left: 80, top: 906, width: 860, height: 190, display: "flex", alignItems: "center", gap: 26, padding: "0 30px", ...popStyle(toast, 60, 0.7) }}>
        <BoboFace size={120} />
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.ok }}>Checkpoint · 10 answers</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.2, marginTop: 4 }}>
            Tone 4 is up to <span style={{ color: C.ok }}>86%</span>.
            <br />
            Narrowing to 4 vs 2.
          </div>
        </div>
      </Card>
      <Bobo pose="thinking" x={540} y={1545} width={380} enterAt={6} disc={1.22} sway={2.5} />
      <Sfx name="pop.wav" at={0} />
      {Array.from({ length: 10 }, (_, i) => (
        <Sfx key={i} name="tick.wav" at={TICK0 + i * TICK_GAP} volume={0.3} />
      ))}
      <Sfx name="chime.wav" at={50} volume={0.45} />
    </AbsoluteFill>
  );
};
