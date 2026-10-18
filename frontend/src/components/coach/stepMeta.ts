import { type CoachStep } from "@/lib/api";

export const STEP_ICON: Record<string, string> = {
  speak_sentences: "說",
  speak_sounds: "說",
  listen_tones: "聽",
  listen_sounds: "聽",
  read_symbols: "讀",
  recognize_symbols: "認",
  write_symbols: "默",
  write_syllables: "寫",
  tone_rules: "變",
  numbers: "數",
  characters: "字",
};

export const STEP_KIND: Record<string, string> = {
  speak_sentences: "Speaking · sentences",
  speak_sounds: "Speaking · sounds",
  listen_tones: "Listening · tones",
  listen_sounds: "Listening · sounds",
  read_symbols: "Reading",
  recognize_symbols: "Recognize · silent",
  write_symbols: "Dictation",
  write_syllables: "Writing · syllables",
  tone_rules: "Tone rules",
  numbers: "Numbers",
  characters: "Characters",
};

export const DOMAIN: Record<string, string> = {
  tones_listening: "Tones by ear",
  tones_speaking: "Spoken tones",
  sounds: "Sounds",
  symbols: "Symbols",
  sentences: "Sentences",
  tone_rules: "Tone rules",
  numbers: "Numbers",
  characters: "Characters",
};

const RULE_CHIP: Record<string, string> = { "3-3": "3-3 rule", bu: "不 rule", yi: "一 rule" };

export const SKIP = { too_hard: "too hard", too_easy: "too easy", not_now: "not now" } as const;

/** Why a step was skipped: the learner's reason, or "locked" when its exercise is not unlocked yet. */
export const SKIPPED: Record<string, string> = { ...SKIP, locked: "not unlocked yet" };

export const SYMBOL_STEPS = new Set(["read_symbols", "recognize_symbols", "write_symbols"]);

/** Short labels for the focus of a step: tones, symbols, deck size, sentences. */
export function focusChips(s: CoachStep): string[] {
  const p = s.params;
  const out: string[] = [];
  if (p.tones?.length) out.push(p.tones.map((t) => (t === 5 ? "neutral tone" : "tone " + t)).join(" / "));
  if (p.syms?.length) out.push(p.syms.join(" "));
  if (p.focus?.pairs?.length) out.push("pairs " + p.focus.pairs.join(", "));
  if (p.deck?.length) out.push(p.deck.length + " picked syllables");
  if (p.texts?.length) out.push(p.texts.length + " sentences × " + p.reps + " at " + p.min_score + "+");
  if (p.rules?.length) out.push(p.rules.map((r) => RULE_CHIP[r] ?? r).join(" / "));
  if (s.type === "tone_rules")
    out.push(p.learn ? "learn: rule shown" : p.mode === "speak" ? "say aloud" : "from memory");
  if (s.type === "numbers") {
    out.push(p.mode === "speak" ? "say aloud" : "by ear");
    if (p.bands?.length) out.push(p.bands.join(" / "));
    if (p.nums?.length) out.push(p.nums.length + " picked numbers");
  }
  if (s.type === "characters" && p.chars?.length) out.push(p.chars.join(" "));
  return out;
}

export const ago = (ts: number) => {
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 1
    ? "just now"
    : m < 60
      ? m + " min ago"
      : m < 1440
        ? Math.round(m / 60) + " h ago"
        : Math.round(m / 1440) + " d ago";
};

export const share = (s: CoachStep) => Math.min(100, (100 * s.progress) / Math.max(1, s.target));

export type More = "goals" | "alphabet" | "evidence" | "notes" | "history";
