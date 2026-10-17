import { type TextItem } from "./content";

export type Profile = Record<string, string>;

export type Reason = "travel" | "family" | "live" | "work" | "culture" | "fun";

export type Level = "new" | "words" | "everyday" | "fluent";

export type BopomofoLevel = "none" | "some" | "reads";

/** The signed-in learner: settings, and whether the onboarding is done. */
export type Me = {
  onboarded: boolean;
  timezone: string;
  timezone_set: boolean;
  goal_min: number | null;
  level: Level | null;
  bopomofo: BopomofoLevel | null;
  reasons: Reason[];
  sentence_level: "beginner" | "intermediate" | "advanced";
  name: string;
  /** The placement test after the onboarding: "due" for the everyday and fluent levels until it is done. */
  placement: "none" | "due" | "done";
  /** Exercises are open up to this level, chosen in Settings. 1 follows the progress only. */
  open_level: number;
};

export type Onboarding = {
  name: string;
  reasons: Reason[];
  level: Level;
  bopomofo: BopomofoLevel;
  goal_min: number;
  timezone: string;
};

/** One voice part of the placement test: cards recorded, the symbols and tones it proves (more often right than wrong), symbols missed. */
export type PlacementVoice = { cards: number; symbols: string; tones: number[]; missed: string[] };

export type PlacementResult = {
  level: number;
  title: string;
  alphabet_known: boolean;
  syllables_ok: boolean;
  sentences_ok: boolean;
  chapters: boolean;
  alphabet: { right: number; of: number; asked: number; known: string } | null;
  syllables: PlacementVoice;
  sentences: PlacementVoice;
  voice_skipped: boolean;
  ts: number;
};

/** What the placement test asks. alphabet: false when the learner said they do not know Bopomofo yet (no alphabet part). */
export type Placement = {
  status: "none" | "due" | "done";
  alphabet: boolean;
  symbols: string;
  syllables: { text: string; items: TextItem[] }[];
  sentences: { text: string; english: string; items: TextItem[] }[];
  result: PlacementResult | null;
};

export type AiQuota = {
  user_id: string;
  blocked: boolean;
  calls: number;
  call_limit: number;
  cost: number;
  cost_limit: number;
  remaining_percent: number;
  server_now: number;
  period_started_at: number;
  resets_at: number;
  timezone: string;
};
