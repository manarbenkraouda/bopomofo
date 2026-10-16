import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata, Viewport } from "next";
import { FAQ } from "@/components/landing/faq";
import { Landing } from "@/components/landing/Landing";
import { DRILL_SYMBOLS, HERO_SYMBOLS, type LandingData } from "@/components/landing/symbols";
import { JsonLd, ORGANIZATION, pageMeta, WEB_APP, WEBSITE } from "@/lib/seo";
import { symbolAudio, type MoeRow, type StrokeData } from "@/lib/zhuyin";

export const metadata: Metadata = pageMeta({
  path: "/",
  title: "bopomofo: learn Bopomofo (Zhuyin 注音) and Taiwan Mandarin",
  description:
    "Learn Bopomofo (Zhuyin, 注音), the phonetic alphabet of Taiwan Mandarin. Read the 37 symbols, write each stroke, hear the 5 tones and say them. Free and open source.",
});

const STRUCTURED = {
  "@context": "https://schema.org",
  "@graph": [
    WEBSITE,
    ORGANIZATION,
    WEB_APP,
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
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
      <JsonLd data={STRUCTURED} />
      {/* The reveals hide content only when this script ran, so the page stays readable without JavaScript. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      <Landing {...data} />
    </>
  );
}
