import { markActive, recordAttempt } from "./session";
import type { Story } from "@/components/story/types";

export type Syl = {
  type: "syllable";
  char: string;
  zhuyin: string;
  initial: string;
  final: string;
  tone: number;
  surface_tone: number;
  pinyin: string;
  alt_tones: number[];
  /** The tone change rule that sets surface_tone here: "3-3", "bu" (不) or "yi" (一). */
  rule?: RuleId | null;
};
export type RuleId = "3-3" | "bu" | "yi";
export type ToneRule = { name: string; short: string; explain: string };
/** A short phrase of the tone rule exercises. target: the index of the tested syllable. changes: false when the written tone stays. */
export type RulePhrase = {
  text: string;
  english: string;
  target: number;
  rule: RuleId;
  changes: boolean;
  char: string;
  written: number;
  said: number;
  zhuyin: string;
  said_zhuyin: string;
  items: TextItem[];
};
export type RuleStat = {
  rule: RuleId;
  name: string;
  short: string;
  n: number;
  ok: number;
  acc: number | null;
  recent: number | null;
  recent_n: number;
  errors: Record<string, number>;
  literal: number;
  areas: Record<string, { n: number; ok: number; acc: number | null }>;
  chars: { char: string; n: number; ok: number }[];
  quiz_href: string;
  speak_href: string;
};
export type TextItem = Syl | { type: "text"; text: string };
/** practice: how often the sentence was said aloud (Speaking), with the best and last score. Null when never said. */
export type Sentence = {
  id: number;
  hanzi: string;
  english: string;
  words: { text: string; english: string }[];
  topic: string;
  level: string;
  created: number;
  items: TextItem[];
  practice?: { said: number; best: number; last: number; ts: number } | null;
};
export type SpeechSyllable = {
  expected: Syl;
  heard: { initial: string | null; final: string | null; tone: number | null; zhuyin: string | null } | null;
  initial_ok: boolean | null;
  final_ok: boolean | null;
  tone_ok: boolean;
  messages: string[];
  model_tone?: number | null;
  pitch_tone?: number | null;
  tone_source?: "model" | "pitch" | "model+pitch";
  span?: [number, number] | null;
  uncertain?: boolean;
  /** The tone rule this syllable tests, and the error: "literal" (read the written tone), "over" (changed 不/一 where it stays), "other". */
  rule?: RuleId | null;
  rule_error?: "literal" | "over" | "other" | null;
};
export type SpeechResult = {
  text: string;
  score: number;
  syllables: SpeechSyllable[];
  extra: { zhuyin: string; span: [number, number] }[];
  heard_raw: string;
  pitch: { times: number[]; semitones: (number | null)[]; ref_hz: number };
  timing: { infer_seconds: number; audio_seconds: number };
};
export type Summary = {
  areas: Record<string, { total: number; ok: number; week: number }>;
  symbols: Record<string, { n: number; err: number }>;
  symbols_by_area: Record<string, Record<string, { n: number; err: number }>>;
  tones: Record<string, { n: number; err: number }>;
  sentences: number;
  day_streak: number;
  attempts: number;
};

/** One part of an answer: what was expected and what the learner actually produced. */
export type Unit = {
  kind: "tone" | "initial" | "final" | "symbol" | "syllable" | "stroke" | "order" | "sandhi";
  expected: string | number;
  actual?: string | number | null;
  ok?: boolean | null;
  pos?: number;
  try_n?: number;
  help?: boolean;
  ctx?: string;
  lex?: string | number;
  source?: string;
  uncertain?: boolean;
  extra?: Record<string, unknown>;
};
export type PracticeEvent = {
  area: "reading" | "recognize" | "listening" | "dictation" | "writing" | "speaking";
  mode?: string;
  item: string;
  ok: boolean;
  first_try?: boolean;
  score?: number;
  ms?: number;
  tries?: number;
  help?: boolean;
  replays?: number;
  units: Unit[];
  details?: Record<string, unknown>;
};
export type Challenge = {
  id: string;
  area: string;
  title: string;
  why: string;
  target: number;
  progress: number;
  done: boolean;
  href: string;
};
export type ItemStat = {
  area: string;
  kind: string;
  expected: string;
  n: number;
  ok: number;
  acc: number | null;
  post: number;
  recent: number | null;
  before: number | null;
  recent_n: number;
  last: string;
  top: [string, number][];
};
export type WeakItem = ItemStat & { label: string; verb: string; href: string };
export type Rec = { value: number; day: string } | null;
export type Totals = {
  cards: number;
  ok: number;
  acc: number | null;
  minutes: number;
  days: number;
  ms: number | null;
};
export type RecentEvent = {
  id: number;
  ts: number;
  area: string;
  mode: string | null;
  item: string;
  ok: number;
  score: number | null;
  ms: number | null;
  tries: number | null;
  help: number;
  replays: number | null;
  units: {
    kind: string;
    expected: string;
    actual: string | null;
    ok: number | null;
    pos: number;
    try_n: number;
    help: number;
    ctx: string | null;
  }[];
};
export type Stats = {
  range: { days: number | null; since: string; area: string | null };
  overview: Totals & { prev?: Totals };
  daily: {
    day: string;
    cards: number;
    ok: number;
    minutes: number;
    acc: number | null;
    ms: number | null;
    areas: Record<string, [number, number]>;
  }[];
  areas: Record<
    string,
    {
      n: number;
      ok: number;
      acc: number | null;
      first_try: number | null;
      help: number | null;
      tries: number;
      ms: number | null;
      replays: number;
      score: number | null;
      modes: Record<string, number>;
    }
  >;
  confusion: { area: string; kind: string; expected: string; actual: string; n: number }[];
  expected: { area: string; kind: string; expected: string; n: number; ok: number }[];
  items: ItemStat[];
  tone_ctx: Record<"prev" | "next" | "sandhi" | "source" | "position", { k: string[]; n: number; ok: number }[]> & {
    uncertain: number;
    n: number;
  };
  strokes: {
    sym: string;
    n: number;
    status: Record<string, number>;
    by_stroke: Record<string, Record<string, number>>;
    order_n: number;
    order_err: number;
    clean: number | null;
  }[];
  hours: { hour: number; n: number; ok: number }[];
  sessions: { start: number; end: number; cards: number; ok: number; areas: Record<string, number> }[];
  recent: RecentEvent[];
  records: Record<string, Rec>;
  challenges: Challenge[];
  weak: WeakItem[];
  calendar: { day: string; minutes: number }[];
  levels: Levels;
  rules: RuleStat[];
  /** Sound pairs the speech model mixes up for this learner, as the learner confirmed by typing the Pinyin. */
  mic_pairs: MicPair[];
  /** The deep check of missed speaking answers. corrected: false misses fixed in apply mode; top_pairs: the pairs fixed most. */
  deep_check?: {
    mode: "off" | "shadow" | "apply";
    checked: number;
    false_miss: number;
    corrected: number;
    applied: number;
    top_pairs: { kind: string; expected: string; heard: string; n: number }[];
  };
};
export type MicPair = { area: string; kind: string; expected: string; heard: string; n: number; confirmed: boolean };
/** The second, slower check of one missed speaking answer. */
export type DeepCheck = {
  status: "done" | "error";
  verdict: "false_miss" | "partial" | "real_miss" | null;
  applied: boolean;
  score_after: number | null;
  notice_id: number | null;
};
export type Health = {
  ok: boolean;
  speech_model: "ready" | "loading" | "error";
  speech_error: string | null;
  llm_model: string;
  llm_configured: boolean;
  speaker_hz: number | null;
};

export type StepType =
  | "speak_sentences"
  | "speak_sounds"
  | "listen_tones"
  | "listen_sounds"
  | "read_symbols"
  | "recognize_symbols"
  | "write_symbols"
  | "write_syllables"
  | "tone_rules";
export type CoachNote = { kind: string; text: string; ts: number };
export type CoachStep = {
  id: number;
  plan_id: number;
  pos: number;
  type: StepType;
  title: string;
  why: string;
  target: number;
  minutes: number;
  status: "open" | "done" | "skipped";
  skip_reason: string | null;
  done_ts: number | null;
  area: string;
  href: string;
  params: {
    tones?: number[];
    syms?: string[];
    unit?: string;
    source?: string;
    deck?: string[];
    deck_why?: string;
    ids?: number[];
    texts?: string[];
    reps?: number;
    min_score?: number;
    focus?: { tones: number[]; pairs: string[]; syms: string[] };
    written?: number;
    rules?: RuleId[];
    mode?: "quiz" | "speak";
    learn?: boolean;
  };
  finding_ids: string[];
  review: string;
  note: CoachNote | null;
  progress: number;
  tried: number;
  right: number;
  items?: { text: string; passes: number; tries: number; best: number | null; last: number | null }[];
};
export type Finding = {
  id: string;
  domain: string;
  area: string;
  items: string[];
  problem: string;
  context: string;
  severity: number;
  confidence: number;
  drill: string;
};
export type Milestone = {
  id: number;
  ts: number;
  title: string;
  why: string;
  status: "active" | "achieved";
  done_ts: number | null;
  criterion: { area: string; unit: string; expected: string[]; min_acc: number; window: number };
  n: number;
  value: number | null;
  reached: boolean;
};
export type CoachState = {
  ai_quota: AiQuota;
  /** The level path, without the stars per item (GET /api/levels has them). */
  levels: Omit<Levels, "stars">;
  generating: boolean;
  stage: string;
  building_next: boolean;
  error: string | null;
  started: number;
  next_ready: boolean;
  coach_model: string;
  /** The plan whose story is being written now, or null. */
  writing_story: number | null;
  alphabet: {
    known_count: number;
    known: string;
    learning: string;
    new: string;
    next_group: string[];
    gate: boolean;
    learn_reps: number;
    symbols: {
      sym: string;
      state: "known" | "learning" | "new";
      phase: "known" | "recall" | "repeat";
      answers: number;
      right: number;
      reps: number;
      say?: string;
      type?: string;
      write?: string;
      pick?: string;
    }[];
  };
  usage: { calls: number; cost: number; today_calls: number; today_cost: number };
  plan: null | {
    id: number;
    ts: number;
    status: string;
    source: "llm" | "rules";
    model: string | null;
    diagnosis: string;
    reason: string;
    error: string | null;
    done_ts: number | null;
    /** At most 2 short sentences, no numbers: the top of the Coach page. The story has the evidence. */
    headline: string | null;
    has_story: boolean;
    new_answers: number;
    stale: boolean;
    findings: Finding[];
    strengths: string[];
    unknown: string[];
    too_advanced: string[];
    pace: { plan_minutes: number; target_scale: number; steps: number; notes: string; avoid: string[] } | null;
    calls: {
      count: number;
      build_count: number;
      failed: number;
      cost: number;
      tokens: number;
      seconds: number | null;
      models: Record<string, number>;
      stages: Record<string, number>;
    };
  };
  steps: CoachStep[];
  milestones: Milestone[];
  notes: { id: number; ts: number; step_id: number | null; kind: string; text: string }[];
  history: {
    id: number;
    ts: number;
    status: string;
    source: string;
    diagnosis: string;
    headline: string | null;
    done_ts: number | null;
    steps: number;
    done: number;
    skipped: number;
  }[];
};
export type StepState = {
  step: CoachStep;
  plan: { id: number; status: string };
  count: number;
  done: number;
  next: CoachStep | null;
  generating: boolean;
  stage: string;
};

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
  level: number;
  title: string;
  max_level: number;
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
export type Alphabet = CoachState["alphabet"];
export type AlphabetSymbol = Alphabet["symbols"][number];

/** The coach step of the current page (?step=12). Answers given on that page count for the step. */
export const currentStep = () => {
  if (typeof window === "undefined") return null;
  const s = Number(new URLSearchParams(window.location.search).get("step"));
  return s > 0 ? s : null;
};
/** Tells the step banner that an answer was saved, so it can show the new progress. */
const answered = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("zs:answered"));
};
/** Tells the app shell about new level messages, so it can show them at once. */
const notify = (notices?: LevelNotice[]) => {
  if (typeof window !== "undefined" && notices?.length)
    window.dispatchEvent(new CustomEvent<LevelNotice[]>("zs:levels", { detail: notices }));
};

export type Profile = Record<string, string>;

export type Reason = "travel" | "family" | "live" | "work" | "culture" | "fun";
export type Level = "new" | "words" | "everyday" | "fluent";
export type BopomofoLevel = "none" | "some" | "reads";
/** The signed-in learner: settings, and whether the onboarding is done. */
export type Me = {
  onboarded: boolean;
  timezone: string;
  timezone_set: boolean;
  goal_min: number | null;
  level: Level | null;
  bopomofo: BopomofoLevel | null;
  reasons: Reason[];
  sentence_level: "beginner" | "intermediate" | "advanced";
  name: string;
  /** The placement test after the onboarding: "due" for the everyday and fluent levels until it is done. */
  placement: "none" | "due" | "done";
};
export type Onboarding = {
  name: string;
  reasons: Reason[];
  level: Level;
  bopomofo: BopomofoLevel;
  goal_min: number;
  timezone: string;
};

/** One voice part of the placement test: cards recorded, the symbols and tones it proves (more often right than wrong), symbols missed. */
export type PlacementVoice = { cards: number; symbols: string; tones: number[]; missed: string[] };
export type PlacementResult = {
  level: number;
  title: string;
  alphabet_known: boolean;
  syllables_ok: boolean;
  sentences_ok: boolean;
  chapters: boolean;
  alphabet: { right: number; of: number; asked: number; known: string } | null;
  syllables: PlacementVoice;
  sentences: PlacementVoice;
  voice_skipped: boolean;
  ts: number;
};
/** What the placement test asks. alphabet: false when the learner said they do not know Bopomofo yet (no alphabet part). */
export type Placement = {
  status: "none" | "due" | "done";
  alphabet: boolean;
  symbols: string;
  syllables: { text: string; items: TextItem[] }[];
  sentences: { text: string; english: string; items: TextItem[] }[];
  result: PlacementResult | null;
};

export type AiQuota = {
  user_id: string;
  blocked: boolean;
  calls: number;
  call_limit: number;
  cost: number;
  cost_limit: number;
  remaining_percent: number;
  server_now: number;
  period_started_at: number;
  resets_at: number;
  timezone: string;
};
export const AI_QUOTA_EVENT = "zs:ai-quota";
export function publishAiQuota(quota: AiQuota) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AI_QUOTA_EVENT, { detail: quota }));
}

export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://127.0.0.1:8765";
  return window.location.protocol + "//" + window.location.hostname + ":8765";
}

// Messages the learner can read as they are. Every other error gets a short, friendly message.
const SAFE_DETAIL =
  /^(The recording is|The target text has|Text must be|This plan has no story|Unknown time zone|You reached the daily|The request is too large|That is not a Pinyin syllable|These recordings are not|This card has no sounds)/;

// The Clerk session token. <ApiAuth /> gives the getter while a user is signed in, and null when not.
// Just after the sign-in redirect there is no token yet: requests wait for one (at most 10 s).
let tokenGetter: (() => Promise<string | null>) | null = null;
let waiting: (() => void)[] = [];
export function setTokenGetter(get: (() => Promise<string | null>) | null) {
  tokenGetter = get;
  if (get) {
    waiting.forEach((wake) => wake());
    waiting = [];
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (!tokenGetter)
      await new Promise<void>((wake) => {
        waiting.push(wake);
        setTimeout(wake, end - Date.now());
      });
    const token = await tokenGetter?.().catch(() => null);
    if (token) return { Authorization: "Bearer " + token };
    await new Promise((r) => setTimeout(r, 200));
  }
  return {};
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(await authHeaders())) headers.set(k, v);
  return fetch(apiBase() + path, { ...init, headers });
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await send(path, init);
  } catch {
    throw new Error("Can't connect right now. Please try again in a moment.");
  }
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      if (typeof j.detail === "string") detail = j.detail;
      if (j.ai_quota) publishAiQuota(j.ai_quota);
    } catch {}
    const msg = SAFE_DETAIL.test(detail)
      ? detail
      : r.status === 401
        ? "Please sign in again."
        : r.status === 503
          ? "The speech check is getting ready. Try again in a few seconds."
          : "Something went wrong. Please try again in a moment.";
    throw new Error(msg);
  }
  const data = await r.json();
  if (data.ai_quota) publishAiQuota(data.ai_quota);
  return data as T;
}

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

export type SymbolCheck = {
  target: string;
  ok: boolean;
  lenient: boolean;
  heard: string | null;
  closest: string;
  fit: number;
  ranking: string[];
};

export type Voice = { id: string; label: string; description: string };

const VOICE_KEY = "zhuyin.voice";
export const getVoice = () => (typeof window === "undefined" ? "" : (localStorage.getItem(VOICE_KEY) ?? ""));
export const setVoice = (id: string) => localStorage.setItem(VOICE_KEY, id);
export const voices = () => call<{ default: string; voices: Voice[] }>("/api/tts/voices");

// Bumped by "Clear audio cache" so the browser cannot replay its own cached copy of an old clip.
const AUDIO_V_KEY = "zhuyin.audioVersion";
const audioVersion = () => (typeof window === "undefined" ? "" : (localStorage.getItem(AUDIO_V_KEY) ?? ""));
export const clearAudioCache = async () => {
  const r = await call<{ files: number; bytes: number }>("/api/tts/cache/clear", { method: "POST" });
  localStorage.setItem(AUDIO_V_KEY, String(Date.now()));
  ttsBlobs.forEach((url) => URL.revokeObjectURL(url));
  ttsBlobs.clear();
  return r;
};

export const ttsUrl = (text: string, rate = 0, voice = getVoice()) =>
  apiBase() +
  "/api/tts?text=" +
  encodeURIComponent(text) +
  "&rate=" +
  rate +
  (voice ? "&voice=" + encodeURIComponent(voice) : "") +
  (audioVersion() ? "&v=" + audioVersion() : "");

// /api/tts needs the sign-in token, and <audio src> cannot send it. So the audio is fetched with the token
// and played from a blob: URL. The last clips stay in memory, so a replay starts at once.
const ttsBlobs = new Map<string, string>();
const MAX_BLOBS = 200;

/** The address the player can use for src: the same string, or a promise when the audio must be fetched first. */
export function playableSrc(src: string): string | Promise<string> {
  if (!src.startsWith(apiBase() + "/api/tts?")) return src;
  const hit = ttsBlobs.get(src);
  if (hit) return hit;
  return send(src.slice(apiBase().length)).then(async (r) => {
    if (!r.ok) throw new Error("Audio failed: " + r.status);
    const url = URL.createObjectURL(await r.blob());
    ttsBlobs.set(src, url);
    if (ttsBlobs.size > MAX_BLOBS) {
      const [oldest, old] = ttsBlobs.entries().next().value!;
      URL.revokeObjectURL(old);
      ttsBlobs.delete(oldest);
    }
    return url;
  });
}

/** Download every answer as CSV. A plain link cannot send the sign-in token, so the file is fetched first. */
export async function downloadExport() {
  const r = await send("/api/stats/export.csv");
  if (!r.ok)
    throw new Error(r.status === 401 ? "Please sign in again." : "Something went wrong. Please try again in a moment.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "bopomofo-history.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
