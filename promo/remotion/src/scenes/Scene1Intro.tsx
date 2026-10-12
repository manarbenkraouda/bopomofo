import type React from "react";
import { AbsoluteFill, spring } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { Bobo } from "../components/Bobo";
import { Sfx } from "../components/Sfx";
import { Headline } from "../components/Text";
import { Backdrop, Zhuyin } from "../components/Ui";
import { pop, popStyle } from "../lib/anim";
import { C, CJK, SANS } from "../lib/theme";

/** Shot 1, 0.0-2.5 s: "Learning Mandarin?" then "Meet your coach." Bobo pops up and waves. */
export const Scene1Intro: React.FC = () => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const tag = pop(frame, 20, fps);
  const tile = spring({ frame: frame - 25, fps, config: { damping: 11, stiffness: 110 } });
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop />
      <Headline text="Learning Mandarin?" at={-4} top={268} size={84} />
      <Headline text="Meet your coach." at={33} top={372} size={96} color={C.accent} />
      <Bobo pose="welcome" x={540} y={1500} width={600} enterAt={6} bob={8} sway={2} />
      <div style={{ position: "absolute", left: 0, width: 1080, top: 590, display: "flex", justifyContent: "center", ...popStyle(tag) }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: "14px 36px",
            background: C.card,
            borderRadius: 999,
            border: `2px solid ${C.line}`,
            boxShadow: "0 18px 34px -18px rgba(36,32,27,0.35)",
          }}
        >
          <span style={{ fontSize: 54, fontWeight: 800, color: C.ink }}>Bobo</span>
          <span style={{ fontFamily: CJK, fontSize: 52, fontWeight: 700, color: C.ink }}>波波</span>
          <Zhuyin style={{ fontSize: 44, color: C.accent }}>ㄅㄛ ㄅㄛ</Zhuyin>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 776,
          top: 728,
          width: 146,
          height: 146,
          borderRadius: 32,
          background: C.accent,
          color: C.cream,
          fontFamily: CJK,
          fontWeight: 700,
          fontSize: 100,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 18px 30px -14px rgba(181,69,47,0.6)",
          rotate: `${(1 - tile) * -540}deg`,
          scale: String(tile),
          opacity: tile > 0.02 ? 1 : 0,
          translate: `0px ${Math.sin((frame / fps) * Math.PI * 2 * 0.7) * 6}px`,
        }}
      >
        ㄅ
      </div>
      <Sfx name="pop.wav" at={0} />
      <Sfx name="whoosh.wav" at={5} volume={0.35} />
      <Sfx name="pop.wav" at={13} volume={0.4} />
      <Sfx name="pop.wav" at={20} volume={0.4} />
      <Sfx name="whoosh.wav" at={25} volume={0.25} />
      <Sfx name="pop.wav" at={33} />
    </AbsoluteFill>
  );
};
