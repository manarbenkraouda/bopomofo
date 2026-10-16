import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { ChartCard } from "@/components/guides/ChartCard";
import { Cta, Hero, Section, Sources } from "@/components/guides/Section";
import { guideGraph, JsonLd, pageMeta, SITE } from "@/lib/seo";
import { FINALS, INITIALS, MEDIALS, NOTES, PINYIN_OF, symbolAudio, type MoeRow, type StrokeData } from "@/lib/zhuyin";

const PATH = "/bopomofo-chart";
const TITLE = "Bopomofo chart: all 37 Zhuyin symbols with audio and stroke order";
const DESCRIPTION =
  "The full Bopomofo (Zhuyin, 注音) chart: 21 initials, 3 medials and 13 finals. Hear each symbol, see its stroke order, its pinyin and an English sound hint.";

export const metadata: Metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION });

// How a teacher reads each symbol's name (the MOE recordings say these), and a rough English sound.
const SOUND: Record<string, [string, string]> = {
  ㄅ: ["bo", "p in “spin”, no puff of air"],
  ㄆ: ["po", "p in “pin”, with a puff of air"],
  ㄇ: ["mo", "m in “more”"],
  ㄈ: ["fo", "f in “four”"],
  ㄉ: ["de", "t in “stop”, no puff of air"],
  ㄊ: ["te", "t in “top”, with a puff of air"],
  ㄋ: ["ne", "n in “no”"],
  ㄌ: ["le", "l in “law”"],
  ㄍ: ["ge", "k in “skin”, no puff of air"],
  ㄎ: ["ke", "k in “kin”, with a puff of air"],
  ㄏ: ["he", "h, with friction, like “loch”"],
  ㄐ: ["ji", "j in “jeep”, tongue flat"],
  ㄑ: ["qi", "ch in “cheap”, tongue flat"],
  ㄒ: ["xi", "between s and sh, tongue flat"],
  ㄓ: ["zhi", "j in “judge”, tongue curled back"],
  ㄔ: ["chi", "ch in “church”, tongue curled back"],
  ㄕ: ["shi", "sh in “shirt”, tongue curled back"],
  ㄖ: ["ri", "s in “pleasure”, tongue curled back"],
  ㄗ: ["zi", "ds in “kids”"],
  ㄘ: ["ci", "ts in “cats”, with a puff of air"],
  ㄙ: ["si", "s in “sun”"],
  ㄚ: ["a", "a in “father”"],
  ㄛ: ["o", "aw in “saw”"],
  ㄜ: ["e", "u in “duh”, lips spread"],
  ㄝ: ["ê", "e in “bet”"],
  ㄞ: ["ai", "“eye”"],
  ㄟ: ["ei", "ay in “day”"],
  ㄠ: ["ao", "ow in “cow”"],
  ㄡ: ["ou", "o in “go”"],
  ㄢ: ["an", "an in “Khan”"],
  ㄣ: ["en", "en in “taken”"],
  ㄤ: ["ang", "ahng, a as in “father”"],
  ㄥ: ["eng", "ung in “lung”"],
  ㄦ: ["er", "ar in American “are”"],
  ㄧ: ["yi", "ee in “see”"],
  ㄨ: ["wu", "oo in “too”"],
  ㄩ: ["yu", "ee with rounded lips, like German ü"],
};

// Read at module scope, so the chart is static HTML that crawlers and readers get without JavaScript.
const dataDir = path.join(process.cwd(), "public", "data");
const strokes: StrokeData = JSON.parse(readFileSync(path.join(dataDir, "strokes.json"), "utf8"));
const table: MoeRow[] = JSON.parse(readFileSync(path.join(dataDir, "moe-table.json"), "utf8"));
const rowOf = Object.fromEntries(table.map((r) => [r.sym, r]));
const ALL = [...INITIALS, ...MEDIALS, ...FINALS];

const STRUCTURED = guideGraph({
  path: PATH,
  title: TITLE,
  description: DESCRIPTION,
  crumb: "Bopomofo chart",
  extra: [
    {
      "@type": "DefinedTermSet",
      "@id": SITE + PATH + "#symbols",
      name: "Bopomofo (Zhuyin) symbols",
      description: "The 37 symbols of Bopomofo, the phonetic alphabet of Taiwan Mandarin.",
      inLanguage: "zh-TW",
      hasDefinedTerm: ALL.map((s) => ({
        "@type": "DefinedTerm",
        name: s,
        termCode: PINYIN_OF[s],
        description:
          "Bopomofo symbol " +
          s +
          ". Pinyin " +
          PINYIN_OF[s] +
          ". Read as " +
          SOUND[s][0] +
          ". Sounds like " +
          SOUND[s][1] +
          ".",
        inDefinedTermSet: SITE + PATH + "#symbols",
      })),
    },
  ],
});

function Cards({ symbols }: { symbols: string[] }) {
  return (
    <ul className="chart">
      {symbols.map((s) => (
        <ChartCard
          key={s}
          sym={s}
          pinyin={PINYIN_OF[s]}
          saidAs={SOUND[s][0]}
          strokes={strokes[s]}
          count={rowOf[s].strokes}
          note={NOTES[s]}
          audio={symbolAudio(rowOf[s])}
        />
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <>
      <JsonLd data={STRUCTURED} />
      <Hero
        crumb="Bopomofo chart"
        title="The Bopomofo chart"
        lead="All 37 Zhuyin symbols: 21 initials, 3 medials and 13 finals. Press a symbol to hear the Ministry of Education recording and watch its stroke order."
        bear="/mascot/bobo-writing.webp"
      />

      <Section id="initials" title="21 initials" wide>
        <p>
          Initials are the consonants that start a syllable. The chart groups them by where the mouth makes the sound:
          the lips (ㄅㄆㄇㄈ), the tongue tip (ㄉㄊㄋㄌ), the back of the tongue (ㄍㄎㄏ), the flat tongue (ㄐㄑㄒ), the
          curled tongue (ㄓㄔㄕㄖ), and the teeth (ㄗㄘㄙ).
        </p>
        <Cards symbols={INITIALS} />
      </Section>

      <Section id="medials" title="3 medials" tone="f-night" wide>
        <p>
          The medials ㄧ ㄨ ㄩ can sit between an initial and a final, as in ㄒㄧㄤ (xiang). They can also stand alone,
          or be the only vowel, as in ㄋㄧˇ (nǐ).
        </p>
        <Cards symbols={MEDIALS} />
      </Section>

      <Section id="finals" title="13 finals" wide>
        <p>
          Finals are the vowels and endings: four simple vowels (ㄚㄛㄜㄝ), four vowel pairs (ㄞㄟㄠㄡ), four nasal
          endings (ㄢㄣㄤㄥ), and ㄦ.
        </p>
        <Cards symbols={FINALS} />
      </Section>

      <Section id="table" title="The chart as a table" tone="f-night" wide>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Pinyin</th>
                <th scope="col">Read as</th>
                <th scope="col">Sounds like</th>
                <th scope="col">Strokes</th>
              </tr>
            </thead>
            <tbody>
              {ALL.map((s) => (
                <tr key={s}>
                  <td className="zh" lang="zh-TW">
                    {s}
                  </td>
                  <td>{PINYIN_OF[s]}</td>
                  <td>{SOUND[s][0]}</td>
                  <td>{SOUND[s][1]}</td>
                  <td>{rowOf[s].strokes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          The English sounds are near matches. Listen to the recordings for the real sound. Symbol audio and stroke
          data: Ministry of Education, Taiwan, CC BY 4.0.
        </p>
      </Section>

      <Section id="learn" title="How to learn the chart">
        <ol>
          <li>Learn the symbols in chart order. The order groups sounds that the mouth makes in the same place.</li>
          <li>Say each symbol aloud as you write it. Writing in stroke order helps you remember the shape.</li>
          <li>Learn the pairs that differ only by a puff of air: ㄅ/ㄆ, ㄉ/ㄊ, ㄍ/ㄎ, ㄐ/ㄑ, ㄓ/ㄔ, ㄗ/ㄘ.</li>
          <li>Read whole syllables soon, with tones. A symbol alone is not a word.</li>
        </ol>
      </Section>

      <Cta />
      <Sources
        items={[
          {
            label: "Ministry of Education, Taiwan: Mandarin Phonetic Symbols manual",
            href: "https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/html_en/index.html",
          },
          {
            label: "Ministry of Education, Taiwan: 國語注音符號手冊 (stroke order and notes)",
            href: "https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/html_ch/index.html",
          },
          { label: "Wikipedia: Bopomofo", href: "https://en.wikipedia.org/wiki/Bopomofo" },
        ]}
      />
    </>
  );
}
