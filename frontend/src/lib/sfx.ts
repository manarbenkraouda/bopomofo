// Short sound effects made with the Web Audio API (no audio files). They can be turned off.
import { setPref } from "./prefs";

const KEY = "zhuyin.sfx";
export const SFX_KEY = KEY;
export type Sfx = "right" | "close" | "wrong" | "tick";

export const sfxEnabled = () => typeof window !== "undefined" && localStorage.getItem(KEY) !== "off";
export const setSfxEnabled = (on: boolean) => setPref(KEY, on ? "on" : "off");

let ctx: AudioContext | null = null;
const subs = new Set<(ms: number) => void>();

/** Called with the length of each effect that plays, so a microphone can ignore it. */
export function onSfx(fn: (ms: number) => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function note(
  c: AudioContext,
  freq: number,
  at: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; slideTo?: number; lowpass?: number } = {},
) {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.15, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out: AudioNode = g;
  if (opts.lowpass) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = opts.lowpass;
    g.connect(f);
    out = f;
  }
  osc.connect(g);
  out.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Play an effect. Returns its length in ms (0 when effects are off), so the caller can mute the microphone meanwhile. */
export function playSfx(kind: Sfx): number {
  const ms = play(kind);
  if (ms) subs.forEach((f) => f(ms));
  return ms;
}

function play(kind: Sfx): number {
  if (!sfxEnabled()) return 0;
  // A short vibration on phones that support it (Android), like the haptic feedback of mobile learning apps.
  if (kind !== "tick") navigator.vibrate?.(kind === "right" ? 18 : kind === "close" ? 30 : [40, 60, 40]);
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  if (kind === "right") {
    // Rising three-note chime.
    note(ctx, 784, 0, 0.32, { type: "triangle", gain: 0.16 });
    note(ctx, 1175, 0.08, 0.32, { type: "triangle", gain: 0.14 });
    note(ctx, 1568, 0.16, 0.45, { type: "sine", gain: 0.12 });
    return 620;
  }
  if (kind === "wrong") {
    // Soft falling buzz, filtered so it is not harsh.
    note(ctx, 330, 0, 0.22, { type: "sawtooth", gain: 0.1, slideTo: 220, lowpass: 900 });
    note(ctx, 220, 0.18, 0.26, { type: "sawtooth", gain: 0.09, slideTo: 165, lowpass: 700 });
    return 450;
  }
  if (kind === "close") {
    // Two even notes: neither a win nor a miss.
    note(ctx, 660, 0, 0.22, { type: "triangle", gain: 0.13 });
    note(ctx, 740, 0.12, 0.3, { type: "triangle", gain: 0.11 });
    return 450;
  }
  note(ctx, 1320, 0, 0.05, { type: "sine", gain: 0.05 });
  return 60;
}
