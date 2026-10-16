import type { Metadata } from "next";
import Link from "next/link";
import { PlaySound } from "@/components/guides/PlaySound";
import { Cta, Hero, Section, Sources } from "@/components/guides/Section";
import { guideGraph, JsonLd, pageMeta } from "@/lib/seo";
import { syllableAudio } from "@/lib/zhuyin";

const PATH = "/bopomofo-tones";
const TITLE = "Bopomofo tones: the 4 Mandarin tones and the neutral tone in Zhuyin";
const DESCRIPTION =
  "How Bopomofo (Zhuyin) marks the Mandarin tones: no mark for tone 1, then ˊ ˇ ˋ ˙. Hear 媽 麻 馬 罵, see each pitch contour, and learn how tones change.";

export const metadata: Metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION });

// Pitch on the usual 1 to 5 scale (5 is high). Each point is [x, pitch level].
const level = (n: number) => 40 - (n - 1) * 9;
const TONES = [
  {
    n: "1",
    name: "First tone",
    mark: "none",
    pitch: "55",
    points: [
      [8, 5],
      [64, 5],
    ],
    how: "high and flat",
    ex: { id: "s001", char: "媽", zhuyin: "ㄇㄚ", pinyin: "mā", meaning: "mother" },
  },
  {
    n: "2",
    name: "Second tone",
    mark: "ˊ",
    pitch: "35",
    points: [
      [8, 3],
      [64, 5],
    ],
    how: "rises from the middle to high",
    ex: { id: "s002", char: "麻", zhuyin: "ㄇㄚˊ", pinyin: "má", meaning: "hemp; numb" },
  },
  {
    n: "3",
    name: "Third tone",
    mark: "ˇ",
    pitch: "214",
    points: [
      [8, 2],
      [32, 1],
      [64, 4],
    ],
    how: "low, and dips then rises when said alone",
    ex: { id: "s003", char: "馬", zhuyin: "ㄇㄚˇ", pinyin: "mǎ", meaning: "horse" },
  },
  {
    n: "4",
    name: "Fourth tone",
    mark: "ˋ",
    pitch: "51",
    points: [
      [8, 5],
      [64, 1],
    ],
    how: "falls from high to low",
    ex: { id: "s004", char: "罵", zhuyin: "ㄇㄚˋ", pinyin: "mà", meaning: "to scold" },
  },
  {
    n: "˙",
    name: "Neutral tone",
    mark: "˙",
    pitch: "short",
    points: [
      [28, 3],
      [44, 3],
    ],
    how: "short and light; its pitch follows the tone before it",
    ex: { id: "", char: "嗎", zhuyin: "˙ㄇㄚ", pinyin: "ma", meaning: "question word" },
  },
] as const;

function Contour({ points, label }: { points: readonly (readonly [number, number])[]; label: string }) {
  return (
    <svg className="contour" viewBox="0 0 72 44" role="img" aria-label={label}>
      <g className="lines">
        {[1, 2, 3, 4, 5].map((n) => (
          <line key={n} x1="2" x2="70" y1={level(n)} y2={level(n)} />
        ))}
      </g>
      <polyline className="path" points={points.map(([x, n]) => x + "," + level(n)).join(" ")} />
      <circle cx={points[points.length - 1][0]} cy={level(points[points.length - 1][1])} r="4" />
    </svg>
  );
}

const STRUCTURED = guideGraph({ path: PATH, title: TITLE, description: DESCRIPTION, crumb: "Bopomofo tones" });

export default function Page() {
  return (
    <>
      <JsonLd data={STRUCTURED} />
      <Hero
        crumb="Bopomofo tones"
        title="Bopomofo tones"
        lead="Mandarin has four tones and a neutral tone. Bopomofo leaves tone 1 unmarked and writes the others with ˊ ˇ ˋ and ˙. The same sound with a different tone is a different word: ㄇㄚ is mother, ㄇㄚˇ is horse."
        bear="/mascot/bobo-listening.webp"
      >
        <p className="zh big-syms" lang="zh-TW" aria-hidden="true">
          ˉ ˊ ˇ ˋ ˙
        </p>
      </Hero>

      <Section id="marks" title="The five tones" wide>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Tone</th>
                <th scope="col">Mark</th>
                <th scope="col">Pitch</th>
                <th scope="col">Example</th>
                <th scope="col">Pinyin</th>
                <th scope="col">Meaning</th>
                <th scope="col">
                  <span className="sr-only">Listen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {TONES.map((t) => (
                <tr key={t.n}>
                  <th scope="row">{t.name}</th>
                  {t.mark === "none" ? (
                    <td className="small">none</td>
                  ) : (
                    <td className="zh mark" lang="zh-TW">
                      {t.mark}
                    </td>
                  )}
                  <td>
                    <Contour points={t.points} label={t.name + ": " + t.how} /> <span className="small">{t.pitch}</span>
                  </td>
                  <td className="zh" lang="zh-TW">
                    {t.ex.char} {t.ex.zhuyin}
                  </td>
                  <td>{t.ex.pinyin}</td>
                  <td>{t.ex.meaning}</td>
                  <td>
                    {t.ex.id ? (
                      <PlaySound src={syllableAudio(t.ex.id)} label={"Play " + t.ex.char + " (" + t.ex.pinyin + ")"} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          Pitch uses the 1 to 5 scale: 5 is the top of your voice, 1 the bottom. 55 stays high, 35 rises, 214 dips, and
          51 falls.
        </p>
      </Section>

      <Section id="each" title="Each tone in words" tone="f-night">
        {TONES.map((t) => (
          <div key={t.n}>
            <h3>
              {t.name}{" "}
              <span className="zh" lang="zh-TW">
                {t.mark === "none" ? "(no mark)" : t.mark}
              </span>
            </h3>
            <p>
              The voice is {t.how}. Example: <span lang="zh-TW">{t.ex.char}</span> {t.ex.zhuyin} ({t.ex.pinyin}), “
              {t.ex.meaning}”.
            </p>
          </div>
        ))}
      </Section>

      <Section id="placement" title="Where the marks go">
        <ul>
          <li>
            <b>Tone 1 has no mark.</b> Some textbooks print ˉ to teach it, but normal text leaves it out. ㄇㄚ is tone
            1.
          </li>
          <li>
            <b>Vertical text.</b> The symbols run down the right side of each character. The marks for tones 2, 3 and 4
            sit to the top right of the last symbol. The neutral ˙ sits above the first symbol.
          </li>
          <li>
            <b>Horizontal text.</b> The marks for tones 2, 3 and 4 come after the syllable: ㄇㄚˇ. The neutral ˙ comes
            before it: ˙ㄇㄚ.
          </li>
          <li>
            <b>Pinyin is different.</b> Pinyin puts the mark on a vowel (mǎ) and marks tone 1 too (mā), but leaves the
            neutral tone unmarked (ma).
          </li>
        </ul>
      </Section>

      <Section id="sandhi" title="When tones change" tone="f-night">
        <p>
          In speech, some tones change next to other tones. The spelling usually keeps the base tone, and you change it
          when you speak.
        </p>
        <ul>
          <li>
            <b>Two third tones.</b> The first becomes a second tone. 你好 ㄋㄧˇ ㄏㄠˇ is said ní hǎo.
          </li>
          <li>
            <b>The half third tone.</b> Before a tone 1, 2 or 4, a third tone stays low and does not rise again. The
            full dip comes mostly at the end of a phrase.
          </li>
          <li>
            <b>不 (ㄅㄨˋ, not).</b> Before a fourth tone it becomes a second tone: 不要 is said bú yào.
          </li>
          <li>
            <b>一 (ㄧ, one).</b> Before a fourth tone it becomes a second tone (一定, yídìng). Before tones 1, 2 and 3
            it becomes a fourth tone (一起, yìqǐ).
          </li>
        </ul>
        <p>
          You can practise 你好 and 不要 out loud in the{" "}
          <Link className="link" href="/#try">
            speaking demo on the home page
          </Link>
          .
        </p>
      </Section>

      <Section id="tips" title="How to hear and say tones">
        <ol>
          <li>Hum each tone before you say it. The tune matters more than the vowel.</li>
          <li>Exaggerate at first. Make tone 4 a sharp drop and tone 2 a clear question.</li>
          <li>Practise pairs of syllables. Tones are easier to hear next to each other than alone.</li>
          <li>Record yourself, then compare with a native recording.</li>
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
            label: "Ministry of Education, Taiwan: 國語注音符號手冊 (tone mark placement)",
            href: "https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/html_ch/index.html",
          },
          { label: "Wikipedia: Bopomofo", href: "https://en.wikipedia.org/wiki/Bopomofo" },
        ]}
      />
    </>
  );
}
