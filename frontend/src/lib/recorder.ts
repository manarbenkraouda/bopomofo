// Microphone recorder that produces a 16 kHz mono 16-bit WAV (no server-side decoder needed).
const WORKLET =
  "class R extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('rec',R)";

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  onLevel: (rms: number) => void = () => {};

  async start() {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "rec");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.chunks.push(e.data);
      let s = 0;
      for (const v of e.data) s += v * v;
      this.onLevel(Math.sqrt(s / e.data.length));
    };
    src.connect(this.node);
  }

  async stop(): Promise<{ wav: Blob; seconds: number }> {
    const rate = this.ctx?.sampleRate ?? 48000;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const pcm = resample(all, rate, 16000);
    return { wav: encodeWav(pcm, 16000), seconds: pcm.length / 16000 };
  }
}

export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to,
    n = Math.floor(x.length / ratio),
    out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // average over the source window (simple low-pass) then sample
    const a = Math.floor(i * ratio),
      b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += x[k];
    out[i] = b > a ? s / (b - a) : (x[a] ?? 0);
  }
  return out;
}

export function encodeWav(pcm: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2),
    v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}
