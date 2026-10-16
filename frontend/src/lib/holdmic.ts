// Press-and-hold microphone. The microphone stays open while a speaking page is shown, so a press loses nothing:
// each clip starts PRE_S before the press and ends POST_S after the release. A plosive said at the press (ㄅ, ㄆ) is kept.
// One microphone is shared by every component (lib/useHoldMic.ts), because a placement card remounts for each item.
import { encodeWav, resample } from "./recorder";

const WORKLET =
  "class H extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('hold',H)";
const PRE_S = 0.5; // audio kept from before the press
const POST_S = 0.35; // audio kept after the release
const MIN_HOLD_S = 0.1; // shorter presses are taps
const QUIET = 0.008; // a clip whose loudest moment stays under this RMS has no voice in it
const LEVEL_MS = 50; // the level meter updates at this rate

export type Clip = { wav: Blob; seconds: number; held: number; peak: number };
/** short: a tap, not a hold. quiet: no voice. opened: the microphone was not open at the press, so nothing was recorded. */
export type HoldDiscard = "short" | "quiet" | "opened";

export class HoldMic {
  onLevel: (level: number) => void = () => {};
  /** While muted (the app plays a sound), the audio before a press is not kept. */
  muted = false;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private rate = 48000;
  private ring: Float32Array[] = [];
  private ringLen = 0;
  private clip: Float32Array[] | null = null;
  private pressedAt = 0;
  private peak = 0;
  private quietUntil = 0;
  private tailLeft = -1;
  private onTail: (() => void) | null = null;
  private levelMax = 0;
  private levelAt = 0;

  async start() {
    // No echo cancellation and no noise suppression: both can cut the short burst of ㄅ, ㄆ, ㄉ, ㄊ after a silence.
    // The app stops its own audio at the press, so there is no echo to cancel.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    this.rate = this.ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, "hold");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
  }

  /** The audio context starts suspended when the page had no click yet. A press is a click, so it can resume it. */
  get running() {
    return this.ctx?.state === "running";
  }
  resume() {
    return this.ctx?.resume() ?? Promise.resolve();
  }

  async stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.cancel();
  }

  /** Do not keep the next ms milliseconds as audio before a press (an app sound effect plays). */
  quiet(ms: number) {
    this.quietUntil = Math.max(this.quietUntil, performance.now() + ms);
    this.ring = [];
    this.ringLen = 0;
  }

  press() {
    if (this.clip) return;
    this.clip = this.ring;
    this.ring = [];
    this.ringLen = 0;
    this.pressedAt = performance.now();
    this.peak = 0;
    this.tailLeft = -1;
  }

  /** Records POST_S more, then gives the clip, or the reason it was dropped. */
  release(): Promise<Clip | HoldDiscard | null> {
    if (!this.clip || this.tailLeft >= 0) return Promise.resolve(null);
    const held = (performance.now() - this.pressedAt) / 1000;
    return new Promise((resolve) => {
      this.onTail = () => resolve(this.finish(held));
      this.tailLeft = Math.round(POST_S * this.rate);
      // A stopped context sends no more audio: finish with what there is.
      if (!this.running) this.endTail();
    });
  }

  /** Drop the clip in progress. */
  cancel() {
    this.clip = null;
    this.onTail = null;
    this.tailLeft = -1;
  }

  private endTail() {
    const f = this.onTail;
    this.onTail = null;
    f?.();
  }

  private push(c: Float32Array) {
    let s = 0;
    for (const v of c) s += v * v;
    const rms = Math.sqrt(s / c.length);
    const t = performance.now();
    this.levelMax = Math.max(this.levelMax, rms);
    if (t - this.levelAt >= LEVEL_MS) {
      this.onLevel(this.levelMax);
      this.levelMax = 0;
      this.levelAt = t;
    }
    if (this.clip) {
      this.clip.push(c);
      this.peak = Math.max(this.peak, rms);
      if (this.tailLeft >= 0) {
        this.tailLeft -= c.length;
        if (this.tailLeft <= 0) this.endTail();
      }
      return;
    }
    if (this.muted || t < this.quietUntil) {
      this.ring = [];
      this.ringLen = 0;
      return;
    }
    this.ring.push(c);
    this.ringLen += c.length;
    const keep = PRE_S * this.rate;
    while (this.ring.length && this.ringLen - this.ring[0].length >= keep) this.ringLen -= this.ring.shift()!.length;
  }

  private finish(held: number): Clip | HoldDiscard {
    const frames = this.clip ?? [];
    const peak = this.peak;
    this.clip = null;
    this.tailLeft = -1;
    if (held < MIN_HOLD_S) return "short";
    if (peak < QUIET) return "quiet";
    const all = new Float32Array(frames.reduce((a, f) => a + f.length, 0));
    let o = 0;
    for (const f of frames) {
      all.set(f, o);
      o += f.length;
    }
    const pcm = resample(all, this.rate, 16000);
    return { wav: encodeWav(pcm, 16000), seconds: pcm.length / 16000, held, peak };
  }
}
