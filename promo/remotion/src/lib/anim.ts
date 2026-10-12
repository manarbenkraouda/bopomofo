import { Easing, interpolate, spring } from "remotion";

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

/** A bouncy pop from 0 to 1 that starts at frame `at`. */
export const pop = (frame: number, at: number, fps: number) =>
  spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 190, mass: 0.8 } });

/** A smooth push from 0 to 1, no bounce. */
export const push = (frame: number, at: number, fps: number) =>
  spring({ frame: frame - at, fps, config: { damping: 200 } });

/** Linear progress from a to b with an ease-out curve, clamped. */
export const ramp = (frame: number, a: number, b: number, easing = EASE_OUT) =>
  interpolate(frame, [a, b], [0, 1], { ...CLAMP, easing });

/** Style for an element that pops in: fade, rise, and grow. */
export const popStyle = (s: number, rise = 50, from = 0.86) => ({
  opacity: interpolate(s, [0, 0.35], [0, 1], CLAMP),
  translate: `0px ${(1 - s) * rise}px`,
  scale: String(from + (1 - from) * s),
});
