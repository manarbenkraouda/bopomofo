"use client";

import { playAudio } from "@/lib/audio";
import { answerText, normalizePinyin, symbolOfPinyin } from "@/lib/pinyin";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Glyph } from "./Glyph";
import { DRILL_SYMBOLS, type LandingData } from "./symbols";

type Say = { kind: "ask" | "ok" | "bad"; text: string };
const ASK: Say = { kind: "ask", text: "Which sound is this?" };

/** The Recognize drill of the app, on 14 symbols. Answers and messages follow RecognizeQuiz; nothing is saved. */
export function TryDrill({ glyphs, audio }: LandingData) {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState("");
  const [say, setSay] = useState<Say>(ASK);
  // 0: the symbol is shown complete. Every increase writes it again, stroke by stroke.
  const [write, setWrite] = useState(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const sym = DRILL_SYMBOLS[i];

  // Write the first symbol in front of the visitor when the card comes into view.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setWrite((w) => w || 1);
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer.current);
    };
  }, []);

  const hear = () => {
    playAudio(audio[sym]).catch(() => {});
  };

  const check = (e: FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const text = normalizePinyin(typed);
    if (!text) return;
    const got = symbolOfPinyin(text);
    if (got === sym) {
      busy.current = true;
      setSay({ kind: "ok", text: "Right: " + sym + " is " + answerText(sym) + "." });
      setWrite((w) => w + 1);
      hear();
      timer.current = setTimeout(() => {
        const last = i === DRILL_SYMBOLS.length - 1;
        setTyped("");
        setI(last ? 0 : i + 1);
        setWrite((w) => w + 1);
        setSay(last ? { kind: "ask", text: "All 14 read. The app has 23 more symbols." } : ASK);
        busy.current = false;
      }, 1500);
      return;
    }
    field.current?.select();
    if (got) {
      setSay({ kind: "bad", text: "You typed \u201c" + text + "\u201d: that is " + got + ". Try again." });
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        card.current?.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-10px)" },
            { transform: "translateX(8px)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 360, easing: "ease-out" },
        );
    } else {
      setSay({
        kind: "ask",
        text: "\u201c" + text + "\u201d is not the pinyin of one symbol. Type one sound, like b, zh, or ang.",
      });
    }
  };

  const tone = say.kind === "ask" ? "" : say.kind;
  return (
    <section
      className="chapter try f-paper grid"
      data-ink="#24201b"
      data-state={say.kind === "ok" ? "right" : undefined}
      aria-labelledby="try-title"
      id="try"
    >
      <h2 id="try-title">
        What does{" "}
        <span key={sym} className="word">
          {sym}
        </span>{" "}
        sound&nbsp;like?
      </h2>
      <div className="copy">
        <p className="lead">Try the Recognize drill from the app, right here.</p>
        <p>
          Read the symbol, type its pinyin, press Enter. The sound is a real recording from Taiwan&apos;s Ministry of
          Education. In the app, every miss is saved, so the coach learns that you read ㄓ as ㄗ.
        </p>
      </div>
      <div className="stage">
        <div className="drill" data-ui ref={card}>
          <span className={"pill " + tone}>
            {say.kind === "ok" ? "Right" : say.kind === "bad" ? "Not quite" : "Recognize, " + (i + 1) + " of 14"}
          </span>
          <Glyph
            key={sym + write}
            strokes={glyphs[sym]}
            play={write > 0}
            rate={write > 1 ? 6 : 4.5}
            gap={40}
            className={"sym " + tone}
            label={"Symbol " + sym}
          />
          <p className={"ask " + tone} aria-live="polite">
            {say.text}
          </p>
          <form autoComplete="off" onSubmit={check}>
            <label className="sr-only" htmlFor="py">
              Pinyin for this symbol
            </label>
            <input
              id="py"
              ref={field}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              type="text"
              placeholder="pinyin"
              spellCheck={false}
              autoCapitalize="off"
              enterKeyHint="go"
            />
            <button className="check" type="submit">
              Check <kbd>Enter</kbd>
            </button>
          </form>
          <p className="hint">Type v for ü and eh for ê.</p>
          <button className="hear" type="button" onClick={hear}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
              <path
                d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            Hear it
          </button>
        </div>
      </div>
    </section>
  );
}
