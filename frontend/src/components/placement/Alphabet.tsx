"use client";

import { Kbd } from "@/components/shell/Kbd";
import { api, type Unit } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { answerText, normalizePinyin, symbolOfPinyin } from "@/lib/pinyin";
import { playSfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { useEffect, useRef, useState } from "react";

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** One symbol: type its pinyin, one try. Space (or the button) says "I don't know". */
export function Alphabet({
  sym,
  onAnswer,
  onNext,
}: {
  sym: string;
  onAnswer: (p: Promise<number | undefined>) => void;
  onNext: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState("");
  const [fb, setFb] = useState<null | { ok: boolean; typed: string }>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = useRef(now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = (ok: boolean, actual: string, text: string) => {
    const units: Unit[] = [
      { kind: "symbol", expected: sym, actual, ok, try_n: 0, help: false, ...(text ? { extra: { typed: text } } : {}) },
    ];
    onAnswer(
      api
        .event({
          area: "recognize",
          item: sym,
          ok,
          first_try: ok,
          ms: since(shown.current),
          tries: 1,
          help: false,
          units,
          details: { placement: true, skipped: !text || undefined },
        })
        .then((r) => r.id),
    );
    setFb({ ok, typed: text });
    playSfx(ok ? "right" : "wrong");
    timer.current = setTimeout(onNext, ok ? 700 : 1600);
  };
  const check = () => {
    if (fb) {
      if (timer.current) clearTimeout(timer.current);
      onNext();
      return;
    }
    const text = normalizePinyin(typed);
    if (!text) return;
    const s = symbolOfPinyin(text);
    if (!s) {
      setHint("“" + text + "” is not the sound of one symbol. Type one sound, like b, zh, or ang.");
      return;
    }
    save(s === sym, s, text);
  };
  const dontKnow = () => {
    if (!fb) save(false, "∅", "");
  };

  useHotkeys("placement-alphabet", [
    { keys: ["Enter", "NumpadEnter"], label: fb ? "Next" : "Check", run: check, input: true },
    { keys: ["Space"], label: "I don't know", run: dontKnow, when: !fb, input: true },
  ]);

  const color = fb ? (fb.ok ? "text-ok" : "text-bad") : "";
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-2"
      onClick={() => input.current?.focus({ preventScroll: true })}
    >
      <div
        className={"cjk select-none text-[clamp(88px,18dvh,200px)] leading-none transition-colors " + color}
        aria-label={"Type the pinyin of this symbol: " + sym}
      >
        {sym}
      </div>
      <div className="flex min-h-7 items-center text-center" aria-live="polite">
        {fb ? (
          fb.ok ? (
            <span className="cjk text-lg font-semibold text-ok">
              ✓ {sym} = {answerText(sym)}
            </span>
          ) : (
            <span className="cjk font-medium text-bad">
              {fb.typed ? "“" + fb.typed + "” is not it: " : ""}
              {sym} = {answerText(sym)}
            </span>
          )
        ) : (
          <span className="text-muted">Which sound is it? Type it in pinyin.</span>
        )}
      </div>
      <form
        className="flex w-full max-w-sm items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <input
          ref={input}
          value={typed}
          onChange={(e) => {
            if (!fb) {
              setTyped(e.target.value.slice(0, 12));
              setHint("");
            }
          }}
          type="text"
          inputMode="text"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={fb ? "next" : "go"}
          aria-label="Pinyin of the symbol"
          placeholder={fb ? "" : "pinyin"}
          className={
            "min-w-0 flex-1 rounded-2xl border-2 bg-card px-4 py-2 text-center font-mono text-3xl tracking-wider outline-none transition placeholder:text-base placeholder:tracking-normal placeholder:text-muted/60 focus:border-accent " +
            (fb ? (fb.ok ? "border-ok text-ok" : "border-bad/60") : "border-line")
          }
        />
        <button
          type="submit"
          onMouseDown={keepFocus}
          className={"btn shrink-0 !rounded-2xl !px-5 text-base font-semibold " + (fb ? "btn-accent" : "btn-primary")}
        >
          {fb ? "Next" : "Check"} <Kbd className="max-md:!hidden">Enter</Kbd>
        </button>
      </form>
      {!fb && (
        <button type="button" className="btn text-muted" onMouseDown={keepFocus} onClick={dontKnow}>
          I don&apos;t know <Kbd className="max-md:!hidden">Space</Kbd>
        </button>
      )}
      <div className="min-h-5 text-center text-sm text-rough">
        {hint || <span className="text-muted">Type v for ü and eh for ê.</span>}
      </div>
    </div>
  );
}
