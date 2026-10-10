// Hands-free microphone: keeps listening and hands over each spoken utterance as a 16 kHz WAV.
// Speech starts when the level rises above the room noise, and ends after a short silence.
// Each clip keeps exactly PAD_S of audio before the first loud frame and after the last sound.
import { encodeWav, resample } from "./recorder";

const WORKLET = "class L extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('listen',L)";
const FRAME_S = 0.02; // level is measured on 20 ms frames
const PAD_S = 0.3; // audio kept before the start and after the end of the sound
const START_S = 0.06; // loud frames in a row needed to start
const END_S = 0.45; // silence that ends an utterance
const MIN_S = 0.1; // shorter sounds are clicks, not speech
const MAX_S = 4;
const QUIET_S = 0.15; // sound above the noise but below the start level for this long is reported as too quiet
const PAD = Math.round(PAD_S / FRAME_S);

export type Utterance = { wav: Blob; seconds: number; voiced: number; peak: number };
export type Discard = "short" | "quiet";

export class Listener {
  onUtterance: (u: Utterance) => void = () => {};
  onDiscard: (why: Discard) => void = () => {};
  onLevel: (level: number, speaking: boolean) => void = () => {};
  /** While muted (for example during playback), sound is ignored and the noise floor is not updated. */
  muted = false;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private rate = 48000;
  private frame: number[] = [];
  private frameLen = 960;
  private ring: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private loud = 0;
  private soft = 0;
  private quiet = 0;
  private first = 0; // index in speech of the first loud frame
  private last = 0; // index in speech of the last frame with sound
  private peak = 0;
  private speaking = false;
  private noise = 0.003;

  async start() {
    // No browser noise suppression: it cuts short, quiet sounds such as a lone ㄙ or ㄈ.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    this.rate = this.ctx.sampleRate;
    this.frameLen = Math.round(this.rate * FRAME_S);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, "listen");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
  }

  async stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.reset();
  }

  /** Drop any utterance in progress (for example when the target changes). */
  reset() {
    this.speech = [];
    this.speaking = false;
    this.loud = this.soft = this.quiet = this.peak = 0;
  }

  private push(chunk: Float32Array) {
    for (const v of chunk) {
      this.frame.push(v);
      if (this.frame.length >= this.frameLen) {
        this.onFrame(Float32Array.from(this.frame));
        this.frame = [];
      }
    }
  }

  private onFrame(f: Float32Array) {
    let s = 0;
    for (const v of f) s += v * v;
    const rms = Math.sqrt(s / f.length);
    if (this.muted) {
      if (this.speaking) this.reset();
      this.ring = [];
      this.onLevel(0, false);
      return;
    }
    const on = Math.max(0.005, this.noise * 3);
    if (!this.speaking) {
      // Track the room noise only while nobody speaks.
      if (rms < on) this.noise = this.noise * 0.97 + Math.min(rms, 0.03) * 0.03;
      this.ring.push(f);
      if (this.ring.length > PAD + START_S / FRAME_S) this.ring.shift();
      this.loud = rms > on ? this.loud + 1 : 0;
      if (rms > Math.max(0.002, this.noise * 1.8) && rms <= on) {
        if (++this.soft * FRAME_S === QUIET_S) this.onDiscard("quiet");
      } else if (rms <= on) this.soft = 0;
      if (this.loud * FRAME_S >= START_S) {
        const firstLoud = this.ring.length - this.loud;
        const from = Math.max(0, firstLoud - PAD);
        this.speech = this.ring.slice(from);
        this.first = firstLoud - from;
        this.last = this.speech.length - 1;
        this.peak = rms;
        this.ring = [];
        this.speaking = true;
        this.quiet = this.soft = 0;
      }
    } else {
      this.speech.push(f);
      this.peak = Math.max(this.peak, rms);
      if (rms > on * 0.5) { this.last = this.speech.length - 1; this.quiet = 0; } else this.quiet += 1;
      if (this.quiet * FRAME_S >= END_S || this.speech.length * FRAME_S >= MAX_S) this.finish();
    }
    this.onLevel(Math.min(1, rms * 10), this.speaking);
  }

  private finish() {
    const frames = this.speech.slice(0, this.last + 1 + PAD);
    const voiced = (this.last - this.first + 1) * FRAME_S;
    const peak = this.peak;
    this.reset();
    if (voiced < MIN_S) { this.onDiscard("short"); return; }
    const all = new Float32Array(frames.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of frames) { all.set(c, o); o += c.length; }
    const pcm = resample(all, this.rate, 16000);
    this.onUtterance({ wav: encodeWav(pcm, 16000), seconds: pcm.length / 16000, voiced, peak });
  }
}

