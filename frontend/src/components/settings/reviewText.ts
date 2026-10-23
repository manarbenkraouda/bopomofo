// The words of the card order settings (components/settings/ReviewSettings.tsx): a plain name, what the setting
// does, a short example with the value the learner picked, and the label of each value. Keep them free of
// technical words: the learner should understand each one on first read.
import {
  MISS_TO_START,
  repeatGap,
  type ReviewConfig,
  type ReviewKey,
  RUN_NO_LIMIT,
  SKIP_NEVER,
  WAIT_NO_LIMIT,
  waitDays,
  type ExerciseKey,
} from "@/lib/reviewSettings";

export type ReviewText = {
  title: string;
  what: string;
  /** A short example with the current settings. */
  example: (c: ReviewConfig) => string;
  /** The label of one value. */
  label: (v: number) => string;
  /** The words at the two ends of the slider. */
  ends: [string, string];
};

const plural = (n: number, one: string, many = one + "s") => n + " " + (n === 1 ? one : many);
const cards = (n: number) => (n === 0 ? "right away" : "after " + plural(n, "other card"));

/** A wait in days, in words: "10 minutes", "3 days", "4 months", "2 years". */
export function waitWords(days: number) {
  if (!Number.isFinite(days)) return "no limit";
  if (days <= 0) return "right away";
  const minutes = Math.round(days * 1440);
  if (minutes < 60) return plural(Math.max(1, minutes), "minute");
  if (days < 1) return plural(Math.round(days * 24), "hour");
  if (days < 60) return plural(Math.round(days), "day");
  if (days < 730) return plural(Math.round(days / 30), "month");
  return plural(Math.round((days / 365) * 10) / 10, "year");
}

export const REVIEW_TEXT: Record<ReviewKey, ReviewText> = {
  newAtOnce: {
    title: "New items at a time",
    what: "How many new things you learn together before new ones come in. Fewer means each one comes back more often and sticks faster. More means you see more variety, but each one comes back less often.",
    example: (c) =>
      c.newAtOnce === 0
        ? "Every item is in play. New items keep coming in between the repeats, so you go through the whole set."
        : c.newAtOnce === 1
          ? "You learn one symbol at a time: it comes back until you know it, then the next one comes in."
          : "You learn " + c.newAtOnce + " symbols together. A new one comes in only when you know one of them.",
    label: (v) => (v === 0 ? "No limit" : String(v)),
    ends: ["No limit", "100"],
  },
  rightToLearn: {
    title: "Right answers to learn a new item",
    what: "How many times in a row you must get a new item right before it counts as learned for today. After that, it comes back on a later day.",
    example: (c) =>
      c.rightToLearn === 0
        ? "Each new item comes only once per session, right or wrong."
        : c.rightToLearn === 1
          ? "One right answer is enough. A wrong answer brings the item back."
          : "Get it right " + c.rightToLearn + " times in a row. A wrong answer starts the count again.",
    label: (v) => (v === 0 ? "Once is enough" : plural(v, "time")),
    ends: ["Show once", "20 times"],
  },
  repeatSpacing: {
    title: "Space between repeats",
    what: "After a right answer, an item you are learning waits for some other cards before it comes back. Each right answer makes the wait longer. This slider makes all these waits shorter or longer.",
    example: (c) =>
      c.repeatSpacing === 0
        ? "A right answer brings the item back as the very next card."
        : "After 1 right answer, the item comes back " +
          cards(repeatGap(1, c)) +
          ". After 2, it comes back " +
          cards(repeatGap(2, c)) +
          ".",
    label: (v) => (v === 0 ? "None" : "× " + v),
    ends: ["None", "× 10"],
  },
  missGap: {
    title: "Wait after a mistake",
    what: "How many other cards come before an item you got wrong comes back. If you miss it again and again, the wait grows a little, so one hard item does not take every other card.",
    example: (c) =>
      "Miss an item and it comes back " +
      cards(c.missGap) +
      ". Miss it 3 times in a row and it comes back " +
      cards(c.missGap + 4) +
      ".",
    label: (v) => (v === 0 ? "Right away" : plural(v, "card")),
    ends: ["Right away", "50 cards"],
  },
  skipGap: {
    title: "Wait after you skip a card",
    what: "When you go to the next card without an answer, the card comes back later. Nothing is counted against you.",
    example: (c) =>
      c.skipGap >= SKIP_NEVER
        ? "A skipped card does not come back in this session, unless it is the only one left."
        : "A skipped card comes back " + cards(c.skipGap) + ".",
    label: (v) => (v >= SKIP_NEVER ? "Not this session" : v === 0 ? "Right away" : plural(v, "card")),
    ends: ["Right away", "Not this session"],
  },
  reviewTiming: {
    title: "Days between reviews",
    what: "Things you know come back on later days, so you do not forget them. Each time you remember one, it waits longer. This slider makes all these waits shorter (more reviews) or longer (fewer reviews). The change also applies to everything you learned before.",
    example: (c) =>
      c.reviewTiming === 0
        ? "Everything you know is always due: every session reviews all of it."
        : "A new item comes back after " +
          waitWords(waitDays(1, c)) +
          ", then " +
          waitWords(waitDays(2, c)) +
          ", " +
          waitWords(waitDays(3, c)) +
          ", " +
          waitWords(waitDays(4, c)) +
          ", " +
          waitWords(waitDays(5, c)) +
          "…",
    label: (v) => (v === 0 ? "Always due" : "× " + v),
    ends: ["Always due", "× 10"],
  },
  longestWait: {
    title: "Longest wait between reviews",
    what: "Even items you know very well come back at least this often.",
    example: (c) =>
      c.longestWait >= WAIT_NO_LIMIT
        ? "The waits keep growing: an item you know very well may not come back for years."
        : "Every item you know comes back at least every " + waitWords(c.longestWait) + ".",
    label: (v) => (v >= WAIT_NO_LIMIT ? "No limit" : waitWords(v)),
    ends: ["1 day", "No limit"],
  },
  missCost: {
    title: "What a mistake costs",
    what: "When you get a review wrong, the item comes back sooner. This sets how much sooner: a few steps back on the ladder of waits, or back to the start.",
    example: (c) =>
      c.missCost === 0
        ? "A mistake changes nothing: the item keeps its wait."
        : c.missCost >= MISS_TO_START
          ? "One mistake and the item starts over, like a new item."
          : "An item that waited " +
            waitWords(waitDays(6, c)) +
            " comes back after " +
            waitWords(waitDays(Math.max(0, 6 - c.missCost), c)) +
            " after a mistake.",
    label: (v) => (v === 0 ? "Nothing" : v >= MISS_TO_START ? "Start over" : plural(v, "step") + " back"),
    ends: ["Nothing", "Start over"],
  },
  earlyCredit: {
    title: "Credit for early reviews",
    what: "If you practice an item before its review day and get it right, should it wait longer next time? This sets how much of the wait must pass first.",
    example: (c) =>
      c.earlyCredit === 0
        ? "Every right answer makes the next wait longer, even one minute later."
        : c.earlyCredit >= 100
          ? "Only a right answer on or after the review day makes the next wait longer."
          : "An item due in 10 days gets a longer wait if you get it right after " +
            waitWords((10 * c.earlyCredit) / 100) +
            " or more.",
    label: (v) => (v === 0 ? "Any time" : v >= 100 ? "Only when due" : v + "% of the wait"),
    ends: ["Any time", "Only when due"],
  },
  focusMix: {
    title: "Other items during a focus",
    what: "When you train a few chosen items (a coach step or a Train link), some cards come from the other items, so you do not see the same 2 or 3 things again and again.",
    example: (c) =>
      c.focusMix === 0
        ? "Every card comes from the chosen items."
        : c.focusMix >= 100
          ? "Every card comes from the other items."
          : "About " + Math.round(c.focusMix / 10) + " cards in 10 come from the other items.",
    label: (v) => v + "%",
    ends: ["None", "All"],
  },
  normalMix: {
    title: "Quick checks of older items",
    what: "In normal practice, some repeats are replaced by an older item you already met, as a quick check. Mixing items helps memory.",
    example: (c) =>
      c.normalMix === 0
        ? "No quick checks: repeats stay on the items you are learning."
        : "About " + Math.round(c.normalMix / 10) + " repeats in 10 become a quick check of an older item.",
    label: (v) => v + "%",
    ends: ["None", "All"],
  },
  hardRun: {
    title: "Hard cards in a row",
    what: "The most cards in a row from your hard items (items you missed today, or the items of a focus). After that, an easier card gives you a break.",
    example: (c) =>
      c.hardRun >= RUN_NO_LIMIT
        ? "No limit: hard cards can come one after another."
        : c.hardRun === 1
          ? "After every hard card, an easier card comes."
          : "After " + c.hardRun + " hard cards in a row, an easier card comes.",
    label: (v) => (v >= RUN_NO_LIMIT ? "No limit" : String(v)),
    ends: ["1", "No limit"],
  },
  repeatGuard: {
    title: "Variety guard",
    what: "Makes sure your recent cards are not always the same few items. If they are, the next card is a different item.",
    example: (c) =>
      c.repeatGuard === 0
        ? "Off: the same few items can fill your session."
        : "Your last " + 2 * c.repeatGuard + " cards always hold at least " + c.repeatGuard + " different items.",
    label: (v) => (v === 0 ? "Off" : v + " items"),
    ends: ["Off", "20 items"],
  },
  passScore: {
    title: "Score to pass (speaking)",
    what: "When you say something aloud, the app gives a score out of 100. This is the score you need for the card to count as right.",
    example: (c) =>
      c.passScore === 0
        ? "Every recording counts as right."
        : "A recording that scores " + c.passScore + " or more counts as right.",
    label: (v) => v + " / 100",
    ends: ["0", "100"],
  },
  helpCounts: {
    title: "Count answers with help",
    what: "If you used a hint, showed the answer, or heard it first, and then got it right, should it count as right?",
    example: (c) =>
      c.helpCounts
        ? "A right answer with help counts as right."
        : "A right answer with help counts as a miss, so the item comes back soon.",
    label: (v) => (v ? "Yes" : "No"),
    ends: ["No", "Yes"],
  },
  newOrder: {
    title: "Order of new items",
    what: "The order in which new items come in.",
    example: (c) =>
      c.newOrder === 1
        ? "New items come in the order of the course (for symbols: the alphabet order)."
        : c.newOrder === 2
          ? "New items come in a random order."
          : "Each exercise uses its usual order: the alphabet order for symbols, a mix for words and sentences.",
    label: (v) => (v === 1 ? "Course order" : v === 2 ? "Random" : "Usual"),
    ends: ["Usual", "Random"],
  },
};

/** The settings shown first. The others are under "More settings". */
export const MAIN_KEYS: ReviewKey[] = ["newAtOnce", "repeatSpacing", "reviewTiming", "missCost"];
export const MORE_KEYS: ReviewKey[] = [
  "rightToLearn",
  "missGap",
  "skipGap",
  "longestWait",
  "earlyCredit",
  "focusMix",
  "normalMix",
  "hardRun",
  "repeatGuard",
  "helpCounts",
  "newOrder",
  "passScore",
];

export const EXERCISE_NAMES: Record<ExerciseKey, string> = {
  reading: "Reading",
  recognize: "Recognize",
  writing: "Writing",
  dictation: "Dictation",
  listening: "Listening",
  rules: "Tone rules",
  speaking: "Speaking",
};
