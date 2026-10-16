"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { Glyph, writeTime } from "./Glyph";
import { NameDialog } from "./NameDialog";
import { HERO_SYMBOLS, type LandingData } from "./symbols";
import { TryDrill } from "./TryDrill";
import { useLandingMotion } from "./useLandingMotion";
import "./landing.css";

const GITHUB = "https://github.com/manarbenkraouda/bopomofo";
const COFFEE = "https://buymeacoffee.com/manarbenkraouda";

// The path of ㄅ from the MOE stroke data, as the wordmark.
const MARK =
  "M768 1686 L728 1640 Q717 1630 720 1626 Q723 1622 733 1626 L794 1655 Q927 1721 958.5 1730.5 Q990 1740 1024 1739 Q1095 1737 1162 1684.5 Q1229 1632 1333.5 1476 Q1438 1320 1503.5 1156.5 Q1569 993 1588 919 L1602 860 Q1607 840 1609.5 828 Q1612 816 1611 803 Q1609 780 1587 754.5 Q1565 729 1510 734 L1301 754 L1060 780 L830 803 Q578 830 455 851 Q332 872 321 871 Q272 870 248 829.5 Q224 789 224 742 Q224 718 230 705.5 Q236 693 263.5 670.5 Q291 648 311.5 627.5 Q332 607 399 523.5 Q466 440 507 363.5 Q548 287 557.5 266 Q567 245 592.5 183 Q618 121 624.5 114 Q631 107 641 105 Q653 104 706 127 Q759 150 782 175.5 Q805 201 805.5 211.5 Q806 222 794 244 L774 282 Q760 307 715 376 Q670 445 601 528 L534 608 Q518 627 509 637 Q500 647 498 652.5 Q496 658 495.5 664.5 Q495 671 508 680 Q521 689 554 686 Q576 685 672 675 Q768 665 1145 632 L1412 609 Q1551 598 1586 589 Q1621 580 1628 580 Q1640 581 1652 587.5 Q1664 594 1694 621 Q1724 648 1736 662 Q1748 676 1774.5 709 Q1801 742 1811.5 758.5 Q1822 775 1822.5 791.5 Q1823 808 1814 832 Q1792 891 1785 912 L1762 981 L1709 1135 Q1693 1182 1651 1282 Q1609 1382 1565.5 1475.5 Q1522 1569 1451 1674.5 Q1380 1780 1271.5 1851 Q1163 1922 1109 1932.5 Q1055 1943 1016 1943 Q961 1945 940.5 1926.5 Q920 1908 889.5 1855.5 Q859 1803 836 1771 Q813 1739 768 1686 Z";

const STORY = [
  "Slide 1: 23 days in a row.",
  "Slide 2: her ear got sharper, from 81 to 85 percent.",
  "Slide 3: the retroflex twins, 94 percent for one and 77 for the other.",
  "Slide 4: a trick to tell the flat twin apart.",
  "Slide 5: tone 4 heard as tone 2.",
  "Slide 6: 36 of 37 symbols known.",
  "Slide 7: today's plan, 5 steps, about 19 minutes.",
  "Slide 8: three goals.",
  "Slide 9: four minutes with the twins, and a Start button.",
];

const FAQ: { q: string; a: string; tone: string; ink: string }[] = [
  {
    q: "Do I need any Chinese?",
    a: "No. Level 1 starts with the first symbol. If you already read some, the placement test puts you higher.",
    tone: "f-deep",
    ink: "#f2ece2",
  },
  {
    q: "Why not just pinyin?",
    a: "Taiwan teaches reading with bopomofo, and each symbol is one sound. You still type pinyin in the Recognize drill, because your keyboard already has those letters.",
    tone: "f-paper",
    ink: "#141218",
  },
  {
    q: "Is it free?",
    a: "The code is free under AGPL-3.0. If you run your own copy, you pay for your own OpenRouter use. Hosting the app costs money, and a coffee on Buy Me a Coffee helps to pay for it. The speech model is CC BY-NC 4.0, so use it for noncommercial work only.",
    tone: "f-night",
    ink: "#f2ece2",
  },
  {
    q: "Who hears my voice?",
    a: "Speech recognition and the voice run on the bopomofo server's CPU, with ONNX models, so no outside speech service hears you. Sign-in uses Clerk, and personal sentences use OpenRouter.",
    tone: "f-deep",
    ink: "#f2ece2",
  },
  {
    q: "Can I run my own copy?",
    a: "Yes. Windows on ARM64 is tested. The packages for x64 and macOS install, but nobody has run them on real hardware yet.",
    tone: "f-paper",
    ink: "#141218",
  },
];

/** The public front page of the app, for signed-out visitors. Every call to action goes to the real sign-up. */
export function Landing({ glyphs, audio }: LandingData) {
  const root = useRef<HTMLDivElement>(null);
  const { isSignedIn } = useAuth();
  const signedIn = !!isSignedIn;
  useLandingMotion(root);

  // The four hero symbols write one after the other.
  const hero = HERO_SYMBOLS.reduce<{ sym: string; delay: number }[]>((acc, sym, k) => {
    const prev = acc[k - 1];
    acc.push({ sym, delay: prev ? prev.delay + writeTime(glyphs[prev.sym], 5.2, 40) + 100 : 250 });
    return acc;
  }, []);

  return (
    <div className="landing" ref={root}>
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <clipPath id="plum" clipPathUnits="objectBoundingBox">
          <circle cx="0.5" cy="0.52" r="0.3" />
          <circle cx="0.500" cy="0.265" r="0.235" />
          <circle cx="0.743" cy="0.441" r="0.235" />
          <circle cx="0.650" cy="0.726" r="0.235" />
          <circle cx="0.350" cy="0.726" r="0.235" />
          <circle cx="0.257" cy="0.441" r="0.235" />
        </clipPath>
      </svg>

      <header className="top">
        <a className="wordmark" href="#top" aria-label="bopomofo, back to top">
          <svg viewBox="0 0 2150 2150" aria-hidden="true">
            <path d={MARK} />
          </svg>
          <span>bopomofo</span>
        </a>
        <nav className="actions" aria-label="Account">
          {signedIn ? (
            <Link className="button" href="/">
              Open the app{" "}
              <span className="arrow" aria-hidden="true">
                &rarr;
              </span>
            </Link>
          ) : (
            <>
              <Link className="signin link" href="/sign-in">
                Sign in
              </Link>
              <Link className="button" href="/sign-up">
                Start learning{" "}
                <span className="arrow" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            </>
          )}
        </nav>
      </header>

      <main id="top">
        <section className="chapter f-night hero grid" data-ink="#f2ece2" aria-labelledby="hero-title">
          <h1 id="hero-title">
            <span className="l1" aria-hidden="true">
              {hero.map(({ sym, delay }) => (
                <Glyph key={sym} strokes={glyphs[sym]} play delay={delay} rate={5.2} gap={40} className="glyph" />
              ))}
            </span>
            <span className="sr-only">ㄅㄆㄇㄈ </span>
            <span className="l2">bopomofo</span>
          </h1>
          <div className="support">
            <p>
              Learn Taiwan Mandarin, one sound at a time. Read 注音. Write each stroke. Hear the difference. Say it
              yourself.
            </p>
            <div className="acts">
              <Link className="button" href={signedIn ? "/" : "/sign-up"}>
                {signedIn ? "Open the app" : "Start learning"}{" "}
                <span className="arrow" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
              <a className="link-plain" href="#try">
                Try one symbol right now <span aria-hidden="true">&darr;</span>
              </a>
            </div>
          </div>
          <Image
            className="hero-bear"
            src="/landing/bobo-brush.webp"
            alt="Bobo, a Formosan black bear in round glasses, paints one long stroke with a big brush."
            width={1122}
            height={1402}
            sizes="(max-width: 40em) 78vw, 62vw"
            priority
          />
        </section>

        <section className="chapter intro f-deep grid" data-ink="#f2ece2" aria-label="What bopomofo is">
          <h2 className="stair">
            <span data-reveal style={stagger(0)}>
              37 symbols.
            </span>
            <span data-reveal style={stagger(1)}>
              5 tones.
            </span>
          </h2>
          <div className="intro-photos">
            <figure>
              <div className="photo r32 shutter" data-reveal style={stagger(1)}>
                <Image
                  src="/landing/shop-sign-in-chinese-with-bopomofo.jpg"
                  alt="A shop sign. Small bopomofo symbols sit beside the large Chinese characters."
                  width={1920}
                  height={978}
                  sizes="(max-width: 40em) 46vw, 20vw"
                />
              </div>
              <figcaption>On a shop sign, beside the characters. Photo: Hippietrail, CC BY-SA 4.0.</figcaption>
            </figure>
            <figure>
              <div className="photo r32 shutter" data-reveal style={stagger(3)}>
                <Image
                  src="/landing/bopomofo.jpg"
                  alt="The bopomofo symbols written by hand in black ink on white paper."
                  width={1920}
                  height={916}
                  sizes="(max-width: 40em) 46vw, 20vw"
                />
              </div>
              <figcaption>All of them, by hand. Photo: Geographyinitiative, CC BY-SA 4.0.</figcaption>
            </figure>
          </div>
          <p className="intro-note" data-reveal>
            <strong>Taiwan spells every sound with them.</strong> Bopomofo (注音), or zhuyin, is how children in Taiwan
            learn to read. One symbol is one sound, so there is no English spelling to unlearn. You see it in
            children&apos;s books, in dictionaries and on phone keyboards.
          </p>
        </section>

        <TryDrill glyphs={glyphs} audio={audio} />

        <div>
          <section className="chapter write f-night grid" data-ink="#f2ece2" aria-labelledby="write-title">
            <div className="text">
              <h2 id="write-title" data-reveal>
                Every stroke, checked.
              </h2>
              <p data-reveal style={stagger(1)}>
                Draw with a mouse, a pen or a finger. Each stroke is checked against the Ministry&apos;s stroke data:
                order, direction, shape, and missing, extra or joined strokes.
              </p>
              <ol className="beats">
                <li data-at="0">You write ㄆ, first stroke the wrong way.</li>
                <li data-at="2.6">
                  &ldquo;Stroke 1 goes the wrong way: write it top to bottom. Write it again.&rdquo;
                </li>
                <li data-at="6.6">Second try: ㄆ turns green.</li>
                <li data-at="10.8">Next up, ㄇ. Right the first time.</li>
              </ol>
            </div>
            <figure>
              <div className="photo" data-ui>
                <video
                  className="scrub"
                  src="/landing/scrub-dictation.mp4"
                  poster="/landing/scrub-dictation.jpg"
                  muted
                  playsInline
                  preload="auto"
                  loop
                  aria-label="Screen recording of the writing drill: a wrong stroke, the message, then the right answers."
                />
              </div>
              <div className="scrubbar" aria-hidden="true">
                <span />
              </div>
              <figcaption>A real recording of the Dictation drill. Scroll to play it.</figcaption>
            </figure>
          </section>
        </div>

        <section
          className="chapter levels f-seal grid"
          data-ink="#141218"
          data-btn="#141218"
          aria-labelledby="levels-title"
        >
          <h2 id="levels-title" data-reveal>
            Five levels that stay open.
          </h2>
          <div className="copy" data-reveal style={stagger(1)}>
            <p className="lead">
              Start at the first symbol, or take the optional placement test (about 10 minutes) and skip what you
              already know.
            </p>
          </div>
          <ol className="steps">
            {[
              ["Read the alphabet", "37 symbols and 5 tones, by eye and by ear."],
              ["Write the alphabet", "Each stroke, in order, in the right direction."],
              ["Syllables", "Initial, final and tone, put together."],
              ["Words and sentences", "Real words, then sentences about your own life."],
              ["Free speaking", "Talk freely. Each sound gets a check."],
            ].map(([title, body], k) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="n" aria-label={"Level " + (k + 1)}>
                  {k + 1}
                </span>
              </li>
            ))}
            <Image className="bear" src="/mascot/bobo-celebrate.webp" alt="" width={400} height={400} sizes="210px" />
          </ol>
        </section>

        <section className="chapter coach f-deep grid" data-ink="#f2ece2" aria-labelledby="coach-title">
          <h2 id="coach-title" data-reveal>
            Bobo reads your mistakes.
          </h2>
          <div className="copy">
            <p className="lead" data-reveal style={stagger(1)}>
              Bobo (波波) is a Formosan black bear. He reads your stats and writes a plan of 3 to 7 drills for the
              sounds you miss most.
            </p>
            <p data-reveal style={stagger(2)}>
              A step ends when you reach its target, never on a date. If a step feels wrong, tell him with one key.
            </p>
            <Image
              className="coach-bear"
              src="/landing/bobo-coach.webp"
              alt=""
              width={600}
              height={600}
              sizes="220px"
              data-reveal
              style={stagger(3)}
            />
          </div>
          <figure className="screen">
            <div className="photo shutter" data-ui data-reveal>
              <video
                src="/landing/clip-coach.mp4"
                poster="/landing/clip-coach.jpg"
                muted
                loop
                playsInline
                preload="none"
                data-autoplay
                aria-label="Screen recording of the coach page with a five-step plan."
              />
            </div>
            <figcaption>
              The coach page for Mia, a demo learner made for this page. Her plan starts: &ldquo;Your tongue curls for
              ㄓ, but your fingers reach for the flat twin…&rdquo;
            </figcaption>
          </figure>
          <ul className="facts">
            <li data-reveal>
              <strong>3 to 7 drills</strong>per plan, written from your own answers.
            </li>
            <li data-reveal style={stagger(1)}>
              <strong>Every 10 answers</strong>Bobo checks the plan again.
            </li>
            <li data-reveal style={stagger(2)}>
              <strong>H, E, N</strong>too hard, too easy, not now.
            </li>
            <li data-reveal style={stagger(3)}>
              <strong>W</strong>opens &ldquo;How do we know?&rdquo;, the proof behind the plan.
            </li>
          </ul>
        </section>

        <div>
          <section className="story f-deep" data-ink="#f2ece2" aria-labelledby="story-title">
            <div className="story-head">
              <h3 id="story-title" data-reveal>
                How do we know?
              </h3>
              <p data-reveal style={stagger(1)}>
                Press W and Bobo shows the numbers behind his plan, in nine slides. These are Mia&apos;s: 23 days in a
                row, 36 of 37 symbols, and one pair that keeps tripping her up.
              </p>
            </div>
            <ul className="reel" tabIndex={0} aria-label="The nine slides of How do we know?, scroll sideways">
              {STORY.map((alt, k) => (
                <li key={k}>
                  <Image src={"/landing/story-" + (k + 1) + ".jpg"} alt={alt} width={640} height={947} sizes="440px" />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="chapter features f-paper grid" data-ink="#141218" aria-labelledby="features-title">
          <h2 id="features-title" data-reveal>
            Every sound gets a check.
          </h2>
          <div className="rows">
            <Row
              title="Read"
              text="See a symbol, type the sound. Type “zh” for ㄧ and the app tells you that zh is ㄓ, then saves the mix-up for your coach."
            >
              <figure className="side w320">
                <div className="photo r32 shutter" data-ui data-reveal style={stagger(2)}>
                  <video
                    src="/landing/clip-recognize.mp4"
                    poster="/landing/clip-recognize.jpg"
                    muted
                    loop
                    playsInline
                    preload="none"
                    data-autoplay
                    aria-label="Screen recording of the Recognize drill."
                  />
                </div>
              </figure>
            </Row>
            <Row
              title="Listen"
              text="Hear Taiwan Mandarin and pick what you heard. Tone 4 heard as tone 2 counts as its own mistake, so you train that pair."
            >
              <figure className="side w240">
                <div className="photo r45 shutter" data-reveal style={stagger(2)}>
                  <Image
                    src="/landing/bobo-listening.jpg"
                    alt="Bobo the bear in headphones, listening with his eyes closed."
                    width={800}
                    height={1000}
                    sizes="240px"
                  />
                </div>
              </figure>
            </Row>
            <Row
              wide
              title="Speak"
              text="Hold a key and talk. Each initial, final and tone gets its own check, with a pitch curve. Tone changes like 3-3, 不 and 一 are checked too."
            >
              <div className="photo shutter" data-ui data-reveal style={stagger(2)}>
                <Image
                  src="/landing/ui-tones.jpg"
                  alt="Tones at a glance: tone 1 at 94 percent, tone 2 at 77, tone 3 at 85, tone 4 at 79."
                  width={1600}
                  height={480}
                  sizes="(max-width: 40em) 100vw, 62vw"
                />
              </div>
            </Row>
            <Row
              title="Your sentences"
              text="Practice sentences use facts from your profile. Mia lives in Taipei and has a cat called Mochi, so Mochi shows up in her drills."
            >
              <figure className="side w180">
                <Image
                  src="/mascot/bobo-writing.webp"
                  alt=""
                  width={400}
                  height={400}
                  sizes="180px"
                  data-reveal
                  style={stagger(2)}
                />
              </figure>
            </Row>
            <Row
              title="Keyboard first"
              text="Every drill works from the keyboard. Enter checks your answer. Press and hold to record, let go to stop."
            >
              <figure className="side w320">
                <div className="photo r32 shutter" data-reveal style={stagger(2)}>
                  <Image
                    src="/landing/mtr-keyboard-2.jpg"
                    alt="A white keyboard with bopomofo symbols printed on the keys."
                    width={1920}
                    height={1080}
                    sizes="(max-width: 40em) 100vw, 320px"
                  />
                </div>
                <figcaption>Photo: Cangjie6, CC BY-SA 4.0.</figcaption>
              </figure>
            </Row>
            <Row
              title="Take a break"
              text="Press N and the step waits. Steps end at a target, never on a date, so a lost day fails nothing."
            >
              <figure className="side w240">
                <div className="photo r11 shutter" data-reveal style={stagger(2)}>
                  <Image
                    src="/landing/bobo-asleep.jpg"
                    alt="Bobo asleep on his desk next to a bubble tea, with Taipei 101 outside the window."
                    width={1024}
                    height={1024}
                    sizes="240px"
                  />
                </div>
              </figure>
            </Row>
            <Row
              wide
              title="Your days"
              text="Every answer counts. Mia's chart: 23 days, 371 minutes, coloured by skill."
            >
              <div className="photo shutter" data-ui data-reveal style={stagger(2)}>
                <Image
                  src="/landing/ui-activity.jpg"
                  alt="A bar chart of answers per day over three weeks, coloured by skill."
                  width={1600}
                  height={374}
                  sizes="(max-width: 40em) 100vw, 62vw"
                />
              </div>
            </Row>
          </div>
        </section>

        <div className="about-wrap">
          <section className="chapter about f-night grid" data-ink="#f2ece2" aria-labelledby="about-title">
            <h2 id="about-title" data-reveal>
              Free and open source.
            </h2>
            <div className="blossom" data-reveal style={stagger(1)}>
              <Image
                src="/landing/bobo-night-market.jpg"
                alt="Bobo writing ㄅ with a brush at a night market table in the rain."
                width={1672}
                height={941}
                sizes="(max-width: 40em) 78vw, 520px"
              />
            </div>
            <div className="blocks">
              <p data-reveal>
                bopomofo is free and open source under AGPL-3.0. Speech recognition and the voice run on the CPU, with
                ONNX models.
              </p>
              <p className="small" data-reveal style={stagger(1)}>
                The server and the sentence writer cost money every month. If bopomofo helps you, a coffee helps to keep
                it online.
              </p>
              <p className="about-acts" data-reveal style={stagger(2)}>
                <a className="button" href={COFFEE}>
                  Buy me a coffee{" "}
                  <span className="arrow" aria-hidden="true">
                    &rarr;
                  </span>
                </a>
                <a className="link" href={GITHUB + "#readme"}>
                  Read the setup guide
                </a>
              </p>
            </div>
          </section>
        </div>

        <section className="faq-head f-seal grid" data-ink="#141218" data-btn="#141218" aria-labelledby="faq-title">
          <h2 id="faq-title" data-reveal>
            Before you start
          </h2>
          <Image className="scooter" src="/landing/bobo-scooter.webp" alt="" width={600} height={600} sizes="220px" />
        </section>
        {FAQ.map((f) => (
          <section key={f.q} className={"band grid " + f.tone} data-ink={f.ink}>
            <h3 data-reveal>{f.q}</h3>
            <p data-reveal style={stagger(1)}>
              {f.a}
            </p>
          </section>
        ))}

        <section className="chapter cta f-seal grid" data-ink="#141218" data-btn="#141218" aria-labelledby="cta-title">
          <h2 id="cta-title" data-reveal>
            Bobo would like your name.
          </h2>
          <div className="copy" data-reveal style={stagger(1)}>
            <p className="lead">
              This is the first question of the app. Answer it here, then make your account, and Bobo starts at your
              level.
            </p>
          </div>
          <div className="dialog-slot" data-reveal style={stagger(2)}>
            <NameDialog signedIn={signedIn} />
          </div>
        </section>
      </main>

      <footer className="foot f-deep grid" data-ink="#f2ece2">
        <div className="foot-links">
          <nav className="places" aria-label="Project links">
            <Link className="link" href={signedIn ? "/" : "/sign-up"}>
              {signedIn ? "Open the app" : "Make an account"}
            </Link>
            <a className="link" href={GITHUB}>
              Source code
            </a>
            <a className="link" href={GITHUB + "#readme"}>
              Setup guide
            </a>
            <a className="link" href={GITHUB + "/issues"}>
              Report a problem
            </a>
            <a className="link" href={COFFEE}>
              Buy me a coffee
            </a>
          </nav>
          <div className="cols">
            <div>
              <h3>Licences</h3>
              <ul>
                <li>
                  Code:{" "}
                  <a className="link-plain" href={GITHUB + "/blob/main/LICENSE"}>
                    AGPL-3.0-only
                  </a>
                </li>
                <li>Speech model: CC BY-NC 4.0</li>
                <li>Symbol strokes and audio: Ministry of Education, Taiwan, CC BY 4.0</li>
              </ul>
            </div>
            <div>
              <h3>Photos</h3>
              <ul>
                <li>
                  <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=50632868">
                    Shop sign
                  </a>
                  , Hippietrail, CC BY-SA 4.0
                </li>
                <li>
                  <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=81050568">
                    Handwritten bopomofo
                  </a>
                  , Geographyinitiative, CC BY-SA 4.0
                </li>
                <li>
                  <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=81260998">
                    Keyboard
                  </a>
                  , Cangjie6, CC BY-SA 4.0
                </li>
              </ul>
            </div>
            <div>
              <h3>About these pictures</h3>
              <p>
                The Bobo scenes (brush, night market, headphones, asleep, clipboard, scooter) are generated images.
                Bobo&apos;s face, cheer and writing poses are the app&apos;s own art. App screens come from Mia, a demo
                account with seeded practice data.
              </p>
            </div>
          </div>
        </div>
        <div className="legal">
          <span>bopomofo is free software under AGPL-3.0-only.</span>
          <a className="link-plain" href="#top">
            Back to top
          </a>
        </div>
        <div className="giant" aria-hidden="true">
          <span>bopomofo</span>
        </div>
      </footer>
    </div>
  );
}

/** The reveal delay of an element, in steps of 75 ms. */
const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

function Row({
  title,
  text,
  wide = false,
  children,
}: {
  title: string;
  text: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "row wide" : "row"}>
      <h3 data-reveal>{title}</h3>
      <p data-reveal style={stagger(1)}>
        {text}
      </p>
      {children}
    </div>
  );
}
