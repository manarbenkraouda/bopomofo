import { publishAiQuota } from "./events";

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

export async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(await authHeaders())) headers.set(k, v);
  return fetch(apiBase() + path, { ...init, headers });
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
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
