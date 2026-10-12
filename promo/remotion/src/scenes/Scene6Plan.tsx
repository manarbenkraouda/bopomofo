import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline, SubText } from "../components/Text";
import { Backdrop, Card, CardLabel, Zhuyin } from "../components/Ui";
import { CLAMP, pop, popStyle, push } from "../lib/anim";
import { C, SANS } from "../lib/theme";

const STEPS = [
  { at: 24, title: "Tone 4 by ear: target 90%", note: "78.6% on 28" },
  { at: 40, title: "ㄓ vs ㄗ: type it", note: "6 mix-ups" },
  { at: 56, title: "3-3 rule: say it aloud", note: "你好 in a speaking drill" },
];
const MISSES = [3, 8, 12, 17, 21, 25];

const StepTitle: React.FC<{ readonly text: string }> = ({ text }) => {
  // Keep the Zhuyin in the CJK font.
  const parts = text.split(/([ㄅ-ㄩ]+)/);
  return (
    <>
      {parts.map((p, i) => (/[ㄅ-ㄩ]/.test(p) ? <Zhuyin key={i}>{p}</Zhuyin> : <span key={i}>{p}</span>))}
    </>
  );
};

/** Shot 6, 15.5-20.5 s: "Then writes your plan." Coach plan with 3 steps and the "How do we know?" evidence. */
export const Scene6Plan: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const press = interpolate(frame, [82, 85, 90], [1, 0.9, 1], CLAMP);
  const opened = frame >= 84;
  const ev = pop(frame, 88, fps);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Then writes your plan." at={-3} top={262} accent={["plan."]} />
      <SubText text="exact drills, with the numbers behind them" at={10} top={472} size={42} />
      <Card style={{ left: 80, top: 610, width: 860, height: 500, ...popStyle(pop(frame, 14, fps)) }}>
        <div style={{ position: "absolute", left: 36, top: 26 }}>
          <CardLabel dot={C.ok}>Coach plan · this week</CardLabel>
        </div>
        {STEPS.map((s, i) => {
          const k = push(frame, s.at, fps);
          return (
            <div
              key={s.title}
              style={{
                position: "absolute",
                left: 36,
                top: 86 + i * 134,
                width: 788,
                height: 116,
                display: "flex",
                alignItems: "center",
                gap: 24,
                opacity: k,
                translate: `${(1 - k) * 120}px 0px`,
                borderBottom: i < 2 ? `2px solid ${C.line}` : undefined,
              }}
            >
              <div
                style={{
                  width: 66,
                  height: 66,
                  borderRadius: 33,
                  background: C.accent,
                  color: C.cream,
                  fontSize: 36,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 40, fontWeight: 800, color: C.ink, lineHeight: 1.15 }}>
                  <StepTitle text={s.title} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6 }}>
                  <span style={{ fontSize: 30, fontWeight: 600, color: C.muted }}>
                    <StepTitle text={s.note} />
                  </span>
                  {i === 0 ? (
                    <span
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        padding: "6px 18px",
                        borderRadius: 999,
                        background: opened ? C.accent : C.accentSoft,
                        color: opened ? C.cream : C.accent,
                        scale: String(press),
                        display: "inline-block",
                      }}
                    >
                      How do we know?
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </Card>
      <Bobo pose="story-stats" x={220} y={1545} width={330} enterAt={18} disc={1.28} lean={{ at: 84, scale: 1.04, rotate: 3 }} />
      <Card style={{ left: 400, top: 1144, width: 540, height: 272, transformOrigin: "30% 0%", ...popStyle(ev, 40, 0.6) }}>
        <div style={{ position: "absolute", left: 28, top: 20 }}>
          <CardLabel>How do we know?</CardLabel>
        </div>
        <div style={{ position: "absolute", left: 28, top: 66, fontSize: 34, fontWeight: 800 }}>Tone 4 by ear · last 28</div>
        <div style={{ position: "absolute", left: 28, top: 124, width: 484, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: 28 }, (_, i) => {
            const on = interpolate(frame, [92 + i, 96 + i], [0, 1], CLAMP);
            const miss = MISSES.includes(i);
            return (
              <div
                key={i}
                style={{ width: 26.5, height: 26.5, borderRadius: 6, background: miss ? C.bad : C.ok, opacity: 0.15 + 0.85 * on, scale: String(0.6 + 0.4 * on) }}
              />
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 28, top: 206, fontSize: 30, fontWeight: 700, color: C.muted }}>
          <span style={{ color: C.ok }}>22 right</span> · <span style={{ color: C.bad }}>misses heard as tone 2</span>
        </div>
      </Card>
      <Sfx name="pop.wav" at={0} />
      <Sfx name="pop.wav" at={14} volume={0.3} />
      <Sfx name="whoosh.wav" at={24} volume={0.25} />
      <Sfx name="whoosh.wav" at={40} volume={0.25} />
      <Sfx name="whoosh.wav" at={56} volume={0.25} />
      <Sfx name="click.wav" at={83} volume={0.6} />
      <Sfx name="pop.wav" at={88} />
      <Sfx name="sparkle.wav" at={96} volume={0.3} />
    </AbsoluteFill>
  );
};
