import { type BopomofoLevel, type Level, type Reason } from "@/lib/api";

/**
 * The onboarding after sign-up: one question per screen, a progress bar, Back, and a fixed Continue bar on a phone.
 * The answers go to the profile (the sentence writer and the coach read them) and to the settings (time zone, goal).
 * Keyboard: Enter continues, Esc goes back, 1-6 pick an answer.
 */

export const STEPS = ["welcome", "name", "why", "level", "bopomofo", "goal", "timezone", "mic", "done"] as const;

export type Step = (typeof STEPS)[number];

export const QUESTIONS = STEPS.length - 2;

// welcome and done are not questions

export type Draft = {
  name: string;
  reasons: Reason[];
  level: Level | null;
  bopomofo: BopomofoLevel | null;
  goal: number | null;
  timezone: string;
};

export const REASONS: { id: Reason; icon: string; label: string; sub: string }[] = [
  { id: "travel", icon: "旅", label: "Travel in Taiwan", sub: "Order food, ask the way, meet people" },
  { id: "family", icon: "家", label: "Family and friends", sub: "Talk with the people you love" },
  { id: "live", icon: "住", label: "Live in Taiwan", sub: "Now, or soon" },
  { id: "work", icon: "工", label: "Work or studies", sub: "Colleagues, classes, exams" },
  { id: "culture", icon: "劇", label: "Shows, music, and games", sub: "Enjoy them in Mandarin" },
  { id: "fun", icon: "腦", label: "For fun", sub: "Keep my mind sharp" },
];

export const LEVELS: { id: Level; bars: number; label: string; sub: string }[] = [
  { id: "new", bars: 1, label: "I'm new to Mandarin", sub: "Start from the first sound" },
  { id: "words", bars: 2, label: "I know some common words", sub: "你好, 謝謝, 我是…" },
  { id: "everyday", bars: 3, label: "I can talk about everyday topics", sub: "Food, work, plans, the weather" },
  { id: "fluent", bars: 4, label: "I can talk about most topics", sub: "I want to read and sound right" },
];

export const BOPOMOFO: { id: BopomofoLevel; icon: string; label: string; sub: string }[] = [
  { id: "none", icon: "？", label: "Not yet", sub: "Start with ㄅ ㄆ ㄇ ㄈ" },
  { id: "some", icon: "ㄅㄆ", label: "I know some symbols", sub: "I can read a few of them" },
  { id: "reads", icon: "ㄅㄆㄇ", label: "I can read it", sub: "Take me to the practice" },
];

export const GOALS: { min: number; label: string; icon: string }[] = [
  { min: 10, label: "Casual", icon: "🌱" },
  { min: 15, label: "Regular", icon: "🔥" },
  { min: 20, label: "Serious", icon: "⚡" },
  { min: 30, label: "Intense", icon: "🏆" },
];

export type Mic = "idle" | "asking" | "granted" | "denied" | "unsupported" | "skipped";
