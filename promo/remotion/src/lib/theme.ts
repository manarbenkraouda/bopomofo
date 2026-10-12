import { loadFont } from "@remotion/google-fonts/Inter";

// Latin text: Inter. Hanzi and Zhuyin: Microsoft JhengHei (installed on this Windows PC).
const { fontFamily: INTER } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

export const SANS = `${INTER}, "Microsoft JhengHei", sans-serif`;
export const CJK = `"Microsoft JhengHei", "Noto Sans TC", sans-serif`;

// Light palette from the storyboard. The dark values are for UI accents only.
export const C = {
  bg: "#f5f1e8",
  card: "#fffdf8",
  ink: "#24201b",
  muted: "#7b7367",
  line: "#e3dbcc",
  accent: "#b5452f",
  accentSoft: "#f3dcd3",
  ok: "#2f9466",
  gold: "#d39418",
  bad: "#d23f3f",
  cream: "#fffaf1",
  cream2: "#f1e6d6",
  pink: "#e0708a",
  track: "#efe7da",
  darkCard: "#1d1a22",
  darkInk: "#f2ece2",
  darkAccent: "#e5643f",
} as const;

export const TONE: Record<number, string> = {
  1: "#2f9466",
  2: "#d39418",
  3: "#3b82c4",
  4: "#b5452f",
  5: "#7b7367",
};

// Safe zone for TikTok and Reels: all text and key UI stay inside.
export const SAFE = { left: 80, right: 940, top: 240, bottom: 1420, width: 860 } as const;
