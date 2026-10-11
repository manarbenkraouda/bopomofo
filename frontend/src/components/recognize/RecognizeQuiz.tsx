"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Unit } from "@/lib/api";
import { FocusChip, focusSymbols, useFocus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { answerText, normalizePinyin, symbolOfPinyin } from "@/lib/pinyin";
import { cycleNext, inSet, pickWeighted, SET_LABEL, updateMiss, type SymbolSet } from "@/lib/quiz";
import { playSfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { loadData, type MoeRow } from "@/lib/zhuyin";
import { FxFrame, StatusPill, type FxStatus } from "@/components/quiz/Feedback";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { PinyinKeyboard } from "./PinyinKeyboard";

const SETS = Object.keys(SET_LABEL) as SymbolSet[];
/** What the answer field keeps: pinyin letters only, with the keyboard spellings of ü and ê turned into the letters. */
const clean = (s: string) => s.toLowerCase().replace(/u:|v/g, "ü").replace(/e\^/g, "ê").replace(/[^a-zêü]/g, "").slice(0, 5);

/**
 * Recognize: a symbol is shown, the learner types its pinyin. Silent: no microphone, no audio.
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
  const [pressed, setPressed] = useState<string | null>(null);
  const [stats, setStats] = useState({ cards: 0, firstTry: 0, streak: 0, right: 0 });
  const [fxKey, setFxKey] = useState(0);

  const input = useRef<HTMLInputElement>(null);
  const curRef = useRef<MoeRow | null>(null);
  const card = useRef({ revealed: false, tries: 0, shown: 0, ms: undefined as number | undefined, units: [] as Unit[], done: false });
  const recent = useRef<string[]>([]);
  const missRate = useRef<Record<string, number>>({});
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const order = useRef<string[]>([]);
  const focus = useFocus();
  // Learn mode (?learn=1): the answer is shown from the start and the learner copies it. Each right repetition counts.
  const learn = useSearchParams().get("learn") === "1";

  useEffect(() => {
    loadData().then((d) => setRows(d.table));
    api.summary().then((s) => {
      missRate.current = Object.fromEntries(Object.entries(s.symbols_by_area?.recognize ?? s.symbols).map(([k, v]) => [k, (v.err + 1) / (v.n + 2)]));
    }).catch(() => {});
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, []);

  const focusSyms = focusSymbols(focus).join("");
  const focused = rows.filter((r) => focusSyms.includes(r.sym));
  const pool = useCallback(() => (focused.length ? focused : inSet(rows, set)), [rows, set, focusSyms]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const p = pool();
    if (!p.length) return;
    const row = learn ? cycleNext(p, order.current, curRef.current?.sym) : pickWeighted(p, missRate.current, recent.current);
    recent.current = [...recent.current, row.sym].slice(-Math.min(4, p.length - 1));
    curRef.current = row;
    card.current = { revealed: learn, tries: 0, shown: now(), ms: undefined, units: [], done: false };
    setCur(row);
    setTyped("");
    setStatus("writing");
    setRevealed(learn);
    setWrong(null);
    setHint("");
    input.current?.focus({ preventScroll: true });
  }, [pool, learn]);

  useEffect(() => { if (rows.length) next(); }, [rows.length, set, focusSyms, learn]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishCard = useCallback((ok: boolean) => {
    const row = curRef.current;
    const c = card.current;
    if (!row || c.done) return;
    c.done = true;
    const firstTry = ok && !c.revealed && c.tries === 0;
    missRate.current[row.sym] = updateMiss(missRate.current[row.sym], firstTry);
    setStats((s) => ({ cards: s.cards + 1, firstTry: s.firstTry + (firstTry ? 1 : 0), streak: firstTry ? s.streak + 1 : 0, right: s.right + (ok ? 1 : 0) }));
    // A skip without any try still says what happened: nothing was typed, and the answer was shown.
    const units: Unit[] = c.units.length ? c.units : [{ kind: "symbol", expected: row.sym, actual: "∅", ok: false, help: c.revealed }];
    api.event({ area: "recognize", item: row.sym, ok: firstTry, first_try: firstTry, ms: c.ms, tries: c.tries + (ok ? 1 : 0), help: c.revealed, units,
      details: { skipped: !ok, set, focus: focus.active ? focus.label : undefined, learn: learn || undefined } });
  }, [set, focus, learn]);

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
      playSfx("right");
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

  const flash = (k: string) => {
    setPressed(k);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(null), 160);
  };
  const edit = (v: string) => {
    if (card.current.done) return;
    setTyped(clean(v));
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

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex flex-wrap items-center gap-2">
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
        <div className={"card stage flex flex-1 flex-col items-center justify-center gap-4 border-2 p-6 transition-colors duration-300 md:p-8 " + border}
          onClick={() => input.current?.focus({ preventScroll: true })}>
          <StatusPill status={status} label={done ? undefined : status === "wrong" ? "Not quite, try again" : learn || revealed ? "Type the answer to continue" : "Type its pinyin"} />
          <FxFrame status={status} attempt={fxKey}>
            <div className={"cjk select-none px-6 leading-none transition-colors duration-300 text-[clamp(96px,22vh,240px)] " + symColor} aria-label={"Type the pinyin of this symbol: " + cur.sym}>{cur.sym}</div>
          </FxFrame>

          <div className="flex h-14 flex-col items-center justify-center text-center">
            {done ? (
              <div className="cjk text-lg font-semibold text-ok">✓ {cur.sym} = {answer}</div>
            ) : revealed ? (
              <div className="text-2xl font-semibold text-accent">{answer}</div>
            ) : status === "wrong" && wrong ? (
              <div className="cjk text-bad">You typed “{wrong.typed}”: that is {wrong.sym}. Try again.</div>
            ) : (
              <div className="text-muted">Which sound is it? Type it in pinyin.</div>
            )}
          </div>

          <input ref={input} value={typed} onChange={(e) => edit(e.target.value)} inputMode="none" autoFocus autoComplete="off" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} enterKeyHint="done" aria-label="Pinyin of the symbol" placeholder={done ? "" : "pinyin"}
            onKeyDown={(e) => flash(e.key === "Backspace" ? "Backspace" : clean(e.key))}
            className={"w-48 rounded-2xl border-2 bg-card px-4 py-2 text-center font-mono text-3xl tracking-wider outline-none transition placeholder:text-base placeholder:tracking-normal placeholder:text-muted/60 focus:border-accent " +
              (done ? "border-ok text-ok" : status === "wrong" ? "border-bad/60" : "border-line")} />
          <div className="h-5 text-center text-sm text-rough">{hint}</div>

          <PinyinKeyboard pressed={pressed} disabled={done}
            onChar={(c) => { input.current?.focus({ preventScroll: true }); edit(typed + c); }}
            onBackspace={() => edit(typed.slice(0, -1))} />

          <ActionBar tone={done ? "ok" : status === "wrong" ? "bad" : null}
            title={done ? "✓ " + cur.sym + " = " + answer : status === "wrong" && wrong ? "That is " + wrong.sym : undefined}
            detail={status === "wrong" && wrong ? "You typed “" + wrong.typed + "”. Try again." : undefined}>
            <button className="btn btn-primary ab-primary !rounded-full !px-6 !py-3 text-base" onClick={check} disabled={!done && !typed}>
              {done ? "Next" : "Check"} <Kbd>Enter</Kbd>
            </button>
            {!revealed && !done && <button className="btn" onClick={reveal}>Show the answer <Kbd>Space</Kbd></button>}
            {canSkip && <button className="btn text-muted" onClick={skip} title="Skip this symbol for now">Skip <Kbd>→</Kbd></button>}
          </ActionBar>
        </div>
      )}
    </div>
  );
}

