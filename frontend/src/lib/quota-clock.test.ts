import { describe, expect, test } from "bun:test";
import { quotaCountdown, quotaSeconds } from "./quota-clock";
import type { AiQuota } from "./api";

const quota = { server_now: 1000, resets_at: 4600 } as AiQuota;

describe("AI refill clock", () => {
  test("uses elapsed time from the server snapshot", () => {
    expect(quotaSeconds(quota)).toBe(3600);
    expect(quotaSeconds(quota, 1000)).toBe(3599);
    expect(quotaSeconds(quota, 3_600_000)).toBe(0);
    expect(quotaSeconds(quota, 9_000_000)).toBe(0); // resume from sleep; never a negative timer
  });
  test("shows hours, minutes, and seconds, including a 25-hour daylight-saving day", () => {
    expect(quotaCountdown(0)).toBe("00:00:00");
    expect(quotaCountdown(3661)).toBe("01:01:01");
    expect(quotaCountdown(25 * 3600)).toBe("25:00:00");
  });
});
