import { type AiQuota } from "./account";
import { type RuleId } from "./content";
import { type Levels } from "./levels";

export type StepType =
  | "speak_sentences"
  | "speak_sounds"
  | "listen_tones"
  | "listen_sounds"
  | "read_symbols"
  | "recognize_symbols"
  | "write_symbols"
  | "write_syllables"
  | "tone_rules"
  | "numbers";

export type CoachNote = { kind: string; text: string; ts: number };

export type CoachStep = {
  id: number;
  plan_id: number;
  pos: number;
  type: StepType;
  title: string;
  why: string;
  target: number;
  minutes: number;
  status: "open" | "done" | "skipped";
  skip_reason: string | null;
  done_ts: number | null;
  area: string;
  href: string;
  params: {
    tones?: number[];
    syms?: string[];
    unit?: string;
    source?: string;
    deck?: string[];
    deck_why?: string;
    ids?: number[];
    texts?: string[];
    reps?: number;
    min_score?: number;
    focus?: { tones: number[]; pairs: string[]; syms: string[] };
    written?: number;
    rules?: RuleId[];
    mode?: "quiz" | "speak" | "listen";
    bands?: string[];
    nums?: number[];
    learn?: boolean;
  };
  finding_ids: string[];
  review: string;
  note: CoachNote | null;
  progress: number;
  tried: number;
  right: number;
  items?: { text: string; passes: number; tries: number; best: number | null; last: number | null }[];
};

export type Finding = {
  id: string;
  domain: string;
  area: string;
  items: string[];
  problem: string;
  context: string;
  severity: number;
  confidence: number;
  drill: string;
};

export type Milestone = {
  id: number;
  ts: number;
  title: string;
  why: string;
  status: "active" | "achieved";
  done_ts: number | null;
  criterion: { area: string; unit: string; expected: string[]; min_acc: number; window: number };
  n: number;
  value: number | null;
  reached: boolean;
};

export type CoachState = {
  ai_quota: AiQuota;
  /** The level path, without the stars per item (GET /api/levels has them). */
  levels: Omit<Levels, "stars">;
  generating: boolean;
  stage: string;
  building_next: boolean;
  error: string | null;
  started: number;
  next_ready: boolean;
  coach_model: string;
  /** The plan whose story is being written now, or null. */
  writing_story: number | null;
  alphabet: {
    known_count: number;
    known: string;
    learning: string;
    new: string;
    next_group: string[];
    gate: boolean;
    learn_reps: number;
    symbols: {
      sym: string;
      state: "known" | "learning" | "new";
      phase: "known" | "recall" | "repeat";
      answers: number;
      right: number;
      reps: number;
      say?: string;
      type?: string;
      write?: string;
      pick?: string;
    }[];
  };
  usage: { calls: number; cost: number; today_calls: number; today_cost: number };
  plan: null | {
    id: number;
    ts: number;
    status: string;
    source: "llm" | "rules";
    model: string | null;
    diagnosis: string;
    reason: string;
    error: string | null;
    done_ts: number | null;
    /** At most 2 short sentences, no numbers: the top of the Coach page. The story has the evidence. */
    headline: string | null;
    has_story: boolean;
    new_answers: number;
    stale: boolean;
    findings: Finding[];
    strengths: string[];
    unknown: string[];
    too_advanced: string[];
    pace: { plan_minutes: number; target_scale: number; steps: number; notes: string; avoid: string[] } | null;
    calls: {
      count: number;
      build_count: number;
      failed: number;
      cost: number;
      tokens: number;
      seconds: number | null;
      models: Record<string, number>;
      stages: Record<string, number>;
    };
  };
  steps: CoachStep[];
  milestones: Milestone[];
  notes: { id: number; ts: number; step_id: number | null; kind: string; text: string }[];
  history: {
    id: number;
    ts: number;
    status: string;
    source: string;
    diagnosis: string;
    headline: string | null;
    done_ts: number | null;
    steps: number;
    done: number;
    skipped: number;
  }[];
};

export type StepState = {
  step: CoachStep;
  plan: { id: number; status: string };
  count: number;
  done: number;
  next: CoachStep | null;
  generating: boolean;
  stage: string;
};

export type Alphabet = CoachState["alphabet"];

export type AlphabetSymbol = Alphabet["symbols"][number];
