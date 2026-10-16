"use client";
// Press and hold to speak: a hook around one shared HoldMic, with the props for the hold button (mouse and touch).
// Keyboard: register a hotkey with run: press and up: release (lib/hotkeys.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { onPlaying, stopAudio } from "./audio";
import { HoldMic, type Clip, type HoldDiscard } from "./holdmic";
import { onSfx } from "./sfx";

export type { Clip, HoldDiscard } from "./holdmic";
/** off: closed. opening: waiting for the browser. ready: open, waiting for a press. holding: recording. sending: recording the end. */
export type HoldState = "off" | "opening" | "ready" | "holding" | "sending";

let shared: HoldMic | null = null;
let opening: Promise<HoldMic> | null = null;
let users = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function openShared(): Promise<HoldMic> {
  if (shared) return Promise.resolve(shared);
  if (opening) return opening;
  const m = new HoldMic();
  opening = m
    .start()
    .then(() => {
      shared = m;
      return m;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

/** The text to show for a dropped clip. key: the key to hold on a desktop. */
export function holdHint(why: HoldDiscard, key: string, phone: boolean) {
  const how = phone ? "Hold the button" : "Hold " + key + " or the button";
  if (why === "opened") return "The microphone is on now. " + how + " and speak.";
  if (why === "short") return how + " while you speak, then let go.";
  return "I heard nothing. Speak louder or move closer to the microphone.";
}

export function useHoldMic(opts: {
  onClip: (c: Clip) => void;
  onDiscard?: (why: HoldDiscard) => void;
  maxS?: number;
  active?: boolean;
}) {
  const { active = true } = opts;
  const [state, setState] = useState<HoldState>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const cbs = useRef(opts);
  useEffect(() => {
    cbs.current = opts;
  });
  const down = useRef(false); // the button or the key is held
  const mine = useRef(false); // this component has a clip in progress
  const alive = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseRef = useRef<() => void>(() => {});

  const attach = useCallback((m: HoldMic) => {
    m.onLevel = (v) => {
      if (alive.current) setLevel(Math.min(1, v * 8));
    };
  }, []);

  const open = useCallback(async () => {
    if (shared) {
      attach(shared);
      return shared;
    }
    setState("opening");
    setError("");
    try {
      const m = await openShared();
      if (!alive.current) return null;
      attach(m);
      setState("ready");
      return m;
    } catch (e) {
      if (alive.current) {
        setError("Microphone not available: " + (e as Error).message);
        setState("off");
      }
      return null;
    }
  }, [attach]);

  const press = useCallback(async () => {
    if (down.current || !alive.current) return;
    down.current = true;
    setError("");
    stopAudio();
    const was = shared;
    const m = was ?? (await open());
    // Opened by this press: the start of the speech is already lost, so record nothing and ask for a new press.
    if (!m || !was) {
      down.current = false;
      if (m) cbs.current.onDiscard?.("opened");
      return;
    }
    if (!m.running) await m.resume();
    if (!down.current || !alive.current) return;
    attach(m);
    m.muted = false;
    m.press();
    mine.current = true;
    setState("holding");
    timer.current = setTimeout(() => releaseRef.current(), (cbs.current.maxS ?? 6) * 1000);
  }, [open, attach]);

  const release = useCallback(async () => {
    if (!down.current) return;
    down.current = false;
    if (timer.current) clearTimeout(timer.current);
    const m = shared;
    if (!m || !mine.current) return;
    mine.current = false;
    setState("sending");
    const r = await m.release();
    if (!alive.current) return;
    setLevel(0);
    setState("ready");
    if (!r) return;
    if (typeof r === "string") cbs.current.onDiscard?.(r);
    else cbs.current.onClip(r);
  }, []);
  useEffect(() => {
    releaseRef.current = () => void release();
  }, [release]);

  // Open the microphone with the page when the browser allows it without asking (permission given, a click already made).
  useEffect(() => {
    if (!active) return;
    alive.current = true;
    users++;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (shared) {
      attach(shared);
      setState("ready");
    } else {
      const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
      if (ua?.hasBeenActive)
        navigator.permissions
          ?.query({ name: "microphone" as PermissionName })
          .then((p) => {
            if (p.state === "granted" && alive.current) void open();
          })
          .catch(() => {});
    }
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (mine.current) shared?.cancel();
      mine.current = down.current = false;
      if (--users === 0)
        closeTimer = setTimeout(() => {
          closeTimer = null;
          const m = shared;
          shared = null;
          void m?.stop();
        }, 1500);
      setState("off");
      setLevel(0);
    };
  }, [active, attach, open]);

  // The app's own sounds do not go into the audio kept before a press.
  useEffect(() => {
    if (!active) return;
    const a = onPlaying((src) => {
      if (!shared) return;
      if (src) shared.muted = true;
      else {
        shared.muted = false;
        shared.quiet(200);
      }
    });
    const b = onSfx((ms) => shared?.quiet(ms + 100));
    return () => {
      a();
      b();
    };
  }, [active]);

  /** Props for the hold button. Pointer capture keeps the hold when the finger slides off the button. */
  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      void press();
    },
    onPointerUp: () => void release(),
    onPointerCancel: () => void release(),
    onLostPointerCapture: () => void release(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: {
      touchAction: "none",
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none",
    } as React.CSSProperties,
  };

  return { state, level, error, press, release, bind, holding: state === "holding" || state === "sending" };
}
