// Synthesizes the music bed and the sound effects for the promo. No samples, no paid audio.
// Run: node scripts/make-audio.mjs  (writes WAV files to public/audio)
import { writeFileSync, mkdirSync } from "node:fs";

const SR = 44100;
const OUT = new URL("../public/audio/", import.meta.url);
mkdirSync(OUT, { recursive: true });

function writeWav(name, chans) {
  const n = chans[0].length, nc = chans.length;
  const buf = Buffer.alloc(44 + n * nc * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + (i * nc + c) * 2);
  }
  writeFileSync(new URL(name, OUT), buf);
}

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;

function normalize(a, peak) {
  let m = 0; for (const v of a) m = Math.max(m, Math.abs(v));
  const k = m > 0 ? peak / m : 1; for (let i = 0; i < a.length; i++) a[i] *= k; return a;
}
function fadeEdges(a, inS = 0.002, outS = 0.01) {
  const ni = Math.floor(inS * SR), no = Math.floor(outS * SR);
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

// ---------- music bed: 104 BPM, C major, I-vi-IV-V, soft and warm ----------
const S = 1.5; // time stretch: 1 = 30 s cut, 1.5 = 45 s cut. The tempo stays the same.
const BPM = 104, beat = 60 / BPM, bar = beat * 4, DUR = 30 * S;
const N = DUR * SR;
const L = new Float32Array(N), R = new Float32Array(N);
const add = (t0, fn, len, pan = 0) => {
  const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const k = s0 + i; if (k < 0 || k >= N) continue;
    const v = fn(i / SR); L[k] += v * gl; R[k] += v * gr;
  }
};
const pluck = (f, amp, dec) => (t) => amp * Math.exp(-t / dec) * (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / (dec * 0.4)) + 0.12 * Math.sin(TAU * 3 * f * t) * Math.exp(-t / (dec * 0.25))) * Math.min(1, t / 0.004);
const mallet = (f, amp, dec) => (t) => amp * Math.exp(-t / dec) * (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 4 * f * t) * Math.exp(-t / 0.05)) * Math.min(1, t / 0.002);
const padNote = (f, amp, len) => (t) => amp * Math.min(1, t / 0.35) * Math.min(1, (len - t) / 0.4) * (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 1.003 * t) + 0.15 * Math.sin(TAU * 2 * f * t));
const kick = (amp) => (t) => { const f = 45 + 75 * Math.exp(-t / 0.035); return amp * Math.exp(-t / 0.16) * Math.sin(TAU * f * t * 1.0); };
const shaker = (amp) => { let lp = 0; return (t) => { const n = rnd(); const hp = n - lp; lp = n * 0.6 + lp * 0.4; return amp * hp * Math.exp(-t / 0.028) * Math.min(1, t / 0.006); }; };
const snap = (amp) => { let lp = 0; return (t) => { const n = rnd(); lp += 0.35 * (n - lp); return amp * (n - lp) * Math.exp(-t / 0.06) + amp * 0.4 * Math.sin(TAU * 190 * t) * Math.exp(-t / 0.03); }; };

const chords = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]]; // C Am F G
const roots = [36, 33, 29, 31];
const penta = [72, 74, 76, 79, 81, 84];
const melody = [0, 2, 4, 3, 2, 1, 2, -1, 4, 3, 2, 0, 1, 2, 3, -1, 2, 4, 5, 4, 3, 2, 1, -1, 3, 2, 1, 0, 1, 2, 0, -1];
const endT = 26.5 * S; // end card: final chord rings out
const bars = Math.ceil(endT / bar);
for (let b = 0; b < bars; b++) {
  const t0 = b * bar, ch = chords[b % 4];
  if (t0 >= endT) break;
  const len = Math.min(bar, endT - t0) + 0.3;
  ch.forEach((m, i) => add(t0, padNote(midi(m), 0.022, len), len, (i - 1.5) * 0.3));
  const full = t0 >= 2.3 * S; // the groove starts after the first title hit
  for (let q = 0; q < 8; q++) {
    const t = t0 + q * beat / 2; if (t >= endT) break;
    // piano comp on off-beats
    if (q % 2 === 1) ch.slice(0, 3).forEach((m, i) => add(t, pluck(midi(m), 0.035, 0.32), 0.9, (i - 1) * 0.5));
    // pentatonic mallet melody
    const mi = melody[(b * 8 + q) % melody.length];
    if (mi >= 0 && (full || q % 2 === 0)) add(t, mallet(midi(penta[mi]), 0.06, 0.22), 0.8, 0.25);
    if (full) {
      add(t, shaker(q % 2 ? 0.05 : 0.03), 0.12, -0.3);
      if (q === 0 || q === 4 || q === 5 && b % 2) add(t, kick(0.42), 0.5);
      if (q === 2 || q === 6) add(t, snap(0.09), 0.25, 0.1);
      if (q % 2 === 0) add(t, pluck(midi(roots[b % 4] + (q === 4 ? 7 : 0)), 0.14, 0.45), 0.9);
    }
  }
}
// final chord and a soft rising arpeggio on the end card
[48, 60, 64, 67, 72, 76].forEach((m, i) => add(endT, padNote(midi(m), 0.03, DUR - endT), DUR - endT, (i - 2.5) * 0.25));
[72, 76, 79, 84, 88].forEach((m, i) => add(endT + i * 0.09, mallet(midi(m), 0.07, 0.6), 2.0, (i - 2) * 0.3));
add(endT, kick(0.4), 0.5);
// master: gentle saturation, fade-in and fade-out
const g = 0.62;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const env = Math.min(1, t / 0.3) * Math.min(1, (DUR - t) / 2.2);
  L[i] = Math.tanh(L[i] * 1.6) * g * env; R[i] = Math.tanh(R[i] * 1.6) * g * env;
}
writeWav("bed.wav", [L, R]);

// ---------- sound effects ----------
const fx = (len, fn, peak) => { const a = new Float32Array(Math.floor(len * SR)); for (let i = 0; i < a.length; i++) a[i] = fn(i / SR); return fadeEdges(normalize(a, peak)); };
let ph = 0;
writeWav("pop.wav", [fx(0.14, (t) => { if (t === 0) ph = 0; const f = 380 + 700 * (1 - Math.exp(-t / 0.03)); ph += TAU * f / SR; return Math.sin(ph) * Math.exp(-t / 0.045) * Math.min(1, t / 0.003); }, 0.7)]);
writeWav("click.wav", [fx(0.05, (t) => (rnd() * 0.6 * Math.exp(-t / 0.004) + Math.sin(TAU * 2400 * t) * Math.exp(-t / 0.008) * 0.5 + Math.sin(TAU * 900 * t) * Math.exp(-t / 0.012) * 0.4), 0.6)]);
const bell = (f, t) => (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 2.01 * t) * Math.exp(-t / 0.25) + 0.2 * Math.sin(TAU * f * 3.02 * t) * Math.exp(-t / 0.12)) * Math.exp(-t / 0.5) * Math.min(1, t / 0.002);
writeWav("chime.wav", [fx(1.3, (t) => bell(midi(84), t) + (t > 0.09 ? bell(midi(91), t - 0.09) : 0), 0.6)]);
writeWav("boop.wav", [fx(0.38, (t) => { const f = 260 - 90 * Math.min(1, t / 0.25); return (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t)) * Math.min(1, t / 0.01) * Math.exp(-t / 0.14); }, 0.6)]);
let lpw = 0;
writeWav("whoosh.wav", [fx(0.45, (t) => { const c = 0.03 + 0.25 * Math.sin(Math.PI * t / 0.45); lpw += c * (rnd() - lpw); return lpw * Math.sin(Math.PI * t / 0.45); }, 0.5)]);
writeWav("tick.wav", [fx(0.06, (t) => Math.sin(TAU * 1760 * t) * Math.exp(-t / 0.012), 0.35)]);
let lpb = 0;
writeWav("brush.wav", [fx(0.45, (t) => { lpb += 0.08 * (rnd() - lpb); return lpb * Math.sin(Math.PI * Math.min(1, t / 0.45)); }, 0.35)]);
writeWav("sparkle.wav", [fx(1.6, (t) => [96, 100, 103, 108].reduce((s, m, i) => s + (t > i * 0.07 ? bell(midi(m), t - i * 0.07) * 0.6 : 0), 0), 0.5)]);
console.log("audio written");

