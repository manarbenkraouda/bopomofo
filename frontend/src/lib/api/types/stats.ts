import { type RuleStat } from "./content";
import { type Levels } from "./levels";

export type Summary = {
  areas: Record<string, { total: number; ok: number; week: number }>;
  symbols: Record<string, { n: number; err: number }>;
  symbols_by_area: Record<string, Record<string, { n: number; err: number }>>;
  tones: Record<string, { n: number; err: number }>;
  sentences: number;
  day_streak: number;
  attempts: number;
};

/** One part of an answer: what was expected and what the learner actually produced. */
export type Unit = {
  kind: "tone" | "initial" | "final" | "symbol" | "syllable" | "stroke" | "order" | "sandhi";
  expected: string | number;
  actual?: string | number | null;
  ok?: boolean | null;
  pos?: number;
  try_n?: number;
  help?: boolean;
  ctx?: string;
  lex?: string | number;
  source?: string;
  uncertain?: boolean;
  extra?: Record<string, unknown>;
};

export type PracticeEvent = {
  area: "reading" | "recognize" | "listening" | "dictation" | "writing" | "speaking";
  mode?: string;
  item: string;
  ok: boolean;
  first_try?: boolean;
  score?: number;
  ms?: number;
  tries?: number;
  help?: boolean;
  replays?: number;
  units: Unit[];
  details?: Record<string, unknown>;
};

export type Challenge = {
  id: string;
  area: string;
  title: string;
  why: string;
  target: number;
  progress: number;
  done: boolean;
  href: string;
};

export type ItemStat = {
  area: string;
  kind: string;
  expected: string;
  n: number;
  ok: number;
  acc: number | null;
  post: number;
  recent: number | null;
  before: number | null;
  recent_n: number;
  last: string;
  top: [string, number][];
};

export type WeakItem = ItemStat & { label: string; verb: string; href: string };

export type Rec = { value: number; day: string } | null;

export type Totals = {
  cards: number;
  ok: number;
  acc: number | null;
  minutes: number;
  days: number;
  ms: number | null;
};

export type RecentEvent = {
  id: number;
  ts: number;
  area: string;
  mode: string | null;
  item: string;
  ok: number;
  score: number | null;
  ms: number | null;
  tries: number | null;
  help: number;
  replays: number | null;
  units: {
    kind: string;
    expected: string;
    actual: string | null;
    ok: number | null;
    pos: number;
    try_n: number;
    help: number;
    ctx: string | null;
  }[];
};

export type Stats = {
  range: { days: number | null; since: string; area: string | null };
  overview: Totals & { prev?: Totals };
  daily: {
    day: string;
    cards: number;
    ok: number;
    minutes: number;
    acc: number | null;
    ms: number | null;
    areas: Record<string, [number, number]>;
  }[];
  areas: Record<
    string,
    {
      n: number;
      ok: number;
      acc: number | null;
      first_try: number | null;
      help: number | null;
      tries: number;
      ms: number | null;
      replays: number;
      score: number | null;
      modes: Record<string, number>;
    }
  >;
  confusion: { area: string; kind: string; expected: string; actual: string; n: number }[];
  expected: { area: string; kind: string; expected: string; n: number; ok: number }[];
  items: ItemStat[];
  tone_ctx: Record<"prev" | "next" | "sandhi" | "source" | "position", { k: string[]; n: number; ok: number }[]> & {
    uncertain: number;
    n: number;
  };
  strokes: {
    sym: string;
    n: number;
    status: Record<string, number>;
    by_stroke: Record<string, Record<string, number>>;
    order_n: number;
    order_err: number;
    clean: number | null;
  }[];
  hours: { hour: number; n: number; ok: number }[];
  sessions: { start: number; end: number; cards: number; ok: number; areas: Record<string, number> }[];
  recent: RecentEvent[];
  records: Record<string, Rec>;
  challenges: Challenge[];
  weak: WeakItem[];
  calendar: { day: string; minutes: number }[];
  levels: Levels;
  rules: RuleStat[];
  /** Sound pairs the speech model mixes up for this learner, as the learner confirmed by typing the Pinyin. */
  mic_pairs: MicPair[];
  /** The deep check of missed speaking answers. corrected: false misses fixed in apply mode; top_pairs: the pairs fixed most. */
  deep_check?: {
    mode: "off" | "shadow" | "apply";
    checked: number;
    false_miss: number;
    corrected: number;
    applied: number;
    top_pairs: { kind: string; expected: string; heard: string; n: number }[];
  };
};

export type MicPair = { area: string; kind: string; expected: string; heard: string; n: number; confirmed: boolean };
