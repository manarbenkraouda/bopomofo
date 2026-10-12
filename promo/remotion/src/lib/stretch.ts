import { useCurrentFrame } from "remotion";

/** Time stretch for the whole promo. 1 = the 30 s cut, 1.5 = the 45 s cut. */
export const STRETCH = 1.5;
/** All scene timings are written in frames of a 30 fps timeline. */
export const BASE_FPS = 30;
/** Output frame rate. */
export const OUT_FPS = 60;
/** Output frames per timeline frame. */
export const K = (STRETCH * OUT_FPS) / BASE_FPS;

/** The current frame on the 30 s / 30 fps timeline (fractional). */
export const useFrame = () => useCurrentFrame() / K;
