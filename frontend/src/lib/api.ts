import { type Story } from "@/components/story/types";
import { getVoice } from "./api/audio";
import { answered, currentStep, notify } from "./api/events";
import { call } from "./api/transport";
import {
  type AiQuota,
  type Me,
  type Onboarding,
  type Placement,
  type PlacementResult,
  type Profile,
} from "./api/types/account";
import { type Alphabet, type CoachState, type StepState } from "./api/types/coach";
import {
  type DeepCheck,
  type Health,
  type RuleId,
  type RulePhrase,
  type Sentence,
  type SpeechResult,
  type SymbolCheck,
  type TextItem,
  type ToneRule,
} from "./api/types/content";
import { type LevelNotice, type Levels } from "./api/types/levels";
import { type Challenge, type PracticeEvent, type Stats, type Summary } from "./api/types/stats";
import { markActive, recordAttempt } from "./session";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  aiQuota: () => call<AiQuota>("/api/ai/quota", { cache: "no-store" }),
  profile: () => call<Profile>("/api/profile"),
  saveProfile: (p: Profile) => call<Profile>("/api/profile", { ...json(p), method: "PUT" }),
  me: () => call<Me>("/api/me"),
  onboard: (o: Onboarding) => call<Me>("/api/onboarding", json(o)),
  saveSettings: (s: { timezone?: string; goal_min?: number }) =>
    call<Me>("/api/settings", { ...json(s), method: "PUT" }),
  health: () => call<Health>("/api/health"),
  analyzeText: (text: string) => call<{ text: string; items: TextItem[] }>("/api/text/analyze", json({ text })),
  translate: (text: string) =>
    call<{ english: string; words: { text: string; english: string }[] }>("/api/text/translate", json({ text })),
  generate: (topic: string, level: string, count: number, useProfile = true) =>
    call<{ sentences: Sentence[] }>(
      "/api/sentences/generate",
      json({ topic, level, count, use_profile: useProfile, voice: getVoice() }),
    ),
  sentences: () => call<{ sentences: Sentence[] }>("/api/sentences"),
  sentence: (id: number) => call<Sentence>("/api/sentences/" + id),
  deleteSentence: (id: number) => call<{ ok: boolean }>("/api/sentences/" + id, { method: "DELETE" }),
  /** help: the learner used the cheat (model audio or Pinyin) on this card. tryN: 0 for the first recording of the card. */
  speech: (wav: Blob, text: string, mode = "", opts: { help?: boolean; tryN?: number } = {}) => {
    markActive();
    const f = new FormData();
    f.append("audio", wav, "speech.wav");
    f.append("text", text);
    f.append("mode", mode);
    if (opts.help) f.append("help", "1");
    if (opts.tryN) f.append("try_n", String(opts.tryN));
    const step = currentStep();
    if (step) f.append("step", String(step));
    return call<
      SpeechResult & { event_id?: number; deep_check?: "queued" | "skipped" | "off"; notices?: LevelNotice[] }
    >("/api/speech/analyze", { method: "POST", body: f }).then((r) => {
      answered();
      notify(r.notices);
      return r;
    });
  },
  /** The deep check of one answer, or null while it is still waiting in the queue. */
  deepCheck: (eventId: number) =>
    call<DeepCheck>("/api/speech/deep-check/" + eventId, { cache: "no-store" }).catch(() => null),
  /** After missed recordings of one single-syllable card: the learner typed the sound they said. A match counts the sound misses as right. */
  confirmSpeech: (event_ids: number[], typed: string) =>
    call<{ match: boolean; fixed: number; notices?: LevelNotice[] }>(
      "/api/speech/confirm",
      json({ event_ids, typed }),
    ).then((r) => {
      answered();
      notify(r.notices);
      return r;
    }),
  /** Save one graded answer with everything the learner produced. Also counts it for today's HUD. */
  event: (ev: PracticeEvent) => {
    recordAttempt(ev.area, ev.ok);
    const step = currentStep();
    const body = step ? { ...ev, details: { ...ev.details, step } } : ev;
    return call<{ ok: boolean; id?: number; notices?: LevelNotice[] }>("/api/progress/event", json(body))
      .then((r) => {
        answered();
        notify(r.notices);
        return r;
      })
      .catch(() => ({ ok: false, id: undefined }));
  },
  placement: () => call<Placement>("/api/placement", { cache: "no-store" }),
  /** Score the saved answers of the placement test (their event ids) and open the levels it proves. */
  placementFinish: (b: { alphabet_ids: number[]; voice_ids: number[]; voice_skipped: boolean }) =>
    call<{ result: PlacementResult; notices: LevelNotice[] }>("/api/placement/finish", json(b)).then((r) => {
      notify(r.notices);
      return r;
    }),
  saveDay: (day: string, seconds: number, goal_min: number) =>
    call<{ ok: boolean }>("/api/progress/day", { ...json({ day, seconds, goal_min }), method: "PUT" }).catch(() => ({
      ok: false,
    })),
  summary: () => call<Summary>("/api/progress/summary"),
  /** Past tests per item of one practice mode: [time in seconds, 1 if right on the first try without help], oldest first. */
  memory: (area: string, mode = "") =>
    call<{ now: number; items: Record<string, [number, number][]> }>(
      "/api/progress/memory?area=" + area + (mode ? "&mode=" + mode : ""),
      { cache: "no-store" },
    ),
  stats: (days: number, area = "") => call<Stats>("/api/stats?days=" + days + (area ? "&area=" + area : "")),
  challenges: () => call<{ challenges: Challenge[] }>("/api/stats/challenges"),
  coach: () => call<CoachState>("/api/coach"),
  /** The level path: levels, goals, stars, drops, and unseen messages. Also saves new unlocks. */
  levels: () => call<Levels>("/api/levels", { cache: "no-store" }),
  levelsSeen: (ids: number[]) => call<{ ok: boolean }>("/api/levels/seen", json({ ids })).catch(() => ({ ok: false })),
  /** Which of the 37 symbols the learner knows. Read only, so the Symbols screen can load it on every visit. */
  alphabet: () => call<Alphabet>("/api/alphabet"),
  /** The tone change rules and the phrases of the rule exercises. */
  rules: () => call<{ rules: Record<RuleId, ToneRule>; phrases: RulePhrase[] }>("/api/rules"),
  coachPlan: (reason = "") => call<CoachState>("/api/coach/plan", json({ reason })),
  skipStep: (id: number, reason: "too_hard" | "too_easy" | "not_now") =>
    call<CoachState>("/api/coach/step/" + id + "/skip", json({ reason })),
  coachStep: (id: number) => call<StepState>("/api/coach/step/" + id),
  coachStory: (planId: number) => call<Story>("/api/coach/plan/" + planId + "/story"),
  writeStory: (planId: number) => call<CoachState>("/api/coach/plan/" + planId + "/story", { method: "POST" }),
  checkSymbol: (wav: Blob, symbol: string) => {
    markActive();
    const f = new FormData();
    f.append("audio", wav, "symbol.wav");
    f.append("symbol", symbol);
    return call<SymbolCheck>("/api/symbols/check", { method: "POST", body: f });
  },
};

// Public entry point. Keep existing consumers on one stable import path.
export { clearAudioCache, getVoice, playableSrc, setVoice, ttsUrl, voices } from "./api/audio";
export { AI_QUOTA_EVENT, currentStep, publishAiQuota } from "./api/events";
export { downloadExport } from "./api/export";
export { apiBase, setTokenGetter } from "./api/transport";
export type * from "./api/types/account";
export type * from "./api/types/coach";
export type * from "./api/types/content";
export type * from "./api/types/levels";
export type * from "./api/types/stats";
