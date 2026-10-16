import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { KeyMap } from "@/components/guides/KeyMap";
import { Cta, Hero, Section, Sources } from "@/components/guides/Section";
import { guideGraph, JsonLd, pageMeta } from "@/lib/seo";

const PATH = "/zhuyin-keyboard";
const TITLE = "Zhuyin keyboard: type Chinese with Bopomofo (layout and setup)";
const DESCRIPTION =
  "How the Zhuyin (Bopomofo, 注音) keyboard works: the standard Dachen layout, the tone keys, and setup on Windows, macOS, iPhone and Android.";

export const metadata: Metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION });

const TONE_KEYS = [
  ["Space", "Tone 1", "no mark"],
  ["6", "Tone 2", "ˊ"],
  ["3", "Tone 3", "ˇ"],
  ["4", "Tone 4", "ˋ"],
  ["7", "Neutral tone", "˙"],
];

const STRUCTURED = guideGraph({ path: PATH, title: TITLE, description: DESCRIPTION, crumb: "Zhuyin keyboard" });

export default function Page() {
  return (
    <>
      <JsonLd data={STRUCTURED} />
      <Hero
        crumb="Zhuyin keyboard"
        title="The Zhuyin keyboard"
        lead="On a Zhuyin keyboard, each key types one Bopomofo symbol. You type the sounds of a syllable, then its tone, and the computer offers the matching Chinese characters."
        bear="/mascot/bobo-thinking.webp"
      />

      <Section id="layout" title="The standard layout" wide>
        <p>
          Almost every Zhuyin keyboard uses the standard layout, also called Dachen (大千). The symbols run down the
          columns of the keyboard in chart order: ㄅㄆㄇㄈ go down the first column, ㄉㄊㄋㄌ down the second. Focus the
          map and type on your own keyboard, or press its keys.
        </p>
        <KeyMap />
      </Section>

      <Section id="tones" title="The tone keys" tone="f-night">
        <p>A syllable ends with its tone key. The tone key also tells the computer that the syllable is complete.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Tone</th>
                <th scope="col">Mark</th>
              </tr>
            </thead>
            <tbody>
              {TONE_KEYS.map(([k, t, m]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{t}</td>
                  <td className="zh" lang="zh-TW">
                    {m}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="type" title="How to type 你好">
        <ol>
          <li>Switch to your Zhuyin keyboard (see the setup steps below).</li>
          <li>
            Type <kbd>s</kbd> <kbd>u</kbd> <kbd>3</kbd>. That is ㄋ ㄧ ˇ, the syllable nǐ.
          </li>
          <li>
            Type <kbd>c</kbd> <kbd>l</kbd> <kbd>3</kbd>. That is ㄏ ㄠ ˇ, the syllable hǎo.
          </li>
          <li>The keyboard shows 你好. If it picked the wrong character, move to it and choose another one.</li>
          <li>
            Press <kbd>Enter</kbd> to confirm the text.
          </li>
        </ol>
        <p>
          The keyboard picks characters from the whole phrase, so type a few syllables before you correct anything. If
          you do not know a symbol yet, learn it on the{" "}
          <Link className="link" href="/bopomofo-chart">
            Bopomofo chart
          </Link>
          .
        </p>
      </Section>

      <Section id="setup" title="Add a Zhuyin keyboard" tone="f-night">
        <h3>Windows 10 and 11</h3>
        <ol>
          <li>Open Settings, then Time &amp; language, then Language &amp; region.</li>
          <li>Add the language Chinese (Traditional, Taiwan). It includes Microsoft Bopomofo.</li>
          <li>
            Press <kbd>Win</kbd> + <kbd>Space</kbd> to switch keyboards. <kbd>Shift</kbd> switches between Chinese and
            English.
          </li>
        </ol>
        <h3>macOS</h3>
        <ol>
          <li>Open System Settings, then Keyboard, then Text Input, and select Edit.</li>
          <li>Add an input source: Chinese, Traditional, then Zhuyin.</li>
          <li>
            Switch with the Globe key or <kbd>Control</kbd> + <kbd>Space</kbd>.
          </li>
        </ol>
        <h3>iPhone and iPad</h3>
        <ol>
          <li>Open Settings, then General, then Keyboard, then Keyboards.</li>
          <li>Select Add New Keyboard, then Chinese, Traditional, then Zhuyin.</li>
          <li>Press the globe key on the keyboard to switch.</li>
        </ol>
        <h3>Android</h3>
        <ol>
          <li>Install or open Gboard, then open its Settings and Languages.</li>
          <li>Add Chinese (Traditional, Taiwan) and select the Zhuyin layout.</li>
          <li>Press the globe key, or hold the space bar, to switch.</li>
        </ol>
        <p className="small">The menu names change a little between system versions.</p>
      </Section>

      <Section id="photo" title="On a real keyboard">
        <figure className="g-figure">
          <Image
            src="/landing/mtr-keyboard-2.jpg"
            alt="A white keyboard with Bopomofo symbols printed on the keys."
            width={1920}
            height={1080}
            sizes="(max-width: 60em) 100vw, 55vw"
          />
          <figcaption>
            Keyboards sold in Taiwan print the symbols on the keys. Photo:{" "}
            <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=81260998">
              Cangjie6
            </a>
            , CC BY-SA 4.0, via Wikimedia Commons.
          </figcaption>
        </figure>
        <p>
          Other layouts exist, such as Eten (倚天) and Hsu (許氏). They put the symbols on different keys. Start with
          the standard layout: it matches the printed keys.
        </p>
      </Section>

      <Cta />
      <Sources
        items={[
          {
            label: "vChewing manual: Zhuyin keyboard layouts",
            href: "https://vchewing.github.io/manual/arranges.html",
          },
          {
            label: "Ministry of Education, Taiwan: Mandarin Phonetic Symbols manual",
            href: "https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/html_en/index.html",
          },
          { label: "Wikipedia: Bopomofo", href: "https://en.wikipedia.org/wiki/Bopomofo" },
        ]}
      />
    </>
  );
}
