"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Unit } from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, focusSymbols, useFocus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { useShellAboveKeyboard } from "@/lib/keyboard";
import { answerText, normalizePinyin, symbolOfPinyin } from "@/lib/pinyin";
import { inSet, SET_LABEL, type SymbolSet } from "@/lib/quiz";
import { useReview } from "@/lib/review";
import { playSfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { loadData, symbolAudio, type MoeRow } from "@/lib/zhuyin";
import { FxFrame, StatusPill, type FxStatus } from "@/components/quiz/Feedback";
import { Kbd } from "@/components/shell/Kbd";

const SETS = Object.keys(SET_LABEL) as SymbolSet[];
/** Buttons next to the answer field: a tap must not take the focus from the field, or the phone keyboard closes and the page jumps. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/**
 * Recognize: a symbol is shown, the learner types its pinyin. Its pronunciation plays after a correct answer.
 * Every checked try is saved as a symbol unit whose "actual" is the symbol the typed pinyin stands for (ㄓ typed as "z" = ㄗ),
 * so the stats show which symbols are taken for which. Text that is the pinyin of no symbol is refused and not counted.
 */
export function RecognizeQuiz() {
  const [rows, setRows] = useState<MoeRow[]>([]);
  const [set, setSet] = useState<SymbolSet>("all");
  const [cur, setCur] = useState<MoeRow | null>(null);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<FxStatus>("writing");
  const [revealed, setRevealed] = useState(false);
  const [wrong, setWrong] = useState<{ typed: string; sym: string } | null>(null);
  const [hint, setHint] = useState("");
  const [stats, setStats] = useState({ cards: 0, firstTry: 0, streak: 0, right: 0 });
  const [fxKey, setFxKey] = useState(0);
  const [typing, setTyping] = useState(false); // the answer field has the focus: on a phone, the keyboard is open

  const input = useRef<HTMLInputElement>(null);
  const curRef = useRef<MoeRow | null>(null);
  const card = useRef({ revealed: false, tries: 0, shown: 0, ms: undefined as number | undefined, units: [] as Unit[], done: false });
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focus = useFocus();
  // Learn mode (?learn=1): the answer is shown from the start and the learner copies it. Each right repetition counts.
  const learn = useSearchParams().get("learn") === "1";
  // The card order: a few new symbols at a time, repeated at growing gaps, and reviews when they are due (lib/review.ts).
  const { review, ready } = useReview("recognize", "", { order: "pool" });
  useShellAboveKeyboard();

  useEffect(() => {
    loadData().then((d) => setRows(d.table));
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, []);

  const focusSyms = focusSymbols(focus).join("");
  const focused = rows.filter((r) => focusSyms.includes(r.sym));
  const pool = useCallback(() => (focused.length ? focused : inSet(rows, set)), [rows, set, focusSyms]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const p = pool();
    if (!p.length) return;
    const id = review().next(p.map((r) => r.sym));
    const row = p.find((r) => r.sym === id) ?? p[0];
    curRef.current = row;
    card.current = { revealed: learn, tries: 0, shown: now(), ms: undefined, units: [], done: false };
    setCur(row);
    setTyped("");
    setStatus("writing");
    setRevealed(learn);
    setWrong(null);
    setHint("");
    input.current?.focus({ preventScroll: true });
  }, [pool, learn, review]);

  useEffect(() => { if (rows.length && ready) next(); }, [rows.length, set, focusSyms, learn, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishCard = useCallback((ok: boolean) => {
    const row = curRef.current;
    const c = card.current;
    if (!row || c.done) return;
    c.done = true;
    const firstTry = ok && !c.revealed && c.tries === 0;
    // In learn mode the answer is shown: a right repetition moves the symbol on, but it is not a test.
    review().answer(row.sym, learn ? ok && c.tries === 0 : firstTry, !learn);
    setStats((s) => ({ cards: s.cards + 1, firstTry: s.firstTry + (firstTry ? 1 : 0), streak: firstTry ? s.streak + 1 : 0, right: s.right + (ok ? 1 : 0) }));
    // A skip without any try still says what happened: nothing was typed, and the answer was shown.
    const units: Unit[] = c.units.length ? c.units : [{ kind: "symbol", expected: row.sym, actual: "∅", ok: false, help: c.revealed }];
    api.event({ area: "recognize", item: row.sym, ok: firstTry, first_try: firstTry, ms: c.ms, tries: c.tries + (ok ? 1 : 0), help: c.revealed, units,
      details: { skipped: !ok, set, focus: focus.active ? focus.label : undefined, learn: learn || undefined } });
  }, [set, focus, learn, review]);

  const check = useCallback(() => {
    const row = curRef.current;
    if (!row) return;
    if (card.current.done) { next(); return; } // Enter after a right answer: the next symbol at once
    input.current?.focus({ preventScroll: true });
    const text = normalizePinyin(typed);
    if (!text) return;
    const sym = symbolOfPinyin(text);
    if (!sym) {
      setHint("“" + text + "” is not the pinyin of one symbol. Type one sound, like b, zh, or ang.");
      return;
    }
    const c = card.current;
    c.ms ??= since(c.shown);
    const ok = sym === row.sym;
    c.units.push({ kind: "symbol", expected: row.sym, actual: sym, ok, try_n: c.units.length, help: c.revealed, extra: { typed: text } });
    setHint("");
    setFxKey((k) => k + 1);
    if (ok) {
      setStatus("right");
      setWrong(null);
      void playAudio(symbolAudio(row));
      finishCard(true);
      advanceTimer.current = setTimeout(next, learn ? 700 : 1100);
      return;
    }
    c.tries += 1;
    setWrong({ typed: text, sym });
    setTyped("");
    setStatus("wrong");
    playSfx("wrong");
  }, [typed, finishCard, next, learn]);

  const reveal = useCallback(() => {
    if (!curRef.current || card.current.done) return;
    card.current.revealed = true;
    setRevealed(true);
    input.current?.focus({ preventScroll: true });
  }, []);

  const skip = () => { finishCard(false); next(); };

  const edit = (v: string) => {
    if (card.current.done) return;
    // The text stays as typed: changing it while a phone keyboard composes a word doubles or drops letters.
    // check() reads it through normalizePinyin (case, v = ü, e^ = ê, spaces).
    setTyped(v.slice(0, 12));
    setHint("");
    setStatus((s) => (s === "wrong" ? "writing" : s));
  };

  const done = status === "right";
  const canSkip = revealed && !done;
  useHotkeys("recognize", [
    { keys: ["Enter", "NumpadEnter"], label: done ? "Next" : "Check", run: check, when: !!cur, input: true },
    { keys: ["Space"], label: "Show the answer", run: reveal, when: !!cur && !revealed && !done, input: true },
    { keys: ["ArrowRight"], label: "Skip", run: skip, when: canSkip, input: true },
    ...cycleKeys("Symbol set", SETS, set, setSet).map((k) => ({ ...k, input: true })),
  ]);

  const border = done ? "border-ok bg-ok/5" : status === "wrong" ? "border-bad/60 bg-bad/5" : "border-line";
  const symColor = done ? "text-ok" : status === "wrong" ? "text-bad" : "";
  const answer = cur ? answerText(cur.sym) : "";

  // On a phone with the keyboard open, only what is needed stays: the symbol, the feedback, the field, and its buttons.
  const compact = typing;
  return (
    <div className={"flex flex-1 flex-col " + (compact ? "gap-2 md:gap-4" : "gap-4")}>
      <div className={"chips flex flex-wrap items-center gap-2 " + (compact ? "max-md:hidden" : "")}>
        <FocusChip focus={focus} empty={focus.active && !focused.length} />
        {SETS.map((k) => (
          <button key={k} className="chip cjk" data-active={!focused.length && set === k} onClick={() => setSet(k)}>{SET_LABEL[k]}</button>
        ))}
        <div className="ml-auto text-sm text-muted">
          {learn ? <><b className="text-ink">{stats.right}</b> right repetitions</>
            : <><b className="text-ink">{stats.streak}</b> streak · {stats.cards ? Math.round((100 * stats.firstTry) / stats.cards) : 0}% first try of {stats.cards}</>}
        </div>
      </div>

      {cur && (
        <div className={"card stage flex flex-1 flex-col items-center gap-3 border-2 p-6 transition-colors duration-300 md:justify-center md:gap-4 md:p-8 " +
          (compact ? "max-md:justify-start max-md:pt-1 " : "justify-center ") + border}
          onClick={() => input.current?.focus({ preventScroll: true })}>
          <div className={compact ? "max-md:hidden" : ""}>
            <StatusPill status={status} label={done ? undefined : status === "wrong" ? "Not quite, try again" : learn || revealed ? "Type the answer to continue" : "Type its pinyin"} />
          </div>
          <FxFrame status={status} attempt={fxKey}>
            <div className={"cjk select-none px-6 leading-none transition-[color,font-size] duration-300 " + symColor + " " +
              (compact ? "text-[clamp(64px,12dvh,120px)] md:text-[clamp(96px,22vh,240px)]" : "text-[clamp(88px,20dvh,240px)]")}
              aria-label={"Type the pinyin of this symbol: " + cur.sym}>{cur.sym}</div>
          </FxFrame>

          <div className="flex min-h-7 flex-col items-center justify-center text-center" aria-live="polite">
            {done ? (
              <div className="cjk text-lg font-semibold text-ok">✓ {cur.sym} = {answer}</div>
            ) : revealed ? (
              <div className="text-2xl font-semibold text-accent">{answer}</div>
            ) : status === "wrong" && wrong ? (
              <div className="cjk font-medium text-bad">You typed “{wrong.typed}”: that is {wrong.sym}. Try again.</div>
            ) : (
              <div className="text-muted">Which sound is it? Type it in pinyin.</div>
            )}
          </div>

          {/* A form: the Enter key of a phone keyboard submits it, even when the key event carries no key code. */}
          <form className="flex w-full max-w-sm items-stretch gap-2" onSubmit={(e) => { e.preventDefault(); check(); }}>
            <input ref={input} value={typed} onChange={(e) => edit(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
              type="text" inputMode="text" autoFocus autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              enterKeyHint={done ? "next" : "go"} aria-label="Pinyin of the symbol" placeholder={done ? "" : "pinyin"}
              className={"min-w-0 flex-1 rounded-2xl border-2 bg-card px-4 py-2 text-center font-mono text-3xl tracking-wider outline-none transition placeholder:text-base placeholder:tracking-normal placeholder:text-muted/60 focus:border-accent " +
                (done ? "border-ok text-ok" : status === "wrong" ? "border-bad/60" : "border-line")} />
            <button type="submit" onMouseDown={keepFocus} aria-disabled={!done && !typed}
              className={"btn shrink-0 !rounded-2xl !px-5 text-base font-semibold " + (done ? "btn-accent" : "btn-primary") + (!done && !typed ? " opacity-50" : "")}>
              {done ? "Next" : "Check"} <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          </form>

          <div className="flex min-h-10 flex-wrap items-center justify-center gap-2">
            {!revealed && !done && <button type="button" className="btn" onMouseDown={keepFocus} onClick={reveal}>Show the answer <Kbd className="max-md:!hidden">Space</Kbd></button>}
            {canSkip && <button type="button" className="btn text-muted" onMouseDown={keepFocus} onClick={skip} title="Skip this symbol for now">Skip <Kbd className="max-md:!hidden">→</Kbd></button>}
          </div>
          <div className="min-h-5 text-center text-sm text-rough">{hint || (!done && <span className="text-muted">Type v for ü and eh for ê.</span>)}</div>
        </div>
      )}
    </div>
  );
}
