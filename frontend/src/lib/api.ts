import { markActive, recordAttempt } from "./session";
import type { Story } from "@/components/story/types";

export type Syl = {
  type: "syllable"; char: string; zhuyin: string; initial: string; final: string;
  tone: number; surface_tone: number; pinyin: string; alt_tones: number[];
};
export type TextItem = Syl | { type: "text"; text: string };
/** practice: how often the sentence was said aloud (Speaking), with the best and last score. Null when never said. */
export type Sentence = { id: number; hanzi: string; english: string; words: { text: string; english: string }[]; topic: string; level: string; created: number; items: TextItem[];
  practice?: { said: number; best: number; last: number; ts: number } | null };
export type SpeechSyllable = {
  expected: Syl; heard: { initial: string | null; final: string | null; tone: number | null; zhuyin: string | null } | null;
  initial_ok: boolean | null; final_ok: boolean | null; tone_ok: boolean; messages: string[];
  model_tone?: number | null; pitch_tone?: number | null; tone_source?: "model" | "pitch" | "model+pitch"; span?: [number, number] | null; uncertain?: boolean;
};
export type SpeechResult = {
  text: string; score: number; syllables: SpeechSyllable[]; extra: { zhuyin: string; span: [number, number] }[];
  heard_raw: string; pitch: { times: number[]; semitones: (number | null)[]; ref_hz: number };
  timing: { infer_seconds: number; audio_seconds: number };
};
export type Summary = {
  areas: Record<string, { total: number; ok: number; week: number }>;
  symbols: Record<string, { n: number; err: number }>;
  symbols_by_area: Record<string, Record<string, { n: number; err: number }>>;
  tones: Record<string, { n: number; err: number }>;
  sentences: number; day_streak: number; attempts: number;
};

/** One part of an answer: what was expected and what the learner actually produced. */
export type Unit = {
  kind: "tone" | "initial" | "final" | "symbol" | "syllable" | "stroke" | "order";
  expected: string | number; actual?: string | number | null; ok?: boolean | null;
  pos?: number; try_n?: number; help?: boolean; ctx?: string; source?: string; uncertain?: boolean; extra?: Record<string, unknown>;
};
export type PracticeEvent = {
  area: "reading" | "listening" | "dictation" | "writing" | "speaking"; mode?: string; item: string; ok: boolean;
  first_try?: boolean; score?: number; ms?: number; tries?: number; help?: boolean; replays?: number;
  units: Unit[]; details?: Record<string, unknown>;
};
export type Challenge = { id: string; area: string; title: string; why: string; target: number; progress: number; done: boolean; href: string };
export type ItemStat = {
  area: string; kind: string; expected: string; n: number; ok: number; acc: number | null; post: number;
  recent: number | null; before: number | null; recent_n: number; last: string; top: [string, number][];
};
export type WeakItem = ItemStat & { label: string; verb: string; href: string };
export type Rec = { value: number; day: string } | null;
export type Totals = { cards: number; ok: number; acc: number | null; minutes: number; days: number; ms: number | null };
export type RecentEvent = {
  id: number; ts: number; area: string; mode: string | null; item: string; ok: number; score: number | null; ms: number | null;
  tries: number | null; help: number; replays: number | null;
  units: { kind: string; expected: string; actual: string | null; ok: number | null; pos: number; try_n: number; help: number; ctx: string | null }[];
};
export type Stats = {
  range: { days: number | null; since: string; area: string | null };
  overview: Totals & { prev?: Totals };
  daily: { day: string; cards: number; ok: number; minutes: number; acc: number | null; ms: number | null; areas: Record<string, [number, number]> }[];
  areas: Record<string, { n: number; ok: number; acc: number | null; first_try: number | null; help: number | null; tries: number; ms: number | null; replays: number; score: number | null; modes: Record<string, number> }>;
  confusion: { area: string; kind: string; expected: string; actual: string; n: number }[];
  expected: { area: string; kind: string; expected: string; n: number; ok: number }[];
  items: ItemStat[];
  tone_ctx: Record<"prev" | "next" | "sandhi" | "source" | "position", { k: string[]; n: number; ok: number }[]> & { uncertain: number; n: number };
  strokes: { sym: string; n: number; status: Record<string, number>; by_stroke: Record<string, Record<string, number>>; order_n: number; order_err: number; clean: number | null }[];
  hours: { hour: number; n: number; ok: number }[];
  sessions: { start: number; end: number; cards: number; ok: number; areas: Record<string, number> }[];
  recent: RecentEvent[];
  records: Record<string, Rec>;
  challenges: Challenge[];
  weak: WeakItem[];
  calendar: { day: string; minutes: number }[];
};
export type Health = { ok: boolean; speech_model: "ready" | "loading" | "error"; speech_error: string | null; llm_model: string; llm_configured: boolean; speaker_hz: number | null };

export type StepType = "speak_sentences" | "speak_sounds" | "listen_tones" | "listen_sounds" | "read_symbols" | "write_symbols" | "write_syllables";
export type CoachNote = { kind: string; text: string; ts: number };
export type CoachStep = {
  id: number; plan_id: number; pos: number; type: StepType; title: string; why: string; target: number; minutes: number;
  status: "open" | "done" | "skipped"; skip_reason: string | null; done_ts: number | null; area: string; href: string;
  params: { tones?: number[]; syms?: string[]; unit?: string; source?: string; deck?: string[]; deck_why?: string; ids?: number[]; texts?: string[];
    reps?: number; min_score?: number; focus?: { tones: number[]; pairs: string[]; syms: string[] }; written?: number };
  finding_ids: string[]; review: string; note: CoachNote | null; progress: number; tried: number; right: number;
  items?: { text: string; passes: number; tries: number; best: number | null; last: number | null }[];
};
export type Finding = { id: string; domain: string; area: string; items: string[]; problem: string; context: string; severity: number; confidence: number; drill: string };
export type Milestone = {
  id: number; ts: number; title: string; why: string; status: "active" | "achieved"; done_ts: number | null;
  criterion: { area: string; unit: string; expected: string[]; min_acc: number; window: number }; n: number; value: number | null; reached: boolean;
};
export type CoachState = {
  generating: boolean; stage: string; building_next: boolean; error: string | null; started: number; next_ready: boolean; coach_model: string;
  /** The plan whose story is being written now, or null. */
  writing_story: number | null;
  alphabet: {
    known_count: number; known: string; learning: string; new: string; next_group: string[]; gate: boolean; learn_reps: number;
    symbols: { sym: string; state: "known" | "learning" | "new"; phase: "known" | "recall" | "repeat"; answers: number; right: number; reps: number;
      say?: string; write?: string; pick?: string }[];
  };
  usage: { calls: number; cost: number; today_calls: number; today_cost: number };
  plan: null | {
    id: number; ts: number; status: string; source: "llm" | "rules"; model: string | null; diagnosis: string; reason: string; error: string | null; done_ts: number | null;
    /** At most 2 short sentences, no numbers: the top of the Coach page. The story has the evidence. */
    headline: string | null; has_story: boolean;
    new_answers: number; stale: boolean; findings: Finding[]; strengths: string[]; unknown: string[]; too_advanced: string[];
    pace: { plan_minutes: number; target_scale: number; steps: number; notes: string; avoid: string[] } | null;
    calls: { count: number; build_count: number; failed: number; cost: number; tokens: number; seconds: number | null; models: Record<string, number>; stages: Record<string, number> };
  };
  steps: CoachStep[]; milestones: Milestone[]; notes: { id: number; ts: number; step_id: number | null; kind: string; text: string }[];
  history: { id: number; ts: number; status: string; source: string; diagnosis: string; headline: string | null; done_ts: number | null; steps: number; done: number; skipped: number }[];
};
export type StepState = { step: CoachStep; plan: { id: number; status: string }; count: number; done: number; next: CoachStep | null; generating: boolean; stage: string };
export type Alphabet = CoachState["alphabet"];
export type AlphabetSymbol = Alphabet["symbols"][number];

/** The coach step of the current page (?step=12). Answers given on that page count for the step. */
export const currentStep = () => {
  if (typeof window === "undefined") return null;
  const s = Number(new URLSearchParams(window.location.search).get("step"));
  return s > 0 ? s : null;
};
/** Tells the step banner that an answer was saved, so it can show the new progress. */
const answered = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("zs:answered")); };

export type Profile = Record<string, string>;

export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://127.0.0.1:8765";
  return window.location.protocol + "//" + window.location.hostname + ":8765";
}

// Messages the learner can read as they are. Every other error gets a short, friendly message.
const SAFE_DETAIL = /^(The recording is|The target text has|Text must be|This plan has no story)/;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(apiBase() + path, init);
  } catch {
    throw new Error("Can't connect right now. Please try again in a moment.");
  }
  if (!r.ok) {
    let detail = "";
    try { const j = await r.json(); if (typeof j.detail === "string") detail = j.detail; } catch {}
    const msg = SAFE_DETAIL.test(detail) ? detail
      : r.status === 503 ? "The speech check is getting ready. Try again in a few seconds."
      : "Something went wrong. Please try again in a moment.";
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  profile: () => call<Profile>("/api/profile"),
  saveProfile: (p: Profile) => call<Profile>("/api/profile", { ...json(p), method: "PUT" }),
  health: () => call<Health>("/api/health"),
  analyzeText: (text: string) => call<{ text: string; items: TextItem[] }>("/api/text/analyze", json({ text })),
  translate: (text: string) => call<{ english: string; words: { text: string; english: string }[] }>("/api/text/translate", json({ text })),
  generate: (topic: string, level: string, count: number, useProfile = true) => call<{ sentences: Sentence[] }>("/api/sentences/generate", json({ topic, level, count, use_profile: useProfile, voice: getVoice() })),
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
    return call<SpeechResult>("/api/speech/analyze", { method: "POST", body: f }).then((r) => { answered(); return r; });
  },
  /** Save one graded answer with everything the learner produced. Also counts it for today's HUD. */
  event: (ev: PracticeEvent) => {
    recordAttempt(ev.area, ev.ok);
    const step = currentStep();
    const body = step ? { ...ev, details: { ...ev.details, step } } : ev;
    return call<{ ok: boolean }>("/api/progress/event", json(body)).then((r) => { answered(); return r; }).catch(() => ({ ok: false }));
  },
  saveDay: (day: string, seconds: number, goal_min: number) =>
    call<{ ok: boolean }>("/api/progress/day", { ...json({ day, seconds, goal_min }), method: "PUT" }).catch(() => ({ ok: false })),
  summary: () => call<Summary>("/api/progress/summary"),
  stats: (days: number, area = "") => call<Stats>("/api/stats?days=" + days + (area ? "&area=" + area : "")),
  challenges: () => call<{ challenges: Challenge[] }>("/api/stats/challenges"),
  coach: () => call<CoachState>("/api/coach"),
  /** Which of the 37 symbols the learner knows. Read only, so the Symbols screen can load it on every visit. */
  alphabet: () => call<Alphabet>("/api/alphabet"),
  coachPlan: (reason = "") => call<CoachState>("/api/coach/plan", json({ reason })),
  skipStep: (id: number, reason: "too_hard" | "too_easy" | "not_now") => call<CoachState>("/api/coach/step/" + id + "/skip", json({ reason })),
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

export type SymbolCheck = { target: string; ok: boolean; lenient: boolean; heard: string | null; closest: string; fit: number; ranking: string[] };

export type Voice = { id: string; label: string; description: string };

const VOICE_KEY = "zhuyin.voice";
export const getVoice = () => (typeof window === "undefined" ? "" : localStorage.getItem(VOICE_KEY) ?? "");
export const setVoice = (id: string) => localStorage.setItem(VOICE_KEY, id);
export const voices = () => call<{ default: string; voices: Voice[] }>("/api/tts/voices");

// Bumped by "Clear audio cache" so the browser cannot replay its own cached copy of an old clip.
const AUDIO_V_KEY = "zhuyin.audioVersion";
const audioVersion = () => (typeof window === "undefined" ? "" : localStorage.getItem(AUDIO_V_KEY) ?? "");
export const clearAudioCache = async () => {
  const r = await call<{ files: number; bytes: number }>("/api/tts/cache/clear", { method: "POST" });
  localStorage.setItem(AUDIO_V_KEY, String(Date.now()));
  return r;
};

export const ttsUrl = (text: string, rate = 0, voice = getVoice()) =>
  apiBase() + "/api/tts?text=" + encodeURIComponent(text) + "&rate=" + rate + (voice ? "&voice=" + encodeURIComponent(voice) : "") + (audioVersion() ? "&v=" + audioVersion() : "");

export const exportUrl = () => apiBase() + "/api/stats/export.csv";
