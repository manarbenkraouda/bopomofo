import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PlaySound } from "@/components/guides/PlaySound";
import { Cta, Hero, Section, Sources } from "@/components/guides/Section";
import { guideGraph, JsonLd, pageMeta } from "@/lib/seo";
import { syllableAudio } from "@/lib/zhuyin";

const PATH = "/what-is-bopomofo";
const TITLE = "What is Bopomofo? Zhuyin (注音), Taiwan’s phonetic alphabet";
const DESCRIPTION =
  "Bopomofo (Zhuyin, 注音) is Taiwan’s phonetic alphabet for Mandarin: 37 symbols and 4 tone marks. Its name, how it works, its history, and Bopomofo vs pinyin.";

export const metadata: Metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION });

const ANSWER =
  "Bopomofo is the phonetic alphabet that Taiwan uses to teach and type Mandarin Chinese. It has 37 symbols: 21 for the first consonant of a syllable and 16 for the vowels and endings. Four marks show the tones. Its official name is Zhuyin fuhao (注音符號, “phonetic symbols”), or Zhuyin for short. The name Bopomofo comes from its first four symbols: ㄅ ㄆ ㄇ ㄈ (b, p, m, f).";

const EXAMPLES = [
  { id: "s001", char: "媽", zhuyin: "ㄇㄚ", pinyin: "mā", meaning: "mother" },
  { id: "s011", char: "你", zhuyin: "ㄋㄧˇ", pinyin: "nǐ", meaning: "you" },
  { id: "s012", char: "好", zhuyin: "ㄏㄠˇ", pinyin: "hǎo", meaning: "good" },
  { id: "s013", char: "我", zhuyin: "ㄨㄛˇ", pinyin: "wǒ", meaning: "I, me" },
  { id: "s033", char: "想", zhuyin: "ㄒㄧㄤˇ", pinyin: "xiǎng", meaning: "to want, to think" },
  { id: "s016", char: "學", zhuyin: "ㄒㄩㄝˊ", pinyin: "xué", meaning: "to learn" },
];

const QUESTIONS = [
  {
    q: "Is Bopomofo the same as Zhuyin?",
    a: "Yes. Zhuyin fuhao (注音符號) is the official name. Bopomofo is the common name, made from the sounds of its first four symbols, ㄅ ㄆ ㄇ ㄈ. People in Taiwan usually just say 注音 (zhùyīn).",
  },
  {
    q: "Is Bopomofo used in mainland China?",
    a: "Not in daily life. Mainland China teaches Mandarin with Hanyu Pinyin, which it adopted in 1958. Some mainland dictionaries still print Zhuyin next to pinyin. Taiwan is where children, books and keyboards use Bopomofo every day.",
  },
  {
    q: "Should I learn Bopomofo or pinyin?",
    a: "Learn Bopomofo if you want Taiwan Mandarin, Taiwanese textbooks, or the keyboards that people in Taiwan use. Each symbol is one sound, so it does not borrow the habits of English letters. Many learners know pinyin too, because maps, signs and names use it.",
  },
  {
    q: "How long does it take to learn Bopomofo?",
    a: "The set is small: 37 symbols and 4 tone marks. Children in Taiwan learn it in the first weeks of grade 1, before they read characters. With short daily practice, an adult can read all of the symbols in a few weeks.",
  },
  {
    q: "Is Bopomofo only for Mandarin?",
    a: "Mostly. Extra symbols for Taiwanese Hokkien and Hakka also exist, and Unicode has a Bopomofo Extended block for them. The 37 standard symbols write Mandarin.",
  },
  {
    q: "Can I type Chinese with Bopomofo?",
    a: "Yes. Windows, macOS, iOS and Android all have a Zhuyin keyboard. You type the symbols and the tone of each syllable, and the computer offers the matching characters.",
  },
];

const STRUCTURED = guideGraph({
  path: PATH,
  title: TITLE,
  description: DESCRIPTION,
  crumb: "What is Bopomofo?",
  extra: [
    {
      "@type": "FAQPage",
      mainEntity: [{ q: "What is Bopomofo?", a: ANSWER }, ...QUESTIONS].map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
});

export default function Page() {
  return (
    <>
      <JsonLd data={STRUCTURED} />
      <Hero crumb="What is Bopomofo?" title="What is Bopomofo?" lead={ANSWER} bear="/mascot/bobo-reading.webp">
        <p className="zh big-syms" lang="zh-TW" aria-hidden="true">
          ㄅ ㄆ ㄇ ㄈ
        </p>
      </Hero>

      <Section id="facts" title="The facts">
        <ul>
          <li>
            <b>Other names:</b> Zhuyin, Zhuyin fuhao, 注音, 注音符號, and in Unicode, Bopomofo.
          </li>
          <li>
            <b>Symbols:</b> 37. There are 21 initials (ㄅ to ㄙ), 3 medials (ㄧ ㄨ ㄩ) and 13 finals (ㄚ to ㄦ). See the{" "}
            <Link className="link" href="/bopomofo-chart">
              full Bopomofo chart
            </Link>
            .
          </li>
          <li>
            <b>Tones:</b> tone 1 has no mark. Tones 2, 3 and 4 use ˊ ˇ ˋ, and the neutral tone uses ˙. See{" "}
            <Link className="link" href="/bopomofo-tones">
              Bopomofo tones
            </Link>
            .
          </li>
          <li>
            <b>Language:</b> Mandarin Chinese, as spoken and taught in Taiwan.
          </li>
          <li>
            <b>Made:</b> 1913, by the Commission on the Unification of Pronunciation. Published officially in 1918.
          </li>
          <li>
            <b>Used for:</b> teaching children to read, notes beside characters in books, dictionaries, and{" "}
            <Link className="link" href="/zhuyin-keyboard">
              typing on a Zhuyin keyboard
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section id="name" title="Where the name comes from" tone="f-night">
        <p>
          The first four symbols of the chart are ㄅ ㄆ ㄇ ㄈ. Teachers read them as “bo, po, mo, fo”, so learners of
          English call the whole system Bopomofo, much as “alphabet” comes from alpha and beta.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Sound</th>
                <th scope="col">Read as</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["ㄅ", "b", "bo"],
                ["ㄆ", "p", "po"],
                ["ㄇ", "m", "mo"],
                ["ㄈ", "f", "fo"],
              ].map(([z, s, r]) => (
                <tr key={z}>
                  <td className="zh" lang="zh-TW">
                    {z}
                  </td>
                  <td>{s}</td>
                  <td>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          注音 means “to note the sound”. Most symbols come from old forms or parts of Chinese characters. For example,
          ㄅ comes from 勹.
        </p>
      </Section>

      <Section id="how" title="How a syllable is written">
        <p>
          A Mandarin syllable has up to three sounds: an initial, a medial and a final. Bopomofo writes each sound with
          one symbol, then adds the tone mark. So a syllable needs one to three symbols, never more.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Character</th>
                <th scope="col">Bopomofo</th>
                <th scope="col">Pinyin</th>
                <th scope="col">Meaning</th>
                <th scope="col">
                  <span className="sr-only">Listen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map((e) => (
                <tr key={e.id}>
                  <td className="zh" lang="zh-TW">
                    {e.char}
                  </td>
                  <td className="zh" lang="zh-TW">
                    {e.zhuyin}
                  </td>
                  <td>{e.pinyin}</td>
                  <td>{e.meaning}</td>
                  <td>
                    <PlaySound src={syllableAudio(e.id)} label={"Play " + e.char + " (" + e.pinyin + ")"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          In 學 ㄒㄩㄝˊ, ㄒ is the initial (x), ㄩ is the medial (ü), ㄝ is the final (e), and ˊ is tone 2. In pinyin
          the same syllable is xué, and the ü loses its dots. Bopomofo keeps one symbol for one sound.
        </p>
      </Section>

      <Section id="where" title="Where Taiwan uses it" tone="f-night">
        <ul>
          <li>
            <b>School.</b> Children in Taiwan learn Bopomofo in the first weeks of grade 1, before they learn
            characters.
          </li>
          <li>
            <b>Books.</b> Children’s books and newspapers print small symbols beside each character, so a child can read
            words they cannot yet recognize.
          </li>
          <li>
            <b>Keyboards.</b> Most keyboards sold in Taiwan have the symbols printed on the keys, and many people type
            Chinese with them.
          </li>
          <li>
            <b>Dictionaries.</b> Taiwanese dictionaries give the Bopomofo of every entry, and some sort entries in
            Bopomofo order.
          </li>
          <li>
            <b>Signs and names.</b> You see it on shop signs, in puns, and in nicknames, because everyone knows it.
          </li>
        </ul>
        <figure className="g-figure">
          <Image
            src="/landing/shop-sign-in-chinese-with-bopomofo.jpg"
            alt="A shop sign. Small Bopomofo symbols sit beside the large Chinese characters."
            width={1920}
            height={978}
            sizes="(max-width: 60em) 100vw, 55vw"
          />
          <figcaption>
            A shop sign with Bopomofo. Photo:{" "}
            <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=50632868">
              Hippietrail
            </a>
            , CC BY-SA 4.0, via Wikimedia Commons.
          </figcaption>
        </figure>
      </Section>

      <Section id="history" title="A short history">
        <ol>
          <li>
            <b>1913.</b> The Commission on the Unification of Pronunciation (讀音統一會) meets in Beijing. It sets a
            standard pronunciation and designs a set of phonetic letters, then called 注音字母.
          </li>
          <li>
            <b>1918.</b> The Ministry of Education of the Republic of China publishes the symbols officially.
          </li>
          <li>
            <b>1930.</b> The name changes to 注音符號, “phonetic symbols”.
          </li>
          <li>
            <b>1958.</b> The People’s Republic of China adopts Hanyu Pinyin. Taiwan keeps Bopomofo for teaching.
          </li>
          <li>
            <b>2009.</b> Hanyu Pinyin becomes Taiwan’s official romanization, for names and signs. Schools still teach
            reading with Bopomofo.
          </li>
        </ol>
      </Section>

      <Section id="vs-pinyin" title="Bopomofo or pinyin?" tone="f-night" wide>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">Bopomofo (Zhuyin)</th>
                <th scope="col">Hanyu Pinyin</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Script</th>
                <td>Its own 37 symbols</td>
                <td>Latin letters</td>
              </tr>
              <tr>
                <th scope="row">Where it is used</th>
                <td>Taiwan: schools, books, keyboards</td>
                <td>Mainland China, and Taiwan’s signs and names</td>
              </tr>
              <tr>
                <th scope="row">One sound, one symbol</th>
                <td>Yes</td>
                <td>Not always: i and u spell more than one sound</td>
              </tr>
              <tr>
                <th scope="row">Tone 1</th>
                <td>No mark</td>
                <td>ā (macron)</td>
              </tr>
              <tr>
                <th scope="row">Neutral tone</th>
                <td>˙ before the syllable</td>
                <td>No mark</td>
              </tr>
              <tr>
                <th scope="row">Example: 學</th>
                <td className="zh" lang="zh-TW">
                  ㄒㄩㄝˊ
                </td>
                <td>xué</td>
              </tr>
              <tr>
                <th scope="row">English habits</th>
                <td>None to unlearn</td>
                <td>Letters like q, x and zh read differently</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="faq" title="Questions">
        {QUESTIONS.map((f) => (
          <div key={f.q}>
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </div>
        ))}
      </Section>

      <Cta />
      <Sources
        items={[
          {
            label: "Ministry of Education, Taiwan: Mandarin Phonetic Symbols manual",
            href: "https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/html_en/index.html",
          },
          {
            label: "Ministry of Education, Taiwan: 國語注音符號手冊",
            href: "https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/html_ch/index.html",
          },
          {
            label: "Bureau of Consular Affairs: Hanyu Pinyin in Taiwan",
            href: "https://www.boca.gov.tw/fp-2-8194-ee028-1.html",
          },
          {
            label: "Taipei Times (2008): Hanyu Pinyin to be standard in 2009",
            href: "https://www.taipeitimes.com/News/taiwan/archives/2008/09/18/2003423528",
          },
          {
            label: "Taipei Times (2009): Hanyu Pinyin now official",
            href: "https://www.taipeitimes.com/News/front/archives/2009/01/03/2003432775",
          },
          { label: "Wikipedia: Bopomofo", href: "https://en.wikipedia.org/wiki/Bopomofo" },
        ]}
      />
    </>
  );
}
