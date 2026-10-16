import { type AiQuota } from "./types/account";
import { type LevelNotice } from "./types/levels";

/** The coach step of the current page (?step=12). Answers given on that page count for the step. */
export const currentStep = () => {
  if (typeof window === "undefined") return null;
  const s = Number(new URLSearchParams(window.location.search).get("step"));
  return s > 0 ? s : null;
};

/** Tells the step banner that an answer was saved, so it can show the new progress. */
export const answered = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("zs:answered"));
};

/** Tells the app shell about new level messages, so it can show them at once. */
export const notify = (notices?: LevelNotice[]) => {
  if (typeof window !== "undefined" && notices?.length)
    window.dispatchEvent(new CustomEvent<LevelNotice[]>("zs:levels", { detail: notices }));
};

export const AI_QUOTA_EVENT = "zs:ai-quota";

export function publishAiQuota(quota: AiQuota) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AI_QUOTA_EVENT, { detail: quota }));
}
