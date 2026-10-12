// Safe-zone + Bobo-chest check: seeks the GSAP timeline every 0.25 s and measures visible text / key UI boxes.
// Usage (from promo\hyperframes): node scripts/check-layout.mjs
import puppeteer from "puppeteer-core";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(join(here, "..", "video", "index.html")).href;
const cache = join(os.homedir(), ".cache", "puppeteer", "chrome");
const ver = readdirSync(cache).sort().pop();
const exe = join(cache, ver, "chrome-win64", "chrome.exe");
if (!existsSync(exe)) throw new Error("no chrome at " + exe);

// transition windows (moving content may leave the zone on purpose)
const TRANS = [[2.3, 2.8], [4.8, 5.3], [8.8, 9.3], [11.3, 11.8], [15.3, 15.8], [20.3, 20.8], [23.3, 23.8], [26.3, 27.0]];
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.goto(page_url, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
const problems = [];
for (let t = 0; t <= 30.0001; t += 0.25) {
  const inTrans = TRANS.some(([a, b]) => t >= a && t <= b);
  const res = await page.evaluate((t) => {
    window.__timelines.main.seek(t, false);
    const vis = (el) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") return 0; o *= parseFloat(cs.opacity); } return o; };
    const out = [];
    const skip = (el) => el.closest("[data-layout-ignore], .bg, .ghost, .confetti");
    // text boxes from text nodes
    const walker = document.createTreeWalker(document.getElementById("root"), NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n; (n = walker.nextNode());) {
      if (!n.textContent.trim()) continue; const el = n.parentElement; if (skip(el) || vis(el) < 0.15) continue;
      const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
      if (b.width < 1) continue; texts.push({ what: "text '" + n.textContent.trim().slice(0, 28) + "'", b });
    }
    const ui = [...document.querySelectorAll(".card, .chip, .badge, .cta, .howbtn, .toast, .nametag, .tile-b, .zfloat")]
      .filter((el) => !skip(el) && vis(el) >= 0.15).map((el) => ({ el, what: "ui ." + [...el.classList].join("."), b: el.getBoundingClientRect() }));
    for (const { what, b } of [...texts, ...ui]) {
      if (b.right <= 0 || b.left >= 1080 || b.bottom <= 0 || b.top >= 1920) continue;
      if (b.left < 79 || b.right > 941 || b.top < 239 || b.bottom > 1421)
        out.push("zone " + what + " [" + [b.left, b.top, b.right, b.bottom].map(Math.round).join(",") + "]");
    }
    // Bobo chest: x 30-70 %, y 33-60 % of the visible pose image
    for (const img of document.querySelectorAll(".stage img")) {
      if (vis(img) < 0.15) continue; const r = img.getBoundingClientRect();
      const c = { l: r.left + r.width * 0.3, r: r.left + r.width * 0.7, t: r.top + r.height * 0.33, b: r.top + r.height * 0.6 };
      if (c.r < 0 || c.l > 1080 || c.b < 0 || c.t > 1920) continue;
      if (c.l < 0 || c.r > 1080 || c.t < 0 || c.b > 1920) out.push("chest cropped by frame " + img.alt);
      for (const { el, what, b } of [...texts, ...ui]) {
        if (el && el.contains(img)) continue;
        if (img.closest(".scene") && !img.closest(".scene").contains(document.elementFromPoint((c.l + c.r) / 2, (c.t + c.b) / 2))) {}
        if (b.left < c.r && b.right > c.l && b.top < c.b && b.bottom > c.t) {
          // count only elements stacked above Bobo
          const pt = document.elementFromPoint(Math.max(b.left, c.l) + 2, Math.max(b.top, c.t) + 2);
          if (pt && !img.isSameNode(pt) && !pt.closest(".stage")) out.push("covers chest of '" + img.alt + "': " + what);
        }
      }
    }
    return out;
  }, t);
  for (const m of res) problems.push((inTrans ? "(transition) " : "") + t.toFixed(2) + "s " + m);
}
await browser.close();
const hard = problems.filter((p) => !p.startsWith("(transition)"));
const uniq = (a) => [...new Set(a.map((p) => p.replace(/^\S+ /, "").replace(/^\S+s /, "")))];
console.log("checked 121 timestamps");
console.log("problems outside transitions: " + hard.length);
for (const p of uniq(hard).slice(0, 60)) console.log("  " + p + "  @" + hard.filter((h) => h.endsWith(p)).map((h) => h.split("s ")[0]).slice(0, 6).join(","));
console.log("during transitions: " + (problems.length - hard.length));

