// Numbers in Taiwan Mandarin: the characters of a number, its size band, the kind of error, and the quiz choices.
// The backend has the same rules in backend/app/numbers.py. Keep them the same.

export const MAX = 99_999_999;
const DIGITS = "零一二三四五六七八九";
// The size bands are the context of every number answer: the errors change with the size (place words, 零, 萬).
export const BANDS = ["0-10", "11-99", "100-999", "1000-9999", "10000+"] as const;
export type Band = (typeof BANDS)[number];
export const BAND_LABEL: Record<Band, string> = {
  "0-10": "0-10",
  "11-99": "11-99",
  "100-999": "100s",
  "1000-9999": "1000s",
  "10000+": "萬 and up",
};

/** The written (dictionary) Bopomofo of each character a number uses. */
export const NUMBER_ZHUYIN: Record<string, string> = {
  零: "ㄌㄧㄥˊ",
  一: "ㄧ",
  二: "ㄦˋ",
  兩: "ㄌㄧㄤˇ",
  三: "ㄙㄢ",
  四: "ㄙˋ",
  五: "ㄨˇ",
  六: "ㄌㄧㄡˋ",
  七: "ㄑㄧ",
  八: "ㄅㄚ",
  九: "ㄐㄧㄡˇ",
  十: "ㄕˊ",
  百: "ㄅㄞˇ",
  千: "ㄑㄧㄢ",
  萬: "ㄨㄢˋ",
};

/** 1 to 9999. first: the number starts here, so 10-19 is said 十… (not 一十…). */
function small(n: number, first: boolean): string {
  let out = "";
  let zero = false;
  for (const [value, unit] of [
    [1000, "千"],
    [100, "百"],
    [10, "十"],
    [1, ""],
  ] as const) {
    const d = Math.floor(n / value) % 10;
    if (d === 0) {
      zero = zero || out !== "";
      continue;
    }
    if (zero) {
      out += "零";
      zero = false;
    }
    if (value === 10 && d === 1 && !out && first) {
      out += "十";
      continue;
    }
    // Taiwan usage: 兩 before 百 and 千 (兩百, 兩千), 二 in the tens and the units (二十二).
    out += (d === 2 && value >= 100 ? "兩" : DIGITS[d]) + unit;
  }
  return out;
}

/** The characters said for a number from 0 to 99 999 999: 15 -> 十五, 205 -> 兩百零五, 20000 -> 兩萬. */
export function hanzi(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX) throw new Error("number out of range: " + n);
  if (n === 0) return "零";
  const hi = Math.floor(n / 10000);
  const lo = n % 10000;
  if (!hi) return small(lo, true);
  let out = (hi === 2 ? "兩" : small(hi, true)) + "萬";
  if (lo) out += (lo < 1000 ? "零" : "") + small(lo, false);
  return out;
}

export function band(n: number): Band {
  if (n <= 10) return "0-10";
  if (n <= 99) return "11-99";
  if (n <= 999) return "100-999";
  return n <= 9999 ? "1000-9999" : "10000+";
}

/** The kind of a listening error (see ERRORS in backend/app/numbers.py), or null when the answer is right. */
export function errorOf(expected: number, picked: number): string | null {
  if (expected === picked) return null;
  const e = String(expected);
  const p = String(picked);
  const lo = Math.min(expected, picked);
  const hi = Math.max(expected, picked);
  if (lo >= 11 && lo <= 19 && hi === (lo - 10) * 10) return "teens";
  if (e.length === p.length && [...e].sort().join("") === [...p].sort().join("")) return "order";
  if (e.replaceAll("0", "") === p.replaceAll("0", "")) return "place";
  if (e.length === p.length && [...e].filter((c, i) => c !== p[i]).length === 1) return "digit";
  if (lo === 4 && hi === 10) return "4-10";
  return "other";
}

/** Digits with thousands separators: 12345 -> 12,345. */
export const digits = (n: number) => n.toLocaleString("en-US");

const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** Zeros inside a number are a skill of their own (零), so about one number in four from 100 up gets one. */
function withZeros(n: number): number {
  const s = [...String(n)];
  if (s.length < 3 || Math.random() > 0.25) return n;
  const i = rnd(1, s.length - 2);
  s[i] = "0";
  return Number(s.join(""));
}

/** A random number of one band. 10000+ picks the number of digits first (5 to 8), so smaller numbers come up as often as larger ones. */
export function randomIn(b: Band): number {
  if (b === "0-10") return rnd(0, 10);
  if (b === "11-99") return rnd(11, 99);
  if (b === "100-999") return withZeros(rnd(100, 999));
  if (b === "1000-9999") return withZeros(rnd(1000, 9999));
  const len = rnd(5, 8);
  return withZeros(rnd(10 ** (len - 1), 10 ** len - 1));
}

// Without a focus, the bands come up in these shares: the middle sizes carry most of the place words.
const WEIGHT: Record<Band, number> = { "0-10": 1, "11-99": 2, "100-999": 2, "1000-9999": 2, "10000+": 2 };

/** A random band from the given bands (all bands when empty), by weight. */
export function randomBand(bands: readonly Band[] = []): Band {
  const pool = bands.length ? bands : BANDS;
  let r = Math.random() * pool.reduce((s, b) => s + WEIGHT[b], 0);
  for (const b of pool) {
    r -= WEIGHT[b];
    if (r < 0) return b;
  }
  return pool[pool.length - 1];
}

const shuffle = <T>(a: T[]) =>
  a
    .map((x) => [Math.random(), x] as const)
    .sort((p, q) => p[0] - q[0])
    .map((p) => p[1]);

/** The wrong choices that sound or look close: teens and tens, swapped digits, a wrong place, one digit off, 4 and 10. */
export function nearMisses(n: number): number[] {
  const out: number[] = [];
  const s = String(n);
  if (n >= 11 && n <= 19) out.push((n - 10) * 10);
  if (n >= 20 && n <= 90 && n % 10 === 0) out.push(n / 10 + 10);
  for (let i = 0; i + 1 < s.length; i++) {
    if (s[i] === s[i + 1] || (i === 0 && s[1] === "0")) continue;
    out.push(Number(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)));
  }
  out.push(n * 10);
  if (n % 10 === 0) out.push(n / 10);
  // A zero added or dropped inside the number: 205 and 250, 1005 and 1050.
  const zero = s.indexOf("0", 1);
  if (zero > 0) out.push(Number(s.slice(0, zero) + s.slice(zero + 1) + "0"));
  for (let i = s.length - 1; i >= 0; i--) {
    const d = Number(s[i]);
    for (const nd of [d + 1, d - 1]) {
      if (nd < 0 || nd > 9 || (i === 0 && nd === 0 && s.length > 1)) continue;
      out.push(Number(s.slice(0, i) + nd + s.slice(i + 1)));
    }
  }
  if (n === 4) out.push(10);
  if (n === 10) out.push(4);
  return [...new Set(out)].filter((x) => Number.isInteger(x) && x >= 0 && x <= MAX && x !== n);
}

/** Four unique choices with the answer: the closest near misses first, then random numbers of the same band. */
export function choices(n: number): number[] {
  const near = nearMisses(n);
  // The structural mix-ups (teens, order, place) come first; the one-digit changes fill up.
  const strong = shuffle(near.slice(0, Math.max(0, near.length - 2 * String(n).length)));
  const weak = shuffle(near.slice(strong.length));
  const picked = new Set<number>([n]);
  for (const x of [...strong.slice(0, 2), ...weak, ...strong.slice(2)]) {
    if (picked.size >= 4) break;
    picked.add(x);
  }
  for (let guard = 0; picked.size < 4 && guard < 100; guard++) picked.add(randomIn(band(n)));
  return shuffle([...picked]);
}
