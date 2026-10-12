import type React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { BASE_FPS, K, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline } from "../components/Text";
import { Backdrop, Card, CardLabel, CheckIcon, CrossIcon, Zhuyin } from "../components/Ui";
import { CLAMP, pop, popStyle } from "../lib/anim";
import { C, CJK, SANS, TONE } from "../lib/theme";

/** Shot 3, 5.0-9.0 s: "Feedback on every tone." 你好 with the pitch line over the target tone shapes. */
export const Scene3Tone: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const p1 = interpolate(frame, [12, 30], [0, 1], CLAMP);
  const p2 = interpolate(frame, [30, 50], [0, 1], CLAMP);
  const wrong = frame >= 54;
  const right = frame >= 60;
  const chip = pop(frame, 64, fps);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Feedback on every tone." at={-3} top={262} />
      <Card style={{ left: 80, top: 498, width: 860, height: 612, ...popStyle(pop(frame, 4, fps)) }}>
        <div style={{ position: "absolute", left: 36, top: 26 }}>
          <CardLabel dot={C.bad}>Speaking · read aloud</CardLabel>
        </div>
        {[
          { hz: "你", zy: "ㄋㄧˇ", cx: 230, target: "target: tone 2", tc: TONE[2] },
          { hz: "好", zy: "ㄏㄠˇ", cx: 630, target: "target: tone 3", tc: TONE[3] },
        ].map((c, i) => (
          <div key={c.hz} style={{ position: "absolute", left: c.cx - 170, top: 76, width: 340, textAlign: "center" }}>
            <Zhuyin style={{ fontSize: 50, color: TONE[3], display: "block", lineHeight: 1.1 }}>{c.zy}</Zhuyin>
            <div style={{ fontFamily: CJK, fontSize: 150, fontWeight: 700, lineHeight: 1.05, color: i === 0 && wrong ? C.bad : C.ink }}>{c.hz}</div>
            <div style={{ position: "absolute", left: 0, width: 340, top: 448, display: "flex", justifyContent: "center", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 700, color: C.ink }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: c.tc }} />
              {c.target}
            </div>
          </div>
        ))}
        {wrong ? <CrossIcon size={64} style={{ position: "absolute", left: 300, top: 150, ...popStyle(pop(frame, 54, fps), 0, 0.3) }} /> : null}
        {right ? <CheckIcon size={64} style={{ position: "absolute", left: 700, top: 150, ...popStyle(pop(frame, 60, fps), 0, 0.3) }} /> : null}
        <svg width={780} height={200} viewBox="0 0 780 200" style={{ position: "absolute", left: 40, top: 300 }}>
          <rect x={0} y={0} width={780} height={200} rx={16} fill="#f7f2ea" />
          <line x1={390} y1={16} x2={390} y2={184} stroke={C.line} strokeWidth={3} strokeDasharray="8 10" />
          <path d="M 40 130 C 140 132, 250 100, 350 40" fill="none" stroke={TONE[2]} strokeOpacity={0.35} strokeWidth={30} strokeLinecap="round" />
          <path d="M 430 95 C 520 175, 610 182, 740 118" fill="none" stroke={TONE[3]} strokeOpacity={0.35} strokeWidth={30} strokeLinecap="round" />
          <path
            d="M 40 98 C 130 168, 250 178, 350 122"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - p1}
            fill="none"
            stroke={wrong ? C.bad : C.ink}
            strokeWidth={9}
            strokeLinecap="round"
            opacity={p1 > 0 ? 1 : 0}
          />
          <path
            d="M 430 100 C 520 172, 612 176, 740 114"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - p2}
            fill="none"
            stroke={right ? C.ok : C.ink}
            strokeWidth={9}
            strokeLinecap="round"
            opacity={p2 > 0 ? 1 : 0}
          />
        </svg>
      </Card>
      <Bobo pose="story-tones" x={228} y={1545} width={340} enterAt={8} />
      <div
        style={{
          position: "absolute",
          left: 404,
          top: 1140,
          width: 536,
          boxSizing: "border-box",
          padding: "22px 28px",
          background: C.accentSoft,
          borderRadius: 20,
          fontSize: 36,
          fontWeight: 600,
          lineHeight: 1.26,
          color: C.ink,
          transformOrigin: "0% 50%",
          ...popStyle(chip, 30, 0.7),
        }}
      >
        You read the written tone. <span style={{ fontFamily: CJK, fontWeight: 700 }}>你</span> is said{" "}
        <b style={{ borderBottom: `5px solid ${TONE[2]}` }}>tone 2</b> here: the <b style={{ color: C.accent }}>3-3 rule</b>.
      </div>
      <Sfx name="pop.wav" at={0} />
      <Sfx name="pop.wav" at={4} volume={0.3} />
      <Audio name="learner 你" src={staticFile("audio/ni3.mp3")} from={Math.round(12 * K)} volume={0.9} premountFor={fps} />
      <Audio name="learner 好" src={staticFile("audio/hao3.mp3")} from={Math.round(30 * K)} volume={0.9} premountFor={fps} />
      <Sfx name="boop.wav" at={54} volume={0.5} />
      <Sfx name="chime.wav" at={60} volume={0.45} />
      <Sfx name="pop.wav" at={64} />
    </AbsoluteFill>
  );
};
