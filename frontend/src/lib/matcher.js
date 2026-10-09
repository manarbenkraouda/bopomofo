// Stroke comparison engine for Bopomofo (Zhuyin) handwriting.
// Coordinates use the MOE data space: a 2150 x 2150 box, y grows downward.

export const BOX = 2150;
const N = 24;
const OK = 0.13;        // mean point distance / glyph size: good stroke
const ROUGH = 0.24;     // acceptable but needs correction
const MAX = 0.36;       // above this, the stroke does not match
const MISSING = 0.6;
const EXTRA = 0.6;
const JOIN = 0.08;

export const TONE_MARKS = ["ˊ", "ˇ", "ˋ", "˙"];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

export function resample(pts, n = N) {
  if (pts.length === 0) return [];
  const L = pathLength(pts);
  if (pts.length === 1 || L === 0) return Array.from({ length: n }, () => [...pts[0]]);
  const step = L / (n - 1);
  const out = [[...pts[0]]];
  let target = step, walked = 0;
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const a = pts[i - 1], b = pts[i], seg = dist(a, b);
    while (seg > 0 && walked + seg >= target - 1e-9 && out.length < n) {
      const t = (target - walked) / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      target += step;
    }
    walked += seg;
  }
  while (out.length < n) out.push([...pts[pts.length - 1]]);
  return out;
}

function bbox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = x1 - x0, h = y1 - y0;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(w, h, BOX * 0.12) };
}

// Template definitions: symbol -> list of strokes (centerline tracks, in drawing direction).
export function buildTemplates(strokeData) {
  const t = {};
  for (const [ch, strokes] of Object.entries(strokeData)) {
    if (ch === "¯") continue;
    t[ch] = [{ variant: "MOE", strokes: strokes.map((s) => s.track) }];
  }
  // MOE: in horizontal text ㄧ is a horizontal line; a vertical ㄧ is the vertical-text form.
  if (t["ㄧ"]) t["ㄧ"].push({ variant: "vertical", strokes: [[[1075, 190], [1075, 1840]]] });
  return t;
}

// Transform that maps template coordinates onto the user's coordinates.
function frames(user, tpl) {
  const bu = bbox(user), bt = bbox(tpl);
  const scale = bu.size / bt.size;
  return [
    { name: "box", scale: 1, tx: 0, ty: 0 },
    { name: "fit", scale, tx: bu.cx - bt.cx * scale, ty: bu.cy - bt.cy * scale },
  ];
}

const apply = (f, pts) => pts.map(([x, y]) => [x * f.scale + f.tx, y * f.scale + f.ty]);

function strokeCost(u, t, D) {
  let fwd = 0, rev = 0;
  for (let k = 0; k < N; k++) {
    fwd += dist(u[k], t[k]);
    rev += dist(u[N - 1 - k], t[k]);
  }
  return { fwd: fwd / N / D, rev: rev / N / D };
}

// Compare user strokes (arrays of [x, y] in BOX space) to one template variant.
export function compareToTemplate(userStrokes, tplStrokes) {
  const user = userStrokes.filter((s) => s.length > 0);
  if (user.length === 0) return null;
  let best = null;
  for (const f of frames(user, tplStrokes)) {
    const tpl = tplStrokes.map((s) => apply(f, s));
    const D = bbox(tpl).size;
    const uR = user.map((s) => resample(s));
    const uLen = user.map((s) => pathLength(s));
    const units = tpl.map((s, i) => ({ from: i, to: i, pts: resample(s), len: pathLength(s) }));
    for (let k = 0; k + 1 < tpl.length; k++) {
      units.push({ from: k, to: k + 1, pts: resample([...tpl[k], ...tpl[k + 1]]), len: pathLength(tpl[k]) + pathLength(tpl[k + 1]) });
    }
    const costs = uR.map((u) => units.map((un) => strokeCost(u, un.pts, D)));
    const used = new Array(tpl.length).fill(false);
    let local = { total: Infinity, assign: null };
    const pick = [];
    const search = (j, acc) => {
      if (acc >= local.total) return;
      if (j === uR.length) {
        const missing = used.filter((x) => !x).length;
        const total = acc + missing * MISSING;
        if (total < local.total) local = { total, assign: [...pick] };
        return;
      }
      units.forEach((un, ui) => {
        for (let i = un.from; i <= un.to; i++) if (used[i]) return;
        const c = costs[j][ui];
        const m = Math.min(c.fwd, c.rev);
        if (m > MAX) return;
        // A joined stroke must fit well and cover both strokes.
        if (un.from !== un.to && (m > OK || uLen[j] < un.len * 0.8)) return;
        for (let i = un.from; i <= un.to; i++) used[i] = true;
        pick.push(ui);
        search(j + 1, acc + m + (un.from !== un.to ? JOIN : 0));
        pick.pop();
        for (let i = un.from; i <= un.to; i++) used[i] = false;
      });
      pick.push(-1);
      search(j + 1, acc + EXTRA);
      pick.pop();
    };
    search(0, 0);
    const score = local.total / Math.max(tpl.length, uR.length);
    if (!best || score < best.score) best = { score, frame: f, tpl, D, units, costs, assign: local.assign, user };
  }
  return best;
}

export function recognize(userStrokes, templates, candidates) {
  const ranked = [];
  for (const ch of candidates) {
    for (const v of templates[ch] || []) {
      const r = compareToTemplate(userStrokes, v.strokes);
      if (r) ranked.push({ ch, variant: v.variant, score: r.score });
    }
  }
  ranked.sort((a, b) => a.score - b.score);
  const seen = new Set();
  return ranked.filter((r) => (seen.has(r.ch) ? false : seen.add(r.ch)));
}

function dirWord(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const h = dx > 0 ? "left to right" : "right to left";
  const v = dy > 0 ? "top to bottom" : "bottom to top";
  if (Math.abs(dx) > 2 * Math.abs(dy)) return h;
  if (Math.abs(dy) > 2 * Math.abs(dx)) return v;
  return (dy > 0 ? "top" : "bottom") + "-" + (dx > 0 ? "left" : "right") + " to " + (dy > 0 ? "bottom" : "top") + "-" + (dx > 0 ? "right" : "left");
}

function shapeHint(u, t, D, reversed) {
  const uu = reversed ? [...u].reverse() : u;
  const lr = pathLength(uu) / Math.max(pathLength(t), 1);
  if (pathLength(t) > D * 0.12) {
    if (lr < 0.7) return "too short";
    if (lr > 1.4) return "too long";
  }
  let dx = 0, dy = 0;
  for (let k = 0; k < N; k++) { dx += uu[k][0] - t[k][0]; dy += uu[k][1] - t[k][1]; }
  dx /= N * D; dy /= N * D;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.08) {
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "too far right" : "too far left") : (dy > 0 ? "too low" : "too high");
  }
  return "the shape or angle is off";
}

function longestIncreasing(seq) {
  const n = seq.length, len = new Array(n).fill(1), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  let end = len.indexOf(Math.max(...len));
  const keep = new Set();
  while (end >= 0) { keep.add(end); end = prev[end]; }
  return keep;
}

// Full stroke-level correction of one written symbol against the expected symbol.
export function correctSymbol(userStrokes, expected, templates, candidates) {
  const user = userStrokes.filter((s) => s.length > 0);
  if (user.length === 0) return { expected, empty: true, ok: false, strokes: [], extras: [], messages: ["Nothing written."] };
  let best = null, variant = null;
  for (const v of templates[expected]) {
    const r = compareToTemplate(user, v.strokes);
    if (r && (!best || r.score < best.score)) { best = r; variant = v; }
  }
  const ranking = recognize(user, templates, candidates);
  const recognized = ranking[0]?.ch ?? null;
  const strokes = variant.strokes.map((_, i) => ({ index: i, status: "missing", userIdx: null, hint: null }));
  const extras = [];
  const matched = [];
  best.assign.forEach((ui, j) => {
    if (ui < 0) { extras.push(j); return; }
    const un = best.units[ui], c = best.costs[j][ui];
    const reversed = c.rev < c.fwd && un.len > best.D * 0.15 && c.fwd > OK;
    const cost = Math.min(c.fwd, c.rev);
    for (let i = un.from; i <= un.to; i++) {
      const s = strokes[i];
      s.userIdx = j; s.cost = cost;
      if (un.from !== un.to) { s.status = "joined"; s.joinedWith = i === un.from ? un.to : un.from; continue; }
      s.status = reversed ? "reversed" : cost <= OK ? "ok" : cost <= ROUGH ? "rough" : "wrong";
      if (s.status === "reversed") s.hint = "write it " + dirWord(un.pts[0], un.pts[N - 1]);
      if (s.status === "rough" || s.status === "wrong") s.hint = shapeHint(resample(best.user[j]), un.pts, best.D, c.rev < c.fwd);
    }
    matched.push({ i: un.from, j });
  });
  matched.sort((a, b) => a.i - b.i);
  const keep = longestIncreasing(matched.map((m) => m.j));
  matched.forEach((m, k) => {
    if (keep.has(k)) return;
    strokes[m.i].orderError = true;
  });
  const orderError = strokes.some((s) => s.orderError);
  const userOrder = [...matched].sort((a, b) => a.j - b.j).map((m) => m.i + 1);

  const messages = [];
  const wrongSymbol = recognized && recognized !== expected && ranking[0].score + 0.05 < best.score && best.score > ROUGH;
  if (wrongSymbol) messages.push("This looks like " + recognized + ", but the answer is " + expected + ".");
  if (user.length !== variant.strokes.length) messages.push("You used " + user.length + " stroke" + (user.length > 1 ? "s" : "") + "; " + expected + " has " + variant.strokes.length + ".");
  for (const s of strokes) {
    const n = "Stroke " + (s.index + 1);
    if (s.status === "missing") messages.push(n + " is missing.");
    else if (s.status === "joined" && s.index < s.joinedWith) messages.push("Strokes " + (s.index + 1) + " and " + (s.joinedWith + 1) + " are written as one stroke. Lift the pen between them.");
    else if (s.status === "reversed") messages.push(n + " goes the wrong way: " + s.hint + ".");
    else if (s.status === "rough") messages.push(n + " is close, but " + s.hint + ".");
    else if (s.status === "wrong") messages.push(n + " does not match: " + s.hint + ".");
  }
  if (orderError) messages.push("Stroke order: you wrote " + userOrder.join(" → ") + ". The correct order is " + [...userOrder].sort((a, b) => a - b).join(" → ") + ".");
  for (const j of extras) messages.push("Your stroke " + (j + 1) + " is extra.");
  // A different symbol with no matching strokes: the stroke list adds nothing.
  if (wrongSymbol && strokes.every((s) => s.status === "missing")) messages.splice(1);
  const ok = !wrongSymbol && extras.length === 0 && strokes.every((s) => s.status === "ok" && !s.orderError);
  const nearly = !wrongSymbol && extras.length === 0 && strokes.every((s) => (s.status === "ok" || s.status === "rough") && !s.orderError);
  return { expected, variant: variant.variant, recognized, ranking: ranking.slice(0, 3), score: best.score, frame: best.frame, ok, nearly, strokes, extras, messages };
}

export function splitZhuyin(z) {
  const chars = [...z];
  const tone = chars.find((c) => TONE_MARKS.includes(c)) || "";
  return { symbols: chars.filter((c) => !TONE_MARKS.includes(c)), tone };
}
