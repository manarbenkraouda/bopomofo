"use client";
// On-screen pinyin keyboard for the recognize quiz. On a phone it replaces the system keyboard (the answer field uses
// inputMode="none"), so ü and ê are one tap away. On a desktop it echoes the physical keys as they are pressed.
import { PINYIN_ROWS } from "@/lib/pinyin";

export function PinyinKeyboard({ onChar, onBackspace, pressed, disabled }: {
  onChar: (c: string) => void; onBackspace: () => void; pressed: string | null; disabled?: boolean;
}) {
  // pointerdown + preventDefault: a tap never takes the focus away from the answer field.
  const tap = (fn: () => void) => (e: React.PointerEvent) => { e.preventDefault(); if (!disabled) fn(); };
  const key = "grid h-11 place-items-center rounded-lg border border-line border-b-2 bg-card text-lg font-semibold transition select-none touch-manipulation hover:bg-raise active:translate-y-px md:h-10 md:text-base";
  return (
    <div className="flex w-full max-w-xl flex-col gap-1.5" aria-label="Pinyin keyboard" data-disabled={disabled || undefined}>
      {PINYIN_ROWS.map((row, i) => (
        <div key={i} className="flex justify-center gap-1 md:gap-1.5">
          {row.map((c) => (
            <button key={c} type="button" tabIndex={-1} onPointerDown={tap(() => onChar(c))} aria-label={c}
              className={key + " w-[9.2%] max-w-12 " + (c === "ü" || c === "ê" ? "text-accent " : "") + (pressed === c ? "!border-accent !bg-accent-soft" : "")}>
              {c}
            </button>
          ))}
          {i === 2 && (
            <button type="button" tabIndex={-1} onPointerDown={tap(onBackspace)} aria-label="Delete"
              className={key + " w-[14%] max-w-20 text-muted " + (pressed === "Backspace" ? "!border-accent !bg-accent-soft" : "")}>⌫</button>
          )}
        </div>
      ))}
    </div>
  );
}

