"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Health, type SymbolCheck, type Unit } from "@/lib/api";
import { onPlaying, playAudio } from "@/lib/audio";
import { FocusChip, focusSymbols, useFocus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { Listener, type Utterance } from "@/lib/listener";
import { cycleNext, inSet, pickWeighted, SET_LABEL, SYMBOL_NAME as NAME, updateMiss, type SymbolSet as Set_ } from "@/lib/quiz";
import { playSfx, type Sfx } from "@/lib/sfx";
import { now, since } from "@/lib/track";
import { loadData, symbolAudio, type MoeRow } from "@/lib/zhuyin";
import { FxFrame, StatusPill } from "@/components/quiz/Feedback";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";

type Status = "idle" | "listening" | "hearing" | "checking" | "wrong" | "right";
const SETS = Object.keys(SET_LABEL) as Set_[];

export function ReadingQuiz() {
  const [rows, setRows] = useState<MoeRow[]>([]);
  const [set, setSet] = useState<Set_>("all");
  const [cur, setCur] = useState<MoeRow | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [level, setLevel] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tries, setTries] = useState(0);
  const [last, setLast] = useState<SymbolCheck | null>(null);
  const [stats, setStats] = useState({ cards: 0, firstTry: 0, streak: 0, right: 0 });
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [fxKey, setFxKey] = useState(0); // replays the result animation on every new result

  const listener = useRef<Listener | null>(null);
  const curRef = useRef<MoeRow | null>(null);
  const busy = useRef(false);
  const card = useRef({ revealed: false, tries: 0, shown: 0, ms: undefined as number | undefined, units: [] as Unit[] });
  const recent = useRef<string[]>([]);
  const missRate = useRef<Record<string, number>>({});
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerPlaying = useRef(false);
  const unmuteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starting = useRef(false); // a start is in progress (the microphone permission can take a while)
  const shown = useRef(true); // false after the page is left
  const focus = useFocus();
  // Learn mode (?learn=1): every card plays the symbol and shows its name, and the learner repeats it. Each right repetition counts.
  const learn = useSearchParams().get("learn") === "1";
  const order = useRef<string[]>([]);

  // Play a sound effect with the microphone muted, so the quiz does not grade its own sounds.
  const fx = useCallback((kind: Sfx) => {
    const ms = playSfx(kind);
    const l = listener.current;
    if (!ms || !l) return;
    l.muted = true;
    if (unmuteTimer.current) clearTimeout(unmuteTimer.current);
    unmuteTimer.current = setTimeout(() => { if (listener.current && !answerPlaying.current) listener.current.muted = false; }, ms + 150);
  }, []);

  useEffect(() => {
    loadData().then((d) => setRows(d.table));
    // Start from what the progress history says is weak, then adapt during the session.
    api.summary().then((s) => {
      missRate.current = Object.fromEntries(Object.entries(s.symbols_by_area?.reading ?? s.symbols).map(([k, v]) => [k, (v.err + 1) / (v.n + 2)]));
    }).catch(() => {});
    let stop = false;
    const poll = () => api.health().then((h) => { if (stop) return; setHealth(h); if (h.speech_model === "loading") setTimeout(poll, 2000); }).catch(() => !stop && setHealth("down"));
    poll();
    return () => { stop = true; };
  }, []);

  // The focus from the stats screen (?syms=ㄗ,ㄘ) narrows the cards. With no match, the chosen set stays.
  const focusSyms = focusSymbols(focus).join("");
  const focused = rows.filter((r) => focusSyms.includes(r.sym));
  const pool = useCallback(() => (focused.length ? focused : inSet(rows, set)), [rows, set, focusSyms]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    const p = pool();
    if (!p.length) return;
    const row = learn ? cycleNext(p, order.current, curRef.current?.sym) : pickWeighted(p, missRate.current, recent.current);
    recent.current = [...recent.current, row.sym].slice(-Math.min(4, p.length - 1));
    curRef.current = row;
    card.current = { revealed: learn, tries: 0, shown: now(), ms: undefined, units: [] };
    busy.current = false;
    listener.current?.reset();
    setCur(row);
    setRevealed(learn);
    setTries(0);
    setLast(null);
    setHint("");
    setStatus((s) => (s === "idle" ? s : "listening"));
    if (learn) playAudio(symbolAudio(row));
  }, [pool, learn]);

  useEffect(() => { if (rows.length) next(); }, [rows.length, set, focusSyms, learn]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishCard = useCallback((ok: boolean) => {
    const row = curRef.current;
    if (!row) return;
    const c = card.current;
    const firstTry = ok && !c.revealed && c.tries === 0;
    missRate.current[row.sym] = updateMiss(missRate.current[row.sym], firstTry);
    setStats((s) => ({ cards: s.cards + 1, firstTry: s.firstTry + (firstTry ? 1 : 0), streak: firstTry ? s.streak + 1 : 0, right: s.right + (ok ? 1 : 0) }));
    const units: Unit[] = c.units.length ? c.units : [{ kind: "symbol", expected: row.sym, actual: null, ok: false, help: c.revealed }];
    api.event({ area: "reading", item: row.sym, ok: firstTry, first_try: firstTry, ms: c.ms, tries: c.tries + (ok ? 1 : 0), help: c.revealed, units,
      details: { skipped: !ok, set, focus: focus.active ? focus.label : undefined, learn: learn || undefined } });
  }, [set, focus, learn]);

  const onUtterance = useCallback(async (u: Utterance) => {
    const row = curRef.current;
    if (!row || busy.current) return;
    busy.current = true;
    setHint("");
    setStatus("checking");
    fx("tick");
    try {
      const r = await api.checkSymbol(u.wav, row.sym);
      if (curRef.current !== row) return;
      // Every try is saved: what the model heard (or the closest name when it was not sure), and if the answer was shown before.
      const c = card.current;
      c.ms ??= since(c.shown);
      c.units.push({ kind: "symbol", expected: row.sym, actual: r.heard ?? r.closest, ok: r.ok, try_n: c.units.length, help: c.revealed,
        uncertain: !r.heard, extra: { fit: Math.round(r.fit * 100) / 100, lenient: r.lenient || undefined, top: r.ranking.slice(0, 3) } });
      setLast(r);
      setError("");
      setFxKey((k) => k + 1);
      if (r.ok) {
        setStatus("right");
        fx("right");
        finishCard(true);
        advanceTimer.current = setTimeout(next, r.lenient ? 2600 : 1000);
        return;
      }
      card.current.tries += 1;
      setTries(card.current.tries);
      setStatus("wrong");
      fx("wrong");
    } catch (e) {
      setError((e as Error).message);
      setStatus("listening");
    }
    busy.current = false;
  }, [finishCard, next, fx]);

  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => { onUtteranceRef.current = onUtterance; }, [onUtterance]);

  const start = async () => {
    if (starting.current || listener.current) return;
    starting.current = true;
    setError("");
    try {
      const l = new Listener();
      l.onUtterance = (u) => onUtteranceRef.current(u);
      l.onDiscard = (why) => {
        if (busy.current) return;
        setHint(why === "short" ? "Too short to check. Hold the sound a little longer." : "Too quiet to pick up. Speak louder or move closer to the microphone.");
      };
      l.onLevel = (v, speaking) => {
        setLevel(v);
        setStatus((s) => (speaking && !busy.current ? "hearing" : !speaking && s === "hearing" ? "listening" : s));
      };
      await l.start();
      if (!shown.current) { await l.stop(); return; }
      listener.current = l;
      setRunning(true);
      setStatus("listening");
    } catch (e) {
      setError("Microphone not available: " + (e as Error).message);
    } finally {
      starting.current = false;
    }
  };
  const stop = async () => {
    const l = listener.current;
    listener.current = null;
    await l?.stop();
    setRunning(false);
    setStatus("idle");
    setLevel(0);
  };
  // Leaving the page stops the microphone. Next.js keeps the page state for a quick return, so reset it to "paused" too.
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
      const l = listener.current;
      listener.current = null;
      l?.stop();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      setRunning(false);
      setStatus("idle");
      setLevel(0);
    };
  }, []);

  // Do not grade the app's own voice: mute the microphone while an answer recording plays.
  useEffect(() => onPlaying((src) => {
    answerPlaying.current = !!src;
    if (!listener.current) return;
    if (src) { listener.current.muted = true; return; }
    setTimeout(() => { if (listener.current) listener.current.muted = false; }, 300);
  }), []);

  const reveal = useCallback(() => {
    if (!curRef.current) return;
    card.current.revealed = true;
    setRevealed(true);
    playAudio(symbolAudio(curRef.current));
  }, []);

  const skip = () => { finishCard(false); next(); };

  const modelReady = health !== null && health !== "down" && health.speech_model === "ready";

  // Start the microphone by itself when the page opens and the model is ready, if the browser allows it
  // (the user already clicked or typed in the app). Runs again each time the page is shown.
  useEffect(() => {
    if (!modelReady) return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua?.hasBeenActive && !listener.current) start();
  }, [modelReady]);

  const canSkip = revealed && tries >= 3 && status !== "right";
  useHotkeys("reading", [
    { keys: ["KeyR", "Enter"], label: running ? "Pause mic" : "Start mic", run: () => { if (running) stop(); else start(); }, when: running || modelReady },
    { keys: ["Space"], label: revealed ? "Hear it again" : "Hear the answer", run: reveal, when: !!cur },
    { keys: ["KeyN"], label: "Skip", run: skip, when: canSkip },
    { keys: ["Escape"], label: "Pause mic", run: stop, when: running, bar: false },
    ...cycleKeys("Symbol set", SETS, set, setSet),
  ]);

  const name = cur ? NAME[cur.sym] : null;
  const border = status === "right" ? "border-ok bg-ok/5" : status === "wrong" ? "border-bad/60 bg-bad/5" : status === "checking" ? "border-rough/70" : status === "hearing" ? "border-accent/50" : "border-line";
  const symColor = status === "right" ? "text-ok" : status === "wrong" ? "text-bad" : "";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex flex-wrap gap-2 items-center">
        <FocusChip focus={focus} empty={focus.active && !focused.length} />
        {SETS.map((k) => (
          <button key={k} className="chip cjk" data-active={!focused.length && set === k} onClick={() => setSet(k)}>{SET_LABEL[k]}</button>
        ))}
        <div className="ml-auto text-sm text-muted">
          {learn ? <><b className="text-ink">{stats.right}</b> right repetitions</>
            : <><b className="text-ink">{stats.streak}</b> streak · {stats.cards ? Math.round((100 * stats.firstTry) / stats.cards) : 0}% first try of {stats.cards}</>}
        </div>
      </div>

      {health === "down" && <div className="card p-3 text-sm text-bad">Can&apos;t connect right now. Please try again in a moment.</div>}
      {health && health !== "down" && health.speech_model !== "ready" && (
        <div className="card p-3 text-sm text-rough">{health.speech_model === "loading" ? "The speech check is getting ready (a few seconds)…" : "The speech check is not available right now. Please try again later."}</div>
      )}

      {cur && (
        <div className={"card stage border-2 p-8 flex flex-1 flex-col items-center justify-center gap-5 transition-colors duration-300 " + border}>
          <StatusPill status={running || status === "right" || status === "wrong" || status === "checking" ? status : "idle"}
            label={!running && status === "idle" ? "Start the mic to begin" : status === "wrong" ? "Not quite, try again"
              : learn && (status === "listening" || status === "hearing") ? "Listen, then repeat" : undefined} />
          <FxFrame status={status} level={level} attempt={fxKey}>
            <div className={"cjk leading-none select-none text-[clamp(120px,27vh,280px)] px-6 transition-colors duration-300 " + symColor} aria-label={"Say this symbol: " + cur.sym}>{cur.sym}</div>
          </FxFrame>

          <div className="h-16 flex flex-col items-center justify-center text-center">
            {status === "right" ? (
              <>
                <div className="text-ok text-lg font-semibold cjk">✓ {name}</div>
                {last?.lenient && (
                  <div className="text-sm text-rough max-w-md cjk">Passed! {cur.sym} and {last.heard} sound almost the same, so compare yourself with the recording.</div>
                )}
              </>
            ) : revealed && name ? (
              <button className="cjk text-2xl text-accent hover:underline" onClick={reveal} title="Play again (Space)">
                {name} ▶
              </button>
            ) : (
              <div className="text-muted">Read it out loud.</div>
            )}
          </div>

          <div className="h-6 text-sm text-center">
            {hint && status !== "right" && status !== "checking" && !(status === "wrong" && last) && <span className="text-rough">{hint}</span>}
            {status === "wrong" && last && (
              <span className="text-bad cjk">
                {last.heard ? <>I heard {last.heard}. Try again.</> : <>That was not clear enough. The closest symbol was {last.closest}. Try again.</>}
              </span>
            )}
            {status === "wrong" && revealed && tries > 0 && <span className="text-muted"> Now say it yourself to continue.</span>}
          </div>

          <ActionBar tone={status === "right" ? "ok" : status === "wrong" ? "bad" : null}>
            {!running ? (
              <button className="btn btn-primary ab-primary !rounded-full !px-6 !py-3 text-base" onClick={start} disabled={!modelReady}>● Start listening <Kbd>R</Kbd></button>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-muted w-40 max-md:!hidden">
                  <span className={"inline-block w-2.5 h-2.5 rounded-full " + (status === "checking" ? "bg-rough" : status === "hearing" ? "bg-accent recording" : "bg-ok")} />
                  {status === "checking" ? "Checking…" : status === "hearing" ? "Hearing you…" : "Listening"}
                  <div className="flex-1 h-1.5 rounded bg-line overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: Math.round(level * 100) + "%" }} /></div>
                </div>
                <button className="btn ab-primary" onClick={stop}>{status === "checking" ? "Checking…" : status === "hearing" ? "Hearing you…" : "Listening"} · Pause <Kbd>R</Kbd></button>
              </>
            )}
            <button className="btn" onClick={reveal}>{revealed ? "Hear it again" : "Hear the answer"} <Kbd>Space</Kbd></button>
            {canSkip && (
              <button className="btn text-muted" onClick={skip} title="Skip this symbol for now">Skip <Kbd>N</Kbd></button>
            )}
          </ActionBar>
          {error && <div className="text-bad text-sm">{error}</div>}
        </div>
      )}
    </div>
  );
}

