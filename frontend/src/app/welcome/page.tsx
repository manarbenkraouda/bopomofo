import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata, Viewport } from "next";
import { Landing } from "@/components/landing/Landing";
import { DRILL_SYMBOLS, HERO_SYMBOLS, type LandingData } from "@/components/landing/symbols";
import { symbolAudio, type MoeRow, type StrokeData } from "@/lib/zhuyin";

const TITLE = "bopomofo: learn Taiwan Mandarin, one sound at a time";
const DESCRIPTION =
  "Learn Taiwan Mandarin through Bopomofo (注音). Read the 37 symbols, write each stroke, hear the tones, and say it yourself, with Bobo the bear as your coach.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: "Read 注音. Write each stroke. Hear the difference. Say it yourself.",
    images: [{ url: "/landing/bobo-night-market.jpg", width: 1672, height: 941 }],
  },
};

export const viewport: Viewport = { themeColor: "#141218" };

// Read at module scope, so the symbols are part of the static page and the hero writes itself before hydration.
const dataDir = path.join(process.cwd(), "public", "data");
const strokes: StrokeData = JSON.parse(readFileSync(path.join(dataDir, "strokes.json"), "utf8"));
const table: MoeRow[] = JSON.parse(readFileSync(path.join(dataDir, "moe-table.json"), "utf8"));
const data: LandingData = {
  glyphs: Object.fromEntries([...new Set([...HERO_SYMBOLS, ...DRILL_SYMBOLS])].map((s) => [s, strokes[s]])),
  audio: Object.fromEntries(table.filter((r) => DRILL_SYMBOLS.includes(r.sym)).map((r) => [r.sym, symbolAudio(r)])),
};

// The page for signed-out visitors. The proxy shows it at "/" (see proxy.ts).
export default function Page() {
  return (
    <>
      {/* The reveals hide content only when this script ran, so the page stays readable without JavaScript. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      <Landing {...data} />
    </>
  );
}
