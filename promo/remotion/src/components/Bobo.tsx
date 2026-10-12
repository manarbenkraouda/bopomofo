import type React from "react";
import { CanvasImage, interpolate, spring, staticFile } from "remotion";
import { BASE_FPS, useFrame } from "../lib/stretch";
import { CLAMP } from "../lib/anim";
import { C } from "../lib/theme";

type Lean = { readonly at: number; readonly scale: number; readonly rotate: number };

export type BoboProps = {
  /** File name in public/bobo without "bobo-" and ".png", for example "welcome" or "story-tones". */
  readonly pose: string;
  /** Centre x of the body. */
  readonly x: number;
  /** Baseline of the feet. */
  readonly y: number;
  readonly width: number;
  readonly enterAt?: number;
  readonly exitAt?: number;
  /** Up and down bob in px. */
  readonly bob?: number;
  /** Rotation about the feet in degrees. */
  readonly sway?: number;
  readonly lean?: Lean;
  /** Frames where a hop starts. */
  readonly hops?: number[];
  readonly hopHeight?: number;
  /** After this frame, Bobo holds still. */
  readonly freezeAt?: number;
  /** Size of the cream disc behind Bobo, relative to his width. 0 hides it. */
  readonly disc?: number;
};

const HOP = 16;

/**
 * Bobo, animated in code: pop with squash and stretch, bob, sway and lean about the feet, hops.
 * He always sits on a cream disc, and nothing is drawn over his chest, so the white V collar stays visible.
 */
export const Bobo: React.FC<BoboProps> = ({
  pose,
  x,
  y,
  width,
  enterAt = 0,
  exitAt,
  bob = 7,
  sway = 1.5,
  lean,
  hops = [],
  hopHeight = 110,
  freezeAt,
  disc = 1.32,
}) => {
  const raw = useFrame();
  const fps = BASE_FPS;
  const frame = freezeAt === undefined ? raw : Math.min(raw, freezeAt);
  const h = width * (pose.startsWith("story") ? 671 / 640 : 587 / 560);
  const t = frame - enterAt;
  const sp = (f: number) => spring({ frame: f, fps, config: { damping: 10, stiffness: 150, mass: 0.9 } });
  const enter = sp(t);
  const vel = sp(t + 1) - enter;
  const visible = t >= 0 ? 1 : 0;

  let dy = (1 - enter) * 380;
  let base = interpolate(enter, [0, 1], [0.45, 1]);
  const stretch = Math.max(-0.14, Math.min(0.2, vel * 2.4));
  let sx = 1 - stretch * 0.55;
  let sy = 1 + stretch;
  let rot = 0;

  // idle: bob, breathe, sway about the feet
  const idle = interpolate(t, [10, 24], [0, 1], CLAMP);
  const sec = frame / fps;
  dy += Math.sin(sec * Math.PI * 2 * 0.8) * bob * idle;
  sy *= 1 + 0.014 * Math.sin(sec * Math.PI * 2 * 0.8 + 1.2) * idle;
  sx *= 1 - 0.01 * Math.sin(sec * Math.PI * 2 * 0.8 + 1.2) * idle;
  rot += Math.sin(sec * Math.PI * 2 * 0.45) * sway * idle;

  if (lean) {
    const k = spring({ frame: frame - lean.at, fps, config: { damping: 14, stiffness: 120 } });
    base *= 1 + (lean.scale - 1) * k;
    rot += lean.rotate * k;
  }

  for (const s of hops) {
    const pre = frame - (s - 5);
    if (pre >= 0 && pre < 5) {
      const q = Math.sin((Math.PI * pre) / 5);
      sy *= 1 - 0.13 * q;
      sx *= 1 + 0.09 * q;
    }
    const u = (frame - s) / HOP;
    if (u >= 0 && u <= 1) {
      dy -= 4 * hopHeight * u * (1 - u);
      const st = Math.abs(0.1 * Math.cos(Math.PI * u));
      sy *= 1 + st;
      sx *= 1 - st * 0.6;
      rot += 5 * Math.sin(2 * Math.PI * u);
    }
    const post = frame - (s + HOP);
    if (post >= 0 && post < 12) {
      const q = Math.exp(-post / 3.2) * Math.cos(post * 0.8);
      sy *= 1 - 0.14 * q;
      sx *= 1 + 0.1 * q;
    }
  }

  let fade = 1;
  if (exitAt !== undefined) {
    const e = spring({ frame: frame - exitAt, fps, config: { damping: 200, stiffness: 220 } });
    base *= 1 - e;
    dy -= e * 30;
    fade = 1 - e;
  }

  const lift = Math.max(0, -dy);
  const D = width * disc;
  const discScale = interpolate(enter, [0, 1], [0.3, 1]) * (exitAt === undefined ? 1 : fade);

  return (
    <>
      {disc > 0 ? (
        <div
          style={{
            position: "absolute",
            left: x - D / 2,
            top: y - h * 0.5 - D / 2,
            width: D,
            height: D,
            borderRadius: "50%",
            background: `radial-gradient(circle closest-side, ${C.cream} 0%, ${C.cream} 66%, ${C.cream2} 88%, rgba(241,230,214,0) 100%)`,
            translate: `0px ${dy * 0.3}px`,
            scale: String(discScale),
            opacity: visible,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x - width * 0.3,
          top: y - h * 0.05 - 18,
          width: width * 0.6,
          height: 36,
          borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(36,32,27,0.22), rgba(36,32,27,0))",
          scale: String(Math.max(0.4, 1 - lift / 260) * base),
          opacity: visible * fade,
        }}
      />
      <CanvasImage
        src={staticFile(`bobo/bobo-${pose}.png`)}
        width={width}
        height={Math.round(h)}
        style={{
          position: "absolute",
          left: x - width / 2,
          top: y - h,
          transformOrigin: "50% 95%",
          translate: `0px ${dy}px`,
          scale: `${base * sx} ${base * sy}`,
          rotate: `${rot}deg`,
          opacity: visible * fade,
          filter: "drop-shadow(0 16px 22px rgba(36,32,27,0.18))",
        }}
      />
    </>
  );
};
