import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { api, clearAudioCache, playableSrc, setTokenGetter, ttsUrl } from "../api";
import { call, send } from "./transport";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalBase = process.env.NEXT_PUBLIC_API_URL;
let browser: EventTarget;
let requests: { url: string; init?: RequestInit }[];

beforeEach(() => {
  browser = Object.assign(new EventTarget(), { location: new URL("http://localhost:3210/speaking?step=12") });
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:8766";
  setTokenGetter(async () => "test-session");
  requests = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return Response.json({ ok: true, id: 42, notices: [{ id: 7 }] });
  }) as typeof fetch;
});

afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
  setTokenGetter(null);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalBase;
});

describe("API boundary", () => {
  test("adds the session token without losing request headers or options", async () => {
    await send("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(requests[0].url).toBe("http://localhost:8766/api/profile");
    expect(requests[0].init?.method).toBe("PUT");
    const headers = new Headers(requests[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-session");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("saves a practice answer with its step and emits the two progress events", async () => {
    const events: string[] = [];
    browser.addEventListener("zs:answered", () => events.push("answered"));
    browser.addEventListener("zs:levels", (e) => events.push("level:" + (e as CustomEvent).detail[0].id));
    const result = await api.event({
      area: "recognize",
      item: "ㄅ",
      ok: true,
      units: [],
      details: { placement: true },
    });
    expect(result.id).toBe(42);
    expect(JSON.parse(String(requests[0].init?.body)).details).toEqual({ placement: true, step: 12 });
    expect(events).toEqual(["answered", "level:7"]);
  });

  test("a failed practice save returns ok false and emits no answer event", async () => {
    let answered = false;
    browser.addEventListener("zs:answered", () => {
      answered = true;
    });
    globalThis.fetch = (async () => new Response("failed", { status: 500 })) as typeof fetch;
    expect(await api.event({ area: "reading", item: "ㄅ", ok: false, units: [] })).toEqual({
      ok: false,
      id: undefined,
    });
    expect(answered).toBe(false);
  });

  test("speech uploads retain the step, help flag, and recording number", async () => {
    await api.speech(new Blob(["clip"]), "你好", "sentence", { help: true, tryN: 2 });
    const form = requests[0].init?.body as FormData;
    expect(requests[0].url).toEndWith("/api/speech/analyze");
    expect(form.get("step")).toBe("12");
    expect(form.get("help")).toBe("1");
    expect(form.get("try_n")).toBe("2");
    expect(form.get("text")).toBe("你好");
    expect((form.get("audio") as File).name).toBe("speech.wav");
  });

  test("publishes quota updates from successful and refused requests", async () => {
    const seen: boolean[] = [];
    browser.addEventListener("zs:ai-quota", (e) => seen.push((e as CustomEvent).detail.blocked));
    globalThis.fetch = (async () => Response.json({ ai_quota: { blocked: false } })) as typeof fetch;
    await call("/api/ai/quota");
    globalThis.fetch = (async () =>
      Response.json(
        { detail: "You reached the daily limit", ai_quota: { blocked: true } },
        { status: 429 },
      )) as typeof fetch;
    await expect(call("/api/ai/quota")).rejects.toThrow("You reached the daily limit");
    expect(seen).toEqual([false, true]);
  });

  test.each([
    [401, "internal token failure", "Please sign in again."],
    [503, "internal model failure", "The speech check is getting ready. Try again in a few seconds."],
    [500, "private database detail", "Something went wrong. Please try again in a moment."],
    [400, "The recording is too short", "The recording is too short"],
  ])("maps HTTP %s to the existing learner message", async (status, detail, message) => {
    globalThis.fetch = (async () => Response.json({ detail }, { status })) as typeof fetch;
    await expect(call("/api/test")).rejects.toThrow(message);
  });

  test("reports a connection failure with the existing message", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network detail");
    }) as typeof fetch;
    await expect(call("/api/test")).rejects.toThrow("Can't connect right now. Please try again in a moment.");
  });

  test("reuses authenticated audio and clears its object URL with the cache", async () => {
    const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const src = ttsUrl("你好", -35, "voice-a");
    const query = new URL(src).searchParams;
    expect(query.get("text")).toBe("你好");
    expect(query.get("rate")).toBe("-35");
    expect(query.get("voice")).toBe("voice-a");
    expect(await playableSrc(src)).toBe("blob:test");
    expect(await playableSrc(src)).toBe("blob:test");
    expect(create).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    await clearAudioCache();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    expect(new URL(ttsUrl("你好")).searchParams.has("v")).toBe(true);
    expect(playableSrc("/audio/symbol.mp3")).toBe("/audio/symbol.mp3");
  });
});
