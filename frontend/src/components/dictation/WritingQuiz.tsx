"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Unit } from "@/lib/api";
import { firstTry } from "@/lib/attempts";
import { playAudio } from "@/lib/audio";
import { FocusChip, focusSymbols, useFocus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { buildTemplates, type Pt, type SymbolResult, type Templates } from "@/lib/matcher";
import { inSet, SET_LABEL, SYMBOL_NAME, type SymbolSet } from "@/lib/quiz";
import { useReview } from "@/lib/review";
import { playSfx } from "@/lib/sfx";
import { now, since, writtenUnits } from "@/lib/track";
import { useFit } from "@/lib/useFit";
import { loadData, NOTES, symbolAudio, type MoeRow, type StrokeData } from "@/lib/zhuyin";
import { FxFrame, StatusPill, type FxStatus } from "@/components/quiz/Feedback";
import { PlayButton } from "@/components/PlayButton";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { StrokeAnim } from "@/components/StrokeAnim";
import { Pad } from "@/components/writing/Pad";
import { Guide, ResultOverlay } from "@/components/writing/Overlay";
import { gradeSyllable } from "@/components/writing/grade";

// MOE allows a 3-stroke form of these two symbols.
const SHORT_FORM = new Set(["ㄓ", "ㄖ"]);
const SETS = Object.keys(SET_LABEL) as SymbolSet[];

type Miss = { ink: Pt[][]; r: SymbolResult | null };

export function WritingQuiz() {
  const [data, setData] = useState<{ strokes: StrokeData; table: MoeRow[] } | null>(null);
  const [T, setT] = useState<Templates | null>(null);
  const [set, setSet] = useState<SymbolSet>("all");
  const [cur, setCur] = useState<MoeRow | null>(null);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [passed, setPassed] = useState<SymbolResult | null | false>(false); // false = still writing
  const [miss, setMiss] = useState<Miss | null>(null);
  const [cheat, setCheat] = useState(0); // 0 = hidden, otherwise the replay key of the stroke animation
  const [tries, setTries] = useState(0);
  const [fx, setFx] = useState<FxStatus>("writing");
  const [fxKey, setFxKey] = useState(0);
  const [stats, setStats] = useState({ cards: 0, firstTry: 0, streak: 0, right: 0 });
  const PAD = useFit(200, 420, 0.36, 0.84); // follows the window height, and the width on a phone

  const card = useRef({
    cheated: false,
    tries: 0,
    shown: 0,
    ms: undefined as number | undefined,
    replays: 0,
    units: [] as Unit[],
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focus = useFocus();
  const focusSyms = focusSymbols(focus).join("");
  // Learn mode (?learn=1): every card shows the strokes, and the learner copies the symbol. Each right copy counts.
  const learn = useSearchParams().get("learn") === "1";
  // The card order: all the symbols, repeated at growing gaps, and reviews when they are due (lib/review.ts).
  const { review, ready } = useReview("dictation", "", { order: "pool" });

  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setT(buildTemplates(d.strokes));
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const focused = data ? data.table.filter((r) => focusSyms.includes(r.sym)) : [];
  const next = useCallback(() => {
    if (!data) return;
    const f = data.table.filter((r) => focusSyms.includes(r.sym));
    const pool = f.length ? f : inSet(data.table, set);
    // With a focus, some cards come from the rest of the set, so a few weak symbols do not loop (lib/review.ts).
    const others = f.length && !learn ? inSet(data.table, set) : [];
    const id = review().next(
      pool.map((r) => r.sym),
      others.map((r) => r.sym),
    );
    const row = pool.find((r) => r.sym === id) ?? others.find((r) => r.sym === id) ?? pool[0];
    card.current = { cheated: learn, tries: 0, shown: now(), ms: undefined, replays: 0, units: [] };
    setCur(row);
    setStrokes([]);
    setMiss(null);
    setPassed(false);
    setCheat(learn ? Date.now() : 0);
    setTries(0);
    setFx("writing");
    playAudio(symbolAudio(row));
  }, [data, set, focusSyms, learn, review]);

  useEffect(() => {
    if (data && ready) next();
  }, [data, set, focusSyms, learn, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishCard = useCallback(
    (row: MoeRow, passed: boolean) => {
      const c = card.current;
      const first = firstTry(passed, c.cheated, c.tries);
      // In learn mode the strokes are shown: a right copy moves the symbol on, but it is not a test.
      review().answer(
        row.sym,
        learn ? passed && c.tries === 0 : first,
        !learn,
        !learn && passed && c.cheated && c.tries < 3,
      );
      setStats((s) => ({
        cards: s.cards + 1,
        firstTry: s.firstTry + (first ? 1 : 0),
        streak: first ? s.streak + 1 : 0,
        right: s.right + (passed ? 1 : 0),
      }));
      const units: Unit[] = c.units.length
        ? c.units
        : [{ kind: "symbol", expected: row.sym, actual: null, ok: false, help: c.cheated }];
      api.event({
        area: "dictation",
        item: row.sym,
        ok: first,
        first_try: first,
        ms: c.ms,
        tries: c.tries + (passed ? 1 : 0),
        help: c.cheated,
        replays: c.replays,
        units,
        details: { skipped: !passed, set, focus: focus.active ? focus.label : undefined, learn: learn || undefined },
      });
    },
    [set, focus, learn, review],
  );

  // Grade after every stroke. Pass as soon as the strokes match in shape and order.
  // Count a miss only when the full stroke count is reached and the symbol is still wrong.
  const onStrokes = (s: Pt[][]) => {
    if (!cur || !data || !T || passed !== false) return;
    setStrokes(s);
    if (fx === "wrong" && s.length) setFx("writing");
    const full = data.strokes[cur.sym]?.length ?? 1;
    if (s.length < (SHORT_FORM.has(cur.sym) ? full - 1 : full)) return;
    const g = gradeSyllable(
      cur.sym,
      [s],
      T,
      data.table.map((r) => r.sym),
      false,
    );
    const row = g.rows.find((x) => x.kind === "symbol");
    const r = row?.kind === "symbol" ? row.r : null;
    // Save each full try: the symbol it looked like, every stroke's status, and the stroke order.
    const c = card.current;
    const log = () => {
      c.ms ??= since(c.shown);
      c.units.push(...writtenUnits(cur.sym, r, { try_n: c.tries, help: c.cheated }));
    };
    if (g.nearly) {
      log();
      setPassed(r);
      setFx("right");
      setFxKey((k) => k + 1);
      playSfx("right");
      finishCard(cur, true);
      timer.current = setTimeout(next, r && !r.ok ? 1800 : 1000);
      return;
    }
    if (s.length < full) return;
    log();
    card.current.tries += 1;
    setTries(card.current.tries);
    setMiss({ ink: s, r });
    setStrokes([]);
    setFx("wrong");
    setFxKey((k) => k + 1);
    playSfx("wrong");
  };

  const showStrokes = useCallback(() => {
    if (!cur) return;
    card.current.cheated = true;
    setCheat(Date.now());
    setStrokes([]);
  }, [cur]);

  const done = passed !== false;
  const canSkip = cheat > 0 && tries >= 3 && !done;
  const skip = () => {
    if (cur) {
      finishCard(cur, false);
      next();
    }
  };
  const hear = () => {
    if (!cur) return;
    if (passed === false) card.current.replays += 1;
    playAudio(symbolAudio(cur));
  };
  useHotkeys("dictation", [
    { keys: ["Space"], label: "Hear again", run: hear, when: !!cur },
    { keys: ["KeyH"], label: cheat ? "Show strokes again" : "Show strokes", run: showStrokes, when: !!cur && !done },
    {
      keys: ["Backspace", "Ctrl+KeyZ"],
      label: "Undo stroke",
      run: () => setStrokes((s) => s.slice(0, -1)),
      when: !done && strokes.length > 0,
      repeat: true,
    },
    { keys: ["Delete"], label: "Clear", run: () => setStrokes([]), when: !done && strokes.length > 0 },
    { keys: ["KeyN"], label: "Skip", run: skip, when: canSkip },
    ...cycleKeys("Symbol set", SETS, set, setSet),
  ]);

  if (!data || !T) return <div className="text-muted">Loading stroke data…</div>;
  const name = cur ? SYMBOL_NAME[cur.sym] : null;
  const missText =
    miss && cur
      ? (miss.r?.recognized && miss.r.recognized !== cur.sym && !cheat
          ? "That looks like " + miss.r.recognized + ". "
          : "") + (miss.r?.messages.find((m) => !m.startsWith("This looks like")) ?? "Not quite.")
      : "";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex flex-wrap gap-2 items-center">
        <FocusChip focus={focus} empty={focus.active && !focused.length} />
        {SETS.map((k) => (
          <button key={k} className="chip cjk" data-active={!focused.length && set === k} onClick={() => setSet(k)}>
            {SET_LABEL[k]}
          </button>
        ))}
        <div className="ml-auto text-sm text-muted">
          {learn ? (
            <>
              <b className="text-ink">{stats.right}</b> right copies
            </>
          ) : (
            <>
              <b className="text-ink">{stats.streak}</b> streak ·{" "}
              {stats.cards ? Math.round((100 * stats.firstTry) / stats.cards) : 0}% first try of {stats.cards}
            </>
          )}
        </div>
      </div>

      {cur && name && (
        <div
          className={
            "card stage border-2 p-5 flex flex-1 flex-col items-center justify-center gap-3 transition-colors duration-300 " +
            (done ? "border-ok bg-ok/5" : fx === "wrong" ? "border-bad/60 bg-bad/5" : "border-line")
          }
        >
          <div className="flex items-center gap-4">
            <PlayButton big src={symbolAudio(cur)} title="Play again (Space)" />
            <StatusPill
              status={fx}
              label={
                fx === "wrong"
                  ? "Not quite, write it again"
                  : fx === "writing"
                    ? cheat
                      ? "Trace it"
                      : "Write what you hear"
                    : undefined
              }
            />
          </div>

          <div className="flex flex-wrap items-start justify-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <FxFrame status={fx} attempt={fxKey} round={false}>
                <Pad
                  size={PAD}
                  strokes={strokes}
                  onChange={onStrokes}
                  disabled={done}
                  guide={cheat && !done ? <Guide sym={cur.sym} data={data.strokes} /> : undefined}
                  overlay={
                    done && passed ? <ResultOverlay r={passed} strokes={strokes} data={data.strokes} /> : undefined
                  }
                  state={done ? (passed && passed.ok ? "ok" : "nearly") : null}
                />
              </FxFrame>
              <div className="flex gap-2">
                <button
                  className="btn !px-3 !py-1.5 text-xs text-muted max-md:!px-5 max-md:!py-2.5 max-md:text-sm"
                  disabled={done}
                  onClick={() => setStrokes((s) => s.slice(0, -1))}
                >
                  ↶ Undo <Kbd>⌫</Kbd>
                </button>
                <button
                  className="btn !px-3 !py-1.5 text-xs text-muted max-md:!px-5 max-md:!py-2.5 max-md:text-sm"
                  disabled={done}
                  onClick={() => setStrokes([])}
                >
                  Clear <Kbd>Del</Kbd>
                </button>
              </div>
            </div>
            {cheat > 0 && (
              <div className="flex flex-col items-center gap-2">
                <StrokeAnim sym={cur.sym} data={data.strokes} size={PAD} playKey={cheat} />
                <button className="text-xs text-accent px-1" onClick={() => setCheat(Date.now())}>
                  Replay strokes
                </button>
              </div>
            )}
            {miss && !done && (
              <div className="flex flex-col items-center gap-2">
                <Pad
                  size={120}
                  strokes={miss.ink}
                  onChange={() => {}}
                  disabled
                  overlay={miss.r ? <ResultOverlay r={miss.r} strokes={miss.ink} data={data.strokes} /> : undefined}
                  state="bad"
                />
                <div className="text-xs text-muted">Your last try</div>
              </div>
            )}
          </div>

          <div className="min-h-12 text-center text-sm max-w-xl cjk">
            {done ? (
              <span className="text-ok text-lg font-semibold">
                ✓ {cur.sym}
                {name !== cur.sym && <span className="text-muted font-normal text-base"> ({name})</span>}
                {passed && !passed.ok && (
                  <span className="block text-sm text-rough font-normal">
                    Accepted, with a small shape note. {passed.messages[0] ?? ""}
                  </span>
                )}
              </span>
            ) : miss ? (
              <span className="text-bad">{missText} Write it again.</span>
            ) : cheat ? (
              <span className="text-muted">Trace the grey shape in the stroke order shown. {NOTES[cur.sym] ?? ""}</span>
            ) : (
              <span className="text-muted">Write the symbol you hear. It checks itself after each stroke.</span>
            )}
          </div>

          <ActionBar tone={done ? (passed && !passed.ok ? "close" : "ok") : fx === "wrong" ? "bad" : null}>
            <button className="btn" onClick={showStrokes} disabled={done}>
              {cheat ? "Show strokes again" : "Show strokes"} <Kbd>H</Kbd>
            </button>
            {canSkip && (
              <button className="btn text-muted" onClick={skip}>
                Skip <Kbd>N</Kbd>
              </button>
            )}
          </ActionBar>
        </div>
      )}
    </div>
  );
}
