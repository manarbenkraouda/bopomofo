import type { AiQuota } from "./api";

/** Use the server snapshot and elapsed time, so a wrong device clock cannot unlock AI work early. */
export function quotaSeconds(quota: AiQuota, elapsedMs = 0): number {
  return Math.max(0, Math.ceil(quota.resets_at - quota.server_now - Math.max(0, elapsedMs) / 1000));
}

export function quotaCountdown(seconds: number): string {
  const n = Math.max(0, Math.ceil(seconds));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((x) => String(x).padStart(2, "0")).join(":");
}
