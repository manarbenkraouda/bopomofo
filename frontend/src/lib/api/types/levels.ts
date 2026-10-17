import { type StepType } from "./coach";

/** A level message: a new level or new symbols ("unlock"), a known item that dropped ("drop"), or one that came back ("back"). */
export type LevelNotice = {
  id: number;
  ts: number;
  kind: "unlock" | "drop" | "back";
  key: string;
  title: string;
  text: string;
};

export type LevelGoal = {
  key: string;
  label: string;
  modes: string[];
  need: number;
  of: number;
  done: number;
  accurate: number;
  seen: number;
  met: boolean;
  missing: string[];
};

export type LevelInfo = {
  n: number;
  key: string;
  title: string;
  about: string;
  unlocked: boolean;
  unlocked_ts: number | null;
  /** Its exercises are open: the learner reached the level, or opened it in Settings. */
  open: boolean;
  current: boolean;
  opens: { key: string; label: string; href: string }[];
  goals: LevelGoal[];
  progress: number;
};

/** Stars of one item in one exercise: 1 seen, 2 accurate, 3 known (accurate, fast, on more than one day). */
export type ItemStars = {
  stars: 0 | 1 | 2 | 3;
  tests: number;
  acc: number | null;
  ms: number | null;
  days: number;
  reps: number;
  dropped: boolean;
};

export type Levels = {
  /** The level reached with the goals. */
  level: number;
  title: string;
  max_level: number;
  /** The highest level with open exercises: level, or higher when the learner opened more levels in Settings. */
  open_level: number;
  levels: LevelInfo[];
  chapters: { key: string; title: string; symbols: string; open: boolean; accurate: number; of: number }[];
  /** Exercise keys the learner has unlocked, for example "reading" or "listening/tone". */
  exercises: string[];
  symbols: string;
  step_types: StepType[];
  next: LevelInfo | null;
  drops: { exercise: string; item: string; dropped_ts: number }[];
  stars: Record<string, Record<string, ItemStars>>;
  notices: LevelNotice[];
  rules: {
    learn_reps: number;
    min_days: number;
    drop_acc: number;
    placement: boolean;
    speed_ms: Record<string, number>;
    days: Record<string, number>;
    min_acc: Record<string, number>;
    window: Record<string, number>;
    min_tests: Record<string, number>;
  };
};
