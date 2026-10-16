"use client";

import { Burst } from "@/components/quiz/Feedback";
import { ActionBar, type Tone } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { ZhuyinText } from "@/components/ZhuyinText";
import { api } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { PHONE, useViewport } from "@/lib/useFit";
import { holdHint, useHoldMic, type Clip } from "@/lib/useHoldMic";
import { useCallback, useEffect, useState } from "react";
import { type Card } from "./types";

const MAX_SECONDS = { syllable: 5, sentence: 10 } as const;

type Rec = "idle" | "recording" | "checking" | "done";

/** One voice card: record once, see a short result, go on. A failed recording (silent, too short) can be recorded again. */
export function Voice({
  card,
  last,
  onAnswer,
  onNext,
  onSkipVoice,
  error: outer,
}: {
  card: Card;
  last: boolean;
  error: string;
  onAnswer: (id: number) => void;
  onNext: () => void;
  onSkipVoice: () => void;
}) {
  const [step, setStep] = useState<"idle" | "checking" | "done">("idle");
  const [error, setError] = useState(outer);
  const [score, setScore] = useState<number | null>(null);
  const [marks, setMarks] = useState<(string | undefined)[]>([]);
  const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const phone = useViewport().w < PHONE;

  const onClip = useCallback(
    async ({ wav }: Clip) => {
      setStep("checking");
      try {
        const res = await api.speech(wav, card.text, card.mode, { tryN: 0 });
        if (res.event_id) onAnswer(res.event_id);
        setScore(res.score);
        setMarks(
          res.syllables.map((s) =>
            s.tone_ok && s.initial_ok !== false && s.final_ok !== false ? "var(--ok)" : "var(--bad)",
          ),
        );
        playSfx(res.score >= 80 ? "right" : res.score >= 60 ? "close" : "wrong");
        setStep("done");
      } catch (e) {
        setError((e as Error).message);
        setStep("idle");
      }
    },
    [card, onAnswer],
  );

  // Press and hold to record: the microphone stays open between cards, and each recording keeps half a second from
  // before the press, so the first consonant is not cut.
  const hold = useHoldMic({
    active: canRecord,
    maxS: MAX_SECONDS[card.mode],
    onClip: (c) => void onClip(c),
    onDiscard: (why) => setError(holdHint(why, "Space", phone)),
  });
  const rec: Rec = step !== "idle" ? step : hold.holding ? "recording" : "idle";
  const level = hold.level;
  useEffect(() => {
    if (hold.error) setError("The microphone is not available. Allow it in the browser, or skip the voice part.");
  }, [hold.error]);
  const press = () => {
    if (step !== "idle") return;
    setError("");
    void hold.press();
  };
  const release = () => void hold.release();

  const next = () => onNext();
  const skip = () => {
    if (rec === "idle") onNext();
  };

  useHotkeys("placement-voice", [
    {
      keys: ["Space", "KeyR"],
      label: "Hold to record",
      run: press,
      up: release,
      when: rec === "idle" || rec === "recording",
    },
    { keys: ["Enter", "NumpadEnter"], label: last ? "See my level" : "Next", run: next, when: rec === "done" },
    { keys: ["ArrowRight"], label: "Skip this one", run: skip, when: rec === "idle" },
  ]);

  const tone: Tone =
    rec !== "done" || score === null ? (error ? "bad" : null) : score >= 80 ? "ok" : score >= 60 ? "close" : "bad";
  const verdict = score === null ? "" : score >= 80 ? "Clear!" : score >= 60 ? "Almost" : "Not quite";
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-2 text-center">
        <p className="text-sm font-semibold text-muted">
          {card.mode === "syllable" ? "Say this sound" : "Say this sentence"}
        </p>
        <div className="card flex w-full flex-col items-center gap-2 px-4 py-6">
          <ZhuyinText
            items={card.items}
            size={card.mode === "syllable" ? 72 : 40}
            marks={rec === "done" ? marks : undefined}
            className="justify-center"
          />
          {card.english && <p className="text-sm text-muted">{card.english}</p>}
        </div>
        <button
          type="button"
          {...hold.bind}
          onPointerDown={(e) => {
            if (e.button === 0) setError("");
            hold.bind.onPointerDown(e);
          }}
          disabled={!canRecord || rec === "checking" || rec === "done"}
          aria-label="Hold to record"
          className={
            "cjk relative grid h-24 w-24 place-items-center rounded-full text-4xl text-white shadow-xl transition " +
            (rec === "recording"
              ? "recording bg-bad"
              : rec === "done"
                ? score !== null && score >= 80
                  ? "zq-pop bg-ok"
                  : "bg-rough"
                : "bg-accent") +
            (rec === "checking" ? " opacity-60" : "")
          }
          style={
            rec === "recording"
              ? { boxShadow: "0 0 0 " + Math.round(level * 18) + "px rgba(239,68,68,.25)" }
              : undefined
          }
        >
          {rec === "done" ? (score !== null && score >= 80 ? "✓" : "・") : rec === "checking" ? "…" : "說"}
          {rec === "done" && score !== null && score >= 80 && <Burst count={10} distance={90} />}
        </button>
        <div className="min-h-12 text-sm" aria-live="polite">
          {rec === "idle" && !error && (
            <span className="text-muted">
              {phone ? (
                "Hold the button"
              ) : (
                <>
                  Hold <Kbd>Space</Kbd> or the button
                </>
              )}
              , say it, then let go.
            </span>
          )}
          {rec === "recording" && <span className="font-medium text-bad">Recording… let go when you are done.</span>}
          {rec === "checking" && <span className="text-muted">Bobo is listening…</span>}
          {rec === "done" && (
            <span
              className={
                "text-base font-semibold " + (tone === "ok" ? "text-ok" : tone === "close" ? "text-rough" : "text-bad")
              }
            >
              {verdict} {score}/100
            </span>
          )}
          {error && rec === "idle" && <span className="text-bad">{error}</span>}
          {!canRecord && <span className="text-rough">This browser cannot record. You can skip the voice part.</span>}
        </div>
      </div>
      <div className="mx-auto w-full max-w-lg md:pb-8 md:pt-4">
        <ActionBar
          tone={tone}
          title={rec === "done" ? verdict + " " + score + "/100" : error ? "Try again" : undefined}
          detail={rec !== "done" && error ? error : undefined}
        >
          {rec !== "done" && (
            <button className="btn justify-center md:flex-1 md:!py-3" onClick={onSkipVoice} disabled={rec !== "idle"}>
              Skip the voice part
            </button>
          )}
          {rec === "idle" && (
            <button className="btn justify-center md:flex-1 md:!py-3" onClick={skip}>
              Skip this one<Kbd className="max-md:!hidden">→</Kbd>
            </button>
          )}
          {rec === "done" ? (
            <button
              className="btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"
              onClick={next}
            >
              {last ? "See my level" : "Next"}
              <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          ) : (
            <button
              className="btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"
              {...hold.bind}
              onPointerDown={(e) => {
                if (e.button === 0) setError("");
                hold.bind.onPointerDown(e);
              }}
              disabled={!canRecord || rec === "checking"}
            >
              {rec === "recording" ? "Recording… let go" : rec === "checking" ? "Checking…" : "Hold to record"}
              <Kbd className="max-md:!hidden">Space</Kbd>
            </button>
          )}
        </ActionBar>
      </div>
    </>
  );
}
