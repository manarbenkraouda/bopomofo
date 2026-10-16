"use client";

import { PitchChart } from "@/components/PitchChart";
import { useCountUp } from "@/components/quiz/Feedback";
import { grade, saidZhuyin, verdict } from "@/components/speaking/cards";
import { ZhuyinText } from "@/components/ZhuyinText";
import { apiBase } from "@/lib/api/transport";
import type { SpeechResult, SpeechSyllable } from "@/lib/api/types/content";
import { playAudio } from "@/lib/audio";
import { playSfx } from "@/lib/sfx";
import { PHONE, useViewport } from "@/lib/useFit";
import { holdHint, useHoldMic, type Clip } from "@/lib/useHoldMic";
import { useCallback, useEffect, useRef, useState } from "react";
import { SAY_CARDS } from "./sayCards";

type Server = "wait" | "loading" | "ready" | "offline";

const OK = "#3cbc80";
const BAD = "#ef5b5b";
const right = (s: SpeechSyllable) => !!s.heard && s.tone_ok && s.initial_ok !== false && s.final_ok !== false;

/** The Speaking drill of the app on four fixed phrases: hear Bobo, hold to record, and get the real speech check
 *  from POST /api/demo/speech. Nothing is saved, so there is no schedule, no stats, and no coach step. */
export function SayIt() {
  const [k, setK] = useState(0);
  const card = SAY_CARDS[k];
  const [server, setServer] = useState<Server>("wait");
  const [seen, setSeen] = useState(false);
  const [inView, setInView] = useState(false);
  const [heard, setHeard] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [error, setError] = useState("");
  const [mine, setMine] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The card of the recording in progress. A result for an older card is dropped.
  const current = useRef(card);
  const phone = useViewport().w < PHONE;

  useEffect(() => {
    current.current = card;
  }, [card]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        setInView(on);
        if (on) setSeen(true);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Ask the server once the card is on screen. The speech model loads for a few seconds after a restart.
  useEffect(() => {
    if (!seen) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = (n: number) =>
      fetch(apiBase() + "/api/health")
        .then((r) => r.json())
        .then((h: { speech_model?: string }) => {
          if (stop) return;
          if (h.speech_model === "ready") setServer("ready");
          else if (h.speech_model === "loading" && n < 45) {
            setServer("loading");
            timer = setTimeout(() => poll(n + 1), 2000);
          } else setServer("offline");
        })
        .catch(() => {
          if (!stop) setServer("offline");
        });
    void poll(0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [seen]);

  useEffect(() => () => void (mine && URL.revokeObjectURL(mine)), [mine]);

  const clear = () => {
    setResult(null);
    setError("");
  };

  const check = async (clip: Clip) => {
    const target = current.current;
    setChecking(true);
    setMine(URL.createObjectURL(clip.wav));
    playSfx("tick");
    const body = new FormData();
    body.append("audio", clip.wav, "say.wav");
    body.append("text", target.text);
    try {
      const r = await fetch(apiBase() + "/api/demo/speech", { method: "POST", body });
      const j = await r.json().catch(() => ({}));
      if (current.current !== target) return;
      if (r.ok) {
        setResult(j as SpeechResult);
        const g = grade((j as SpeechResult).score);
        playSfx(g === "right" ? "right" : g === "close" ? "close" : "wrong");
      } else {
        // The 4xx and 503 messages of the demo route are written for the visitor. A 500 is not.
        const detail = typeof j.detail === "string" && r.status !== 500 ? j.detail : "";
        setError(detail || "Something went wrong. Please try again in a moment.");
      }
    } catch {
      if (current.current === target) setError("Can't reach the speech check right now.");
    } finally {
      setChecking(false);
    }
  };
  const onClip = useRef(check);
  useEffect(() => {
    onClip.current = check;
  });

  const ready = server === "ready";
  const hold = useHoldMic({
    active: seen && ready,
    maxS: 6,
    onClip: (c) => void onClip.current(c),
    onDiscard: (why) => setError(holdHint(why, "R", phone)),
  });
  const { press: holdPress, release: holdRelease } = hold;
  const canRecord = ready && !checking;
  const press = useCallback(() => {
    clear();
    void holdPress();
  }, [holdPress]);

  // Hold R to record while the card is on screen, unless the visitor types in a field (the Recognize drill above).
  useEffect(() => {
    if (!inView || !canRecord) return;
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && !!e.target.closest("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      e.preventDefault();
      press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyR") void holdRelease();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [inView, canRecord, press, holdRelease]);

  const pick = (n: number) => {
    if (hold.holding || n === k) return;
    clear();
    setHeard(false);
    setMine(null);
    setK(n);
  };
  const hear = () => {
    setHeard(true);
    playAudio(card.audio).catch(() => {});
  };

  const recording = hold.holding;
  const g = result && !recording && !checking ? grade(result.score) : null;
  const tone = g === "right" ? "ok" : g === "close" ? "close" : g ? "bad" : "";
  const pill = recording
    ? "Recording… let go when done"
    : checking
      ? "Checking…"
      : result
        ? verdict(result.score)
        : heard
          ? "Now say it yourself"
          : "Repeat after Bobo";
  const status =
    server === "offline"
      ? "The speech check is offline right now. You can still hear Bobo."
      : server === "loading"
        ? "The speech check is getting ready (a few seconds)…"
        : "";
  const marks = result?.syllables.map((s) => (right(s) ? OK : BAD));

  return (
    <section className="chapter say f-paper grid" data-ink="#24201b" aria-labelledby="say-title" id="say">
      <h2 id="say-title">Repeat after Bobo.</h2>
      <div className="copy">
        <p className="lead">This is the Speaking drill of the app, with the real speech check.</p>
        <p>
          Hear Bobo first. Then hold the button{phone ? "" : " or the R key"}, say the phrase, and let go. The check
          grades each initial, final and tone, and it knows the tone changes: in 你好, the 你 rises.
        </p>
        <p className="small">
          Your recording goes to the bopomofo server for this one check. The demo saves nothing. In the app, every try
          goes into your stats, and Bobo plans drills for the sounds you miss.
        </p>
      </div>
      <div className="say-stage">
        <div className="say-card" data-ui ref={box}>
          <div className="phrases" role="group" aria-label="Phrases">
            {SAY_CARDS.map((c, n) => (
              <button key={c.text} type="button" aria-pressed={n === k} onClick={() => pick(n)}>
                {c.text}
              </button>
            ))}
          </div>
          <span className={"pill " + tone}>{pill}</span>
          <div className="phrase" lang="zh-Hant-TW">
            <ZhuyinText items={card.items} size={phone ? 46 : 66} marks={marks} />
          </div>
          <p className="meaning">
            {heard || result ? <b>{card.say}</b> : null}
            <span>{card.english}</span>
          </p>
          <p className="note">{card.note}</p>
          <div className="controls">
            <button className="hear" type="button" onClick={hear}>
              <Speaker />
              {heard ? "Hear it again" : "Hear Bobo"}
            </button>
            {heard && (
              <button className="hear" type="button" onClick={() => playAudio(card.slow).catch(() => {})}>
                Slow
              </button>
            )}
            {mine && !recording && !checking && (
              <button className="hear" type="button" onClick={() => playAudio(mine).catch(() => {})}>
                My recording
              </button>
            )}
          </div>
          <button
            type="button"
            {...hold.bind}
            onPointerDown={(e) => {
              if (e.button === 0) clear();
              hold.bind.onPointerDown(e);
            }}
            disabled={!canRecord}
            className={"rec" + (recording ? " on" : "")}
            aria-label="Hold to record"
          >
            <span className="dot" aria-hidden="true" />
            {recording
              ? "Recording… let go"
              : checking
                ? "Checking…"
                : hold.state === "opening"
                  ? "Starting the mic…"
                  : result
                    ? "Hold to try again"
                    : "Hold to record"}
            {!phone && !recording && !checking && <kbd>R</kbd>}
            {recording && (
              <span className="meter" aria-hidden="true">
                <span style={{ transform: "scaleX(" + hold.level + ")" }} />
              </span>
            )}
          </button>
          <p className={"ask" + (error || hold.error ? " bad" : "")} aria-live="polite">
            {error || hold.error || status}
          </p>
          {result && !recording && !checking && (
            <Result result={result} onNext={() => pick((k + 1) % SAY_CARDS.length)} />
          )}
        </div>
      </div>
    </section>
  );
}

function Result({ result, onNext }: { result: SpeechResult; onNext: () => void }) {
  const shown = useCountUp(result.score);
  const sy = result.syllables;
  const tones = sy.filter((s) => s.tone_ok).length;
  const sounds = sy.filter((s) => s.heard && s.initial_ok !== false && s.final_ok !== false).length;
  const g = grade(result.score);
  return (
    <div className="say-result">
      <div className="score">
        <b className={g === "right" ? "ok" : g === "close" ? "close" : "bad"}>{shown}</b>
        <span>
          tones {tones}/{sy.length} · sounds {sounds}/{sy.length}
        </span>
        <span className="time">Checked in {result.timing.infer_seconds.toFixed(1)} s</span>
      </div>
      <ul className="tiles">
        {sy.map((s, i) => {
          const ok = right(s);
          return (
            <li key={i} className={ok ? "ok" : "bad"}>
              <div className="head" lang="zh-Hant-TW">
                <span className="ch">{s.expected.char}</span>
                <span className="zy">{saidZhuyin(s.expected)}</span>
                <span className="mark" aria-label={ok ? "right" : "wrong"}>
                  {ok ? "✓" : "✗"}
                </span>
              </div>
              <div className="heard" lang="zh-Hant-TW">
                heard <b>{s.heard?.zhuyin ?? "—"}</b>
              </div>
              {s.messages.length > 0 && (
                <ul className="msgs">
                  {s.messages.map((m, n) => (
                    <li key={n}>{m}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <figure className="curve">
        <PitchChart result={result} height={110} />
        <figcaption>Your pitch (white) over the target tone shapes, syllable by syllable.</figcaption>
      </figure>
      <button className="check" type="button" onClick={onNext}>
        Next phrase <span aria-hidden="true">&rarr;</span>
      </button>
    </div>
  );
}

function Speaker() {
  return (
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
  );
}
