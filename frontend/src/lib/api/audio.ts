import { apiBase, call, send } from "./transport";
import { type Voice } from "./types/content";

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
