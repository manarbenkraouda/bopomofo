// The learner's settings for the card order (lib/review.ts): one value per setting, the allowed steps, the defaults,
// and the waits they give. The backend checks the same keys and ranges (backend/app/learner.py, REVIEW_RANGES).
// The words the learner reads are in components/settings/reviewText.ts.
import { api } from "./api";

export type ReviewConfig = {
  /** New items learned together. 0 = no limit: every item at once. */
  newAtOnce: number;
  /** Right answers in a row before a new item leaves the working set. 0 = each new item comes once. */
  rightToLearn: number;
  /** Times the gaps after right answers (2, 5, 13... other cards). 0 = the item can come back as the next card. */
  repeatSpacing: number;
  /** Other cards before a missed item comes back. It grows by 2 for each miss in a row, twice. */
  missGap: number;
  /** Other cards before a skipped card comes back. SKIP_NEVER = not again in this session. */
  skipGap: number;
  /** Times the waits between reviews over days. 0 = every known item is always due. */
  reviewTiming: number;
  /** The longest wait between two reviews, in days. WAIT_NO_LIMIT = no limit. */
  longestWait: number;
  /** Steps a missed review goes back. MISS_TO_START = back to the start. */
  missCost: number;
  /** Percent of the wait that must pass before a right answer moves an item to a longer wait. */
  earlyCredit: number;
  /** With a focus (a coach step, a Train link): percent of the cards from the other items. */
  focusMix: number;
  /** Without a focus: percent of the repeated cards that go to an older item. */
  normalMix: number;
  /** The most hard cards in a row. RUN_NO_LIMIT = no limit. */
  hardRun: number;
  /** At least this many different items in the last 2 × this many cards. 0 = off. */
  repeatGuard: number;
  /** Speaking: the score a recording needs to count as right. */
  passScore: number;
  /** 1: a right answer with a hint or the cheat counts as right. */
  helpCounts: number;
  /** New items: 0 = the usual order of the exercise, 1 = course order, 2 = random. */
  newOrder: number;
};
export type ReviewKey = keyof ReviewConfig;

export const SKIP_NEVER = 51;
export const WAIT_NO_LIMIT = 3651;
export const MISS_TO_START = 11;
export const RUN_NO_LIMIT = 21;

/**
 * The defaults follow memory research (see lib/review.ts). newAtOnce is 0: every exercise uses its full pool of items
 * (all the words of the learner's sentences, all the symbols), so the same few items do not take every card.
 */
export const DEFAULT_REVIEW: ReviewConfig = {
  newAtOnce: 0,
  rightToLearn: 3,
  repeatSpacing: 1,
  missGap: 1,
  skipGap: 4,
  reviewTiming: 1,
  longestWait: 180,
  missCost: MISS_TO_START,
  earlyCredit: 50,
  focusMix: 30,
  normalMix: 20,
  hardRun: 4,
  repeatGuard: 4,
  passScore: 80,
  helpCounts: 0,
  newOrder: 0,
};

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Math.round((from + i * step) * 10) / 10);

/** The values a learner can pick, in slider order. The first and the last are the extremes. */
export const REVIEW_STOPS: Record<ReviewKey, number[]> = {
  newAtOnce: range(0, 100),
  rightToLearn: range(0, 20),
  repeatSpacing: range(0, 10, 0.1),
  missGap: range(0, 50),
  skipGap: range(0, SKIP_NEVER),
  reviewTiming: range(0, 10, 0.1),
  longestWait: [
    1,
    2,
    3,
    5,
    7,
    10,
    14,
    21,
    30,
    45,
    60,
    90,
    120,
    180,
    270,
    365,
    540,
    730,
    1095,
    1825,
    2555,
    3650,
    WAIT_NO_LIMIT,
  ],
  missCost: range(0, MISS_TO_START),
  earlyCredit: range(0, 100, 5),
  focusMix: range(0, 100, 5),
  normalMix: range(0, 100, 5),
  hardRun: range(1, RUN_NO_LIMIT),
  repeatGuard: range(0, 20),
  passScore: range(0, 100),
  helpCounts: [0, 1],
  newOrder: [0, 1, 2],
};

/** The exercises that use the card order. Each can change any setting for itself. */
export const REVIEW_EXERCISES = [
  "reading",
  "recognize",
  "writing",
  "dictation",
  "listening",
  "rules",
  "speaking",
] as const;
export type ExerciseKey = (typeof REVIEW_EXERCISES)[number];

/** The exercise of a practice mode (useReview's area and mode). The tone rules quiz is a listening mode with its own settings. */
export const exerciseOf = (area: string, mode = ""): ExerciseKey | undefined => {
  const key = area === "listening" && mode === "rule" ? "rules" : area;
  return (REVIEW_EXERCISES as readonly string[]).includes(key) ? (key as ExerciseKey) : undefined;
};

/** What the learner saved: the changes for all exercises, and the changes of each exercise on top of them. */
export type SavedReview = {
  all: Partial<ReviewConfig>;
  exercises: Partial<Record<ExerciseKey, Partial<ReviewConfig>>>;
};
export const EMPTY_REVIEW: SavedReview = { all: {}, exercises: {} };

const known = (part: Partial<ReviewConfig> | undefined) =>
  Object.fromEntries(
    Object.entries(part ?? {}).filter(([k, v]) => k in DEFAULT_REVIEW && typeof v === "number" && Number.isFinite(v)),
  ) as Partial<ReviewConfig>;

/** The settings one exercise uses: its own changes, else the changes for all exercises, else the defaults. */
export const resolveReview = (saved: SavedReview | undefined, exercise?: ExerciseKey): ReviewConfig => ({
  ...DEFAULT_REVIEW,
  ...known(saved?.all),
  ...(exercise ? known(saved?.exercises?.[exercise]) : {}),
});

// ---------- the waits ----------

const DAY = 86400_000;
/** The review ladder in days, at timing × 1: 10 minutes, then 1, 3, 7, 16, 35, 80, 180 days. Level 0: due at once. */
export const STEP_DAYS = [0, 10 / 1440, 1, 3, 7, 16, 35, 80, 180];
/** Above the ladder, each level waits this many times longer, up to the longest wait. */
const LADDER_GROWTH = 2.2;
const MAX_LEVEL = 40;

const baseDays = (level: number) =>
  level <= 0
    ? 0
    : level < STEP_DAYS.length
      ? STEP_DAYS[level]
      : STEP_DAYS[STEP_DAYS.length - 1] * LADDER_GROWTH ** (level - STEP_DAYS.length + 1);
const capDays = (c: ReviewConfig) => (c.longestWait >= WAIT_NO_LIMIT ? Infinity : c.longestWait);

/** The wait in days before the next review of an item at this level. */
export const waitDays = (level: number, c: ReviewConfig = DEFAULT_REVIEW) =>
  Math.min(baseDays(level) * c.reviewTiming, capDays(c));
export const intervalMs = (level: number, c: ReviewConfig = DEFAULT_REVIEW) => waitDays(level, c) * DAY;

/** The highest level: the first one that reaches the longest wait. With the defaults, level 8 (180 days). */
export function topLevel(c: ReviewConfig = DEFAULT_REVIEW) {
  const cap = capDays(c);
  for (let level = 1; level < MAX_LEVEL; level++) if (baseDays(level) * c.reviewTiming >= cap) return level;
  return MAX_LEVEL;
}

/** Other cards before a working item comes back after its k-th right answer in a row (k from 1): 2, 5, 13... at × 1. */
export const repeatGap = (k: number, c: ReviewConfig = DEFAULT_REVIEW) =>
  Math.min(1000, Math.round(c.repeatSpacing * 2 * 2.5 ** (k - 1)));

/** Other cards before a missed item comes back, after miss misses in a row (from 1): 1, 3, 5 at the default. */
export const missGapOf = (miss: number, c: ReviewConfig = DEFAULT_REVIEW) => c.missGap + 2 * Math.min(miss - 1, 2);

// ---------- the learner's saved settings ----------

let cache: Promise<SavedReview> | null = null;

/** The saved settings, read once per page load (GET /api/me). */
export function loadReviewSettings(): Promise<SavedReview> {
  cache ??= api
    .me()
    .then((m) => m.review ?? EMPTY_REVIEW)
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** Keep a change, so the practice pages opened next use it without a new request. */
export function rememberReviewSettings(saved: SavedReview) {
  cache = Promise.resolve(saved);
}
