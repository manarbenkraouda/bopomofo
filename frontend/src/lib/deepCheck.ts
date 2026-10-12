import type { DeepCheck } from "./api";

/** The deep check of a missed answer runs after it on the server: ask every 2 s, at most 8 times. */
export const DEEP_POLL_MS = 2000;
export const DEEP_POLLS = 8;

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** Ask for the deep check until it is ready. Stops early, with null, as soon as still() is false (the card changed). */
export async function pollDeepCheck(get: () => Promise<DeepCheck | null>, still: () => boolean,
  wait: (ms: number) => Promise<void> = sleep, polls = DEEP_POLLS, ms = DEEP_POLL_MS): Promise<DeepCheck | null> {
  for (let i = 0; i < polls; i++) {
    await wait(ms);
    if (!still()) return null;
    const d = await get();
    if (!still()) return null;
    if (d) return d;
  }
  return null;
}

/** The new score to show on the card: only for a miss the deep check corrected. Partial and real misses, and the
 *  shadow mode (not applied), show nothing. */
export function correctedScore(d: DeepCheck | null): number | null {
  return d && d.applied && d.verdict === "false_miss" && d.score_after != null ? Math.round(d.score_after) : null;
}
