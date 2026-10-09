export type Syl = {
  type: "syllable"; char: string; zhuyin: string; initial: string; final: string;
  tone: number; surface_tone: number; pinyin: string; alt_tones: number[];
};
export type TextItem = Syl | { type: "text"; text: string };
export type Sentence = { id: number; hanzi: string; english: string; words: { text: string; english: string }[]; topic: string; level: string; created: number; items: TextItem[] };
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
  tones: Record<string, { n: number; err: number }>;
  sentences: number; day_streak: number; attempts: number;
};
export type Health = { ok: boolean; speech_model: "ready" | "loading" | "error"; speech_error: string | null; llm_model: string; llm_configured: boolean; speaker_hz: number | null };

export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://127.0.0.1:8765";
  return window.location.protocol + "//" + window.location.hostname + ":8765";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(apiBase() + path, init);
  } catch {
    throw new Error("The backend is not reachable. Start it with start.cmd.");
  }
  if (!r.ok) {
    let msg = r.status + " " + r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j); } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  health: () => call<Health>("/api/health"),
  analyzeText: (text: string) => call<{ text: string; items: TextItem[] }>("/api/text/analyze", json({ text })),
  translate: (text: string) => call<{ english: string; words: { text: string; english: string }[] }>("/api/text/translate", json({ text })),
  generate: (topic: string, level: string, count: number) => call<{ sentences: Sentence[] }>("/api/sentences/generate", json({ topic, level, count })),
  sentences: () => call<{ sentences: Sentence[] }>("/api/sentences"),
  sentence: (id: number) => call<Sentence>("/api/sentences/" + id),
  deleteSentence: (id: number) => call<{ ok: boolean }>("/api/sentences/" + id, { method: "DELETE" }),
  speech: (wav: Blob, text: string) => {
    const f = new FormData();
    f.append("audio", wav, "speech.wav");
    f.append("text", text);
    return call<SpeechResult>("/api/speech/analyze", { method: "POST", body: f });
  },
  attempt: (area: string, item: string, ok: boolean, details?: object, score?: number) =>
    call<{ ok: boolean }>("/api/progress/attempt", json({ area, item, ok, details, score })).catch(() => ({ ok: false })),
  summary: () => call<Summary>("/api/progress/summary"),
};

export const ttsUrl = (text: string, rate = 0) => apiBase() + "/api/tts?text=" + encodeURIComponent(text) + "&rate=" + rate;
