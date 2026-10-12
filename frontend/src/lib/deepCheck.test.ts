import { describe, expect, test } from "bun:test";
import { correctedScore, pollDeepCheck } from "./deepCheck";
import type { DeepCheck } from "./api";

const done = (x: Partial<DeepCheck>): DeepCheck => ({ status: "done", verdict: "false_miss", applied: true, score_after: 100, notice_id: 7, ...x });
const now = () => Promise.resolve();

describe("deep check polling", () => {
  test("returns the result when it is ready", async () => {
    let calls = 0;
    const d = await pollDeepCheck(async () => (++calls < 3 ? null : done({})), () => true, now);
    expect(d?.verdict).toBe("false_miss");
    expect(calls).toBe(3);
  });
  test("stops after 8 tries", async () => {
    let calls = 0;
    expect(await pollDeepCheck(async () => { calls++; return null; }, () => true, now)).toBeNull();
    expect(calls).toBe(8);
  });
  test("stops when the card changes", async () => {
    let calls = 0;
    let card = "a";
    const d = await pollDeepCheck(async () => { calls++; card = "b"; return null; }, () => card === "a", now);
    expect(d).toBeNull();
    expect(calls).toBe(1);
    // A result that comes back after the card changed is dropped too.
    card = "a";
    expect(await pollDeepCheck(async () => { card = "b"; return done({}); }, () => card === "a", now)).toBeNull();
  });
});

describe("the note on the card", () => {
  test("only for an applied false miss", () => {
    expect(correctedScore(done({ score_after: 88.6 }))).toBe(89);
    expect(correctedScore(done({ applied: false }))).toBeNull(); // shadow mode
    expect(correctedScore(done({ verdict: "partial" }))).toBeNull();
    expect(correctedScore(done({ verdict: "real_miss" }))).toBeNull();
    expect(correctedScore(null)).toBeNull();
  });
});
