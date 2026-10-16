export type Syl = {
  type: "syllable";
  char: string;
  zhuyin: string;
  initial: string;
  final: string;
  tone: number;
  surface_tone: number;
  pinyin: string;
  alt_tones: number[];
  /** The tone change rule that sets surface_tone here: "3-3", "bu" (不) or "yi" (一). */
  rule?: RuleId | null;
};

export type RuleId = "3-3" | "bu" | "yi";

export type ToneRule = { name: string; short: string; explain: string };

/** A short phrase of the tone rule exercises. target: the index of the tested syllable. changes: false when the written tone stays. */
export type RulePhrase = {
  text: string;
  english: string;
  target: number;
  rule: RuleId;
  changes: boolean;
  char: string;
  written: number;
  said: number;
  zhuyin: string;
  said_zhuyin: string;
  items: TextItem[];
};

export type RuleStat = {
  rule: RuleId;
  name: string;
  short: string;
  n: number;
  ok: number;
  acc: number | null;
  recent: number | null;
  recent_n: number;
  errors: Record<string, number>;
  literal: number;
  areas: Record<string, { n: number; ok: number; acc: number | null }>;
  chars: { char: string; n: number; ok: number }[];
  quiz_href: string;
  speak_href: string;
};

export type TextItem = Syl | { type: "text"; text: string };

/** practice: how often the sentence was said aloud (Speaking), with the best and last score. Null when never said. */
export type Sentence = {
  id: number;
  hanzi: string;
  english: string;
  words: { text: string; english: string }[];
  topic: string;
  level: string;
  created: number;
  items: TextItem[];
  practice?: { said: number; best: number; last: number; ts: number } | null;
};

export type SpeechSyllable = {
  expected: Syl;
  heard: { initial: string | null; final: string | null; tone: number | null; zhuyin: string | null } | null;
  initial_ok: boolean | null;
  final_ok: boolean | null;
  tone_ok: boolean;
  messages: string[];
  model_tone?: number | null;
  pitch_tone?: number | null;
  tone_source?: "model" | "pitch" | "model+pitch";
  span?: [number, number] | null;
  uncertain?: boolean;
  /** The tone rule this syllable tests, and the error: "literal" (read the written tone), "over" (changed 不/一 where it stays), "other". */
  rule?: RuleId | null;
  rule_error?: "literal" | "over" | "other" | null;
};

export type SpeechResult = {
  text: string;
  score: number;
  syllables: SpeechSyllable[];
  extra: { zhuyin: string; span: [number, number] }[];
  heard_raw: string;
  pitch: { times: number[]; semitones: (number | null)[]; ref_hz: number };
  timing: { infer_seconds: number; audio_seconds: number };
};

/** The second, slower check of one missed speaking answer. */
export type DeepCheck = {
  status: "done" | "error";
  verdict: "false_miss" | "partial" | "real_miss" | null;
  applied: boolean;
  score_after: number | null;
  notice_id: number | null;
};

export type Health = {
  ok: boolean;
  speech_model: "ready" | "loading" | "error";
  speech_error: string | null;
  llm_model: string;
  llm_configured: boolean;
  speaker_hz: number | null;
};

export type SymbolCheck = {
  target: string;
  ok: boolean;
  lenient: boolean;
  heard: string | null;
  closest: string;
  fit: number;
  ranking: string[];
};

export type Voice = { id: string; label: string; description: string };
