// Synthesizes the promo sound bed + SFX into video/assets/audio/promo-mix.wav (48 kHz, 16-bit stereo, 30 s).
// Free, local, deterministic. No samples, no voice.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const S = 1.5; // time stretch: 1 = 30 s cut, 1.5 = 45 s cut. SFX times below are on the 30 s timeline.
const SR = 48000, DUR = 30 * S, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function add(t0, len, pan, fn) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const k = s0 + i; if (k < 0 || k >= N) continue;
    const v = fn(i / SR, i);
    L[k] += v * gl; R[k] += v * gr;
  }
}

// ---------- bed: 105 BPM, warm plucks + pad + soft kick + hat ----------
const BPM = 105, BEAT = 60 / BPM, BAR = BEAT * 4;
const chords = [[65, 69, 72], [60, 64, 67], [62, 65, 69], [58, 62, 65]]; // F C Dm Bb
const bass = [41, 36, 38, 34];
const bars = Math.ceil(DUR / BAR) + 1;
for (let b = 0; b < bars; b++) {
  const c = chords[b % 4], t = b * BAR;
  for (const m of c) {
    const f = mtof(m - 12);
    add(t, BAR + 0.4, (m % 2 ? -0.3 : 0.3), (x) => {
      const env = Math.min(1, x / 0.6) * Math.min(1, Math.max(0, (BAR + 0.4 - x) / 0.6));
      return 0.028 * env * (Math.sin(TAU * f * x) + 0.6 * Math.sin(TAU * f * 1.004 * x) + 0.25 * Math.sin(TAU * f * 2.003 * x));
    });
  }
  for (const q of [0, 2]) {
    const f = mtof(bass[b % 4]);
    add(t + q * BEAT, BEAT * 1.6, 0, (x) => 0.11 * Math.exp(-x * 2.2) * Math.min(1, x / 0.01) * (Math.sin(TAU * f * x) + 0.3 * Math.sin(TAU * 2 * f * x)));
  }
  const arp = [c[0], c[1], c[2], c[1] + 12, c[2], c[1], c[0] + 12, c[2]];
  for (let e = 0; e < 8; e++) {
    const f = mtof(arp[e]);
    add(t + e * BEAT / 2, 0.5, e % 2 ? 0.35 : -0.35, (x) => 0.045 * Math.exp(-x * 9) * Math.min(1, x / 0.004) *
      (Math.sin(TAU * f * x) + 0.35 * Math.sin(TAU * 2 * f * x) * Math.exp(-x * 14) + 0.12 * Math.sin(TAU * 3 * f * x) * Math.exp(-x * 20)));
  }
  for (let q = 0; q < 4; q++) {
    add(t + q * BEAT, 0.3, 0, (x) => { const f = 48 + 90 * Math.exp(-x * 30); return 0.16 * Math.exp(-x * 13) * Math.sin(TAU * f * x); });
    let hp = 0, prev = 0;
    add(t + q * BEAT + BEAT / 2, 0.06, 0.2, (x) => { const n = noise(); hp = 0.85 * (hp + n - prev); prev = n; return 0.035 * Math.exp(-x * 70) * hp; });
  }
}

// ---------- SFX ----------
const pop = (t, g = 1, pitch = 1) => add(t * S, 0.12, 0, (x) => { const f = (520 + 900 * (1 - Math.exp(-x * 40))) * pitch; return 0.2 * g * Math.exp(-x * 38) * Math.min(1, x / 0.002) * Math.sin(TAU * f * x); });
const click = (t, g = 1) => { let hp = 0, prev = 0; add(t * S, 0.05, 0.1, (x) => { const n = noise(); hp = 0.6 * (hp + n - prev); prev = n; return g * (0.22 * Math.exp(-x * 120) * hp + 0.08 * Math.exp(-x * 90) * Math.sin(TAU * 1800 * x)); }); };
const chime = (t, g = 1) => { for (const [f, d] of [[1318.5, 0], [1975.5, 0.07], [2637, 0.14]]) add(t * S + d, 1.2, d ? 0.25 : -0.25, (x) => 0.075 * g * Math.exp(-x * 3.5) * Math.min(1, x / 0.003) * (Math.sin(TAU * f * x) + 0.2 * Math.sin(TAU * 2.76 * f * x) * Math.exp(-x * 10))); };
const boop = (t) => add(t * S, 0.32, 0, (x) => { const f = 230 - 80 * Math.min(1, x / 0.25); return 0.2 * Math.min(1, x / 0.01) * Math.exp(-x * 7) * (Math.sin(TAU * f * x) + 0.25 * Math.sin(TAU * 2 * f * x)); });
const whoosh = (t, len = 0.55) => { let lp = 0, lp2 = 0; add(t * S, len, 0, (x) => { const p = x / len; const cut = 0.04 + 0.35 * Math.sin(Math.PI * p); const n = noise(); lp += cut * (n - lp); lp2 += cut * (lp - lp2); return 0.32 * Math.pow(Math.sin(Math.PI * p), 2) * (lp - lp2 * 0.5); }); };

// text hits (pops), aligned with the GSAP timeline in video/index.html
[0.15, 1.05, 1.25, 2.55, 5.05, 7.4, 9.05, 11.55, 13.35, 13.6, 15.55, 17.3, 18.05, 20.55, 23.5, 25.2, 26.7, 27.2].forEach((t) => pop(t));
[0, 1, 2, 3, 4].forEach((i) => pop(2.85 + i * 0.08, 0.6, 1 + i * 0.08));   // five practice tiles
[0, 1, 2].forEach((i) => pop(16.2 + i * 0.32, 0.7, 0.9 + i * 0.1));        // plan steps
[0, 1, 2].forEach((i) => pop(24.9 + i * 0.13, 0.55, 1.3 + i * 0.15));      // stars
for (let i = 0; i < 10; i++) click(20.95 + i * 0.1, 0.5);                  // progress ticks
[24.25, 24.45, 24.7].forEach((t) => click(t));                             // key clicks z, h, Enter
[7.28, 11.25, 22.05, 24.78].forEach((t) => chime(t));                      // right answers
chime(27.98, 1.2);                                                         // celebrate landing
[6.62, 10.25].forEach(boop);                                               // wrong tone, wrong stroke
[2.3, 4.8, 8.8, 11.3, 15.3, 20.3, 23.3].forEach((t) => whoosh(t));         // transitions
whoosh(26.3, 0.75);

// ---------- master: fades + soft clip, write WAV ----------
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (DUR - t) / 1.2));
  L[i] = Math.tanh(L[i] * g * 2.8) * 0.89; R[i] = Math.tanh(R[i] * g * 2.8) * 0.89;
}
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8); out.write("fmt ", 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
}
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "video", "assets", "audio", "promo-mix.wav");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, out);
console.log("wrote", dest, (out.length / 1e6).toFixed(1), "MB");
