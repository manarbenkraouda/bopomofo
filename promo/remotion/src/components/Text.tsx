import type React from "react";
import { interpolate, spring } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { CLAMP } from "../lib/anim";
import { C, SAFE, SANS } from "../lib/theme";

type HeadlineProps = {
  readonly text: string;
  readonly at: number;
  readonly top: number;
  readonly size?: number;
  readonly color?: string;
  readonly accent?: string[];
  readonly align?: "left" | "center";
};

/** A bold headline. Each word pops in, one after the other. */
export const Headline: React.FC<HeadlineProps> = ({ text, at, top, size = 92, color = C.ink, accent = [], align = "left" }) => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const words = text.split(" ");
  const accents = accent.map((a) => a.replace(/[.,?!]/g, ""));
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top,
        width: SAFE.width,
        fontFamily: SANS,
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.06,
        letterSpacing: "-0.025em",
        color,
        textAlign: align,
      }}
    >
      {words.map((w, i) => {
        const s = spring({ frame: frame - at - i * 2, fps, config: { damping: 14, stiffness: 210, mass: 0.7 } });
        const clean = w.replace(/[.,?!]/g, "");
        return (
          <span key={i}>
            {i > 0 ? " " : ""}
            <span
              style={{
                display: "inline-block",
                opacity: interpolate(s, [0, 0.4], [0, 1], CLAMP),
                translate: `0px ${(1 - s) * 44}px`,
                scale: String(0.82 + 0.18 * s),
                color: accents.includes(clean) ? C.accent : undefined,
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
};

type SubProps = {
  readonly text: string;
  readonly at: number;
  readonly top: number;
  readonly size?: number;
  readonly align?: "left" | "center";
  readonly color?: string;
};

/** A secondary line (40-48 px) that slides in. */
export const SubText: React.FC<SubProps> = ({ text, at, top, size = 44, align = "left", color = C.muted }) => {
  const frame = useFrame();
  const fps = BASE_FPS;
  const s = spring({ frame: frame - at, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top,
        width: SAFE.width,
        fontFamily: SANS,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1.22,
        color,
        textAlign: align,
        textWrap: "balance",
        opacity: s,
        translate: `0px ${(1 - s) * 24}px`,
      }}
    >
      {text}
    </div>
  );
};
