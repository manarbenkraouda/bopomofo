"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ttsUrl, type RuleId, type RulePhrase, type ToneRule } from "@/lib/api";
import { firstTryResult } from "@/lib/attempts";
import { playAudio } from "@/lib/audio";
import { FocusChip, useFocus } from "@/lib/focus";
import { ANSWER_KEYS, ANSWER_LETTERS, useHotkeys, type Hotkey } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { useReview } from "@/lib/review";
import { now, since } from "@/lib/track";
import { splitZhuyin, TONE_MARK, TONE_NAME } from "@/lib/zhuyin";
import { ZhuyinText } from "@/components/ZhuyinText";
import { Burst, fxClass, StatusPill } from "@/components/quiz/Feedback";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";

export type Rules = Record<RuleId, ToneRule>;
const withTone = (z: string, t: number) => splitZhuyin(z).symbols.join("") + TONE_MARK[t];
const toneMark = (t: number) => ["ˉ", "ˊ", "ˇ", "ˋ"][t - 1];

/** What 不 and 一 do when the rule does not change them. */
const KEEP: Partial<Record<RuleId, string>> = {
  bu: "不 stays tone 4 here. It changes to tone 2 only before tone 4.",
  yi: "一 stays tone 1 here: alone, at the end of a word, or in numbers like 第一 and 星期一.",
};

/** The explanation of one phrase: what is written, what is said, and why. */
export function ruleLine(p: RulePhrase, rules: Rules): string {
  const r = rules[p.rule];
  if (p.changes)
    return `${p.char} is written ${p.zhuyin} (tone ${p.written}), but here you say ${p.said_zhuyin} (tone ${p.said}). ${r.name}: ${r.short}`;
  if (KEEP[p.rule]) return KEEP[p.rule]!;
  return `${p.char} keeps its written tone 3 here: the next syllable is not tone 3. ${r.name}: ${r.short}`;
}

/**
 * The tone rule quiz: a short word in Bopomofo, one syllable marked. Which tone do you say there?
 * The written Bopomofo shows the dictionary tone. The rules (3-3, 不, 一) change it in words, and the learner must know when.
 * Learn mode (?learn=1): the rule and the answer are shown first; the learner picks the said tone to repeat it.
 */
export function RuleQuiz({ chips, hotkeys }: { chips: React.ReactNode; hotkeys: Hotkey[] }) {
  const [rules, setRules] = useState<Rules | null>(null);
  const [phrases, setPhrases] = useState<RulePhrase[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState<RulePhrase | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [misses, setMisses] = useState<number[]>([]);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const replays = useRef(0);
  const attempt = useRef({ cardId: "", tries: 0 });
  const focus = useFocus();
  const learn = useSearchParams().get("learn") === "1";
  const { review, ready } = useReview("listening", "rule");

  useEffect(() => {
    api
      .rules()
      .then((r) => {
        setRules(r.rules);
        setPhrases(r.phrases);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  const matching = useMemo(
    () => phrases.filter((p) => !focus.rules.length || focus.rules.includes(p.rule)),
    [phrases, focus],
  );
  const pool = matching.length ? matching : phrases;

  const next = useCallback(() => {
    if (advance.current) clearTimeout(advance.current);
    if (!pool.length) return;
    const t = review().next(pool.map((p) => p.text));
    const p = pool.find((x) => x.text === t) ?? pool[0];
    setQ(p);
    setPicked(null);
    setMisses([]);
    attempt.current = { cardId: crypto.randomUUID(), tries: 0 };
    shownAt.current = now();
    replays.current = 0;
    if (learn) playAudio(ttsUrl(p.text));
  }, [pool, review, learn]);

  useEffect(() => {
    if (pool.length && ready) next();
  }, [pool, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (advance.current) clearTimeout(advance.current);
    },
    [],
  );

  const choose = useCallback(
    (tone: number) => {
      if (!q || picked !== null || misses.includes(tone)) return;
      const cur = attempt.current;
      const ok = tone === q.said;
      const counted = learn ? ok : firstTryResult(ok, false, cur.tries);
      if (counted !== null) setPicked(tone);
      else setMisses((m) => [...m, tone]);
      // literal: picked the written tone where the rule changes it. over: changed 不 or 一 where the tone stays.
      const error = ok
        ? null
        : q.changes && tone === q.written
          ? "literal"
          : !q.changes && q.rule !== "3-3"
            ? "over"
            : "other";
      if (counted !== null) {
        review().answer(q.text, counted, !learn);
        setScore((s) => ({ n: s.n + 1, ok: s.ok + (counted ? 1 : 0), streak: counted ? s.streak + 1 : 0 }));
      }
      api.event({
        area: "listening",
        mode: "rule",
        item: q.text,
        ok,
        first_try: ok && !learn,
        tries: cur.tries + 1,
        ms: since(shownAt.current),
        replays: replays.current,
        help: learn,
        units: [
          {
            kind: "sandhi",
            expected: q.rule,
            actual: tone,
            ok,
            ctx: q.char,
            lex: q.written,
            help: learn,
            try_n: cur.tries,
            extra: { said: q.said, error, zhuyin: q.zhuyin },
          },
        ],
        details: {
          attempt_card: cur.cardId,
          picked: tone,
          focus: focus.active ? focus.label : undefined,
          learn: learn || undefined,
        },
      });
      cur.tries += 1;
      playSfx(ok ? "right" : "wrong");
      if (counted !== null) playAudio(ttsUrl(q.text));
      // Right: move on by itself. Wrong: wait, so the learner can read the rule.
      if (ok) advance.current = setTimeout(next, learn ? 1400 : 1800);
    },
    [q, picked, misses, review, learn, focus, next],
  );

  useHotkeys("rules", [
    ...ANSWER_KEYS.map((keys, i) => ({
      keys,
      label: "Tone " + (i + 1),
      run: () => choose(i + 1),
      when: !!q && picked === null,
      bar: false,
    })),
    { keys: [], label: "Answer", show: ["1-4", "/", "A S D F"], when: !!q && picked === null },
    {
      keys: ["Space"],
      label: "Hear it",
      run: () => {
        if (q) {
          if (picked === null) replays.current += 1;
          playAudio(ttsUrl(q.text));
        }
      },
      when: !!q && (learn || picked !== null),
    },
    { keys: ["Enter", "KeyN"], label: "Next", run: next, when: picked !== null },
    ...hotkeys,
  ]);

  const right = picked !== null && q && picked === q.said;
  const syl = q ? q.items.filter((i) => i.type === "syllable") : [];
  const marks = q ? syl.map((_, i) => (i === q.target ? "var(--color-accent, #d9572b)" : undefined)) : [];
  const rule = q && rules ? rules[q.rule] : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex gap-2 items-center flex-wrap">
        {chips}
        <FocusChip focus={focus} empty={focus.active && !matching.length} />
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{score.streak}</b> streak · {score.n ? Math.round((100 * score.ok) / score.n) : 0}% of{" "}
          {score.n}
        </div>
      </div>
      {error && <div className="card p-3 text-sm text-bad">{error}</div>}
      {q && rules && rule && (
        <div
          className={
            "card stage border-2 p-5 md:p-8 flex flex-1 flex-col items-center justify-center gap-5 md:gap-6 transition-colors duration-300 " +
            (picked === null ? "border-line" : right ? "border-ok bg-ok/5" : "border-bad/60 bg-bad/5")
          }
        >
          <StatusPill
            status={picked === null ? (learn ? "listening" : "writing") : right ? "right" : "wrong"}
            label={
              picked === null
                ? learn
                  ? "Learn the rule, then pick the tone you say"
                  : "Which tone do you say?"
                : right
                  ? "Correct!"
                  : "Not quite"
            }
          />
          {(learn || picked !== null) && (
            <div
              className={
                "max-w-2xl w-full rounded-xl border px-4 py-3 text-sm md:text-base cjk " +
                (picked !== null && !right ? "border-bad/40 bg-bad/5" : "border-accent/40 bg-accent/5")
              }
            >
              {picked !== null && !right && (
                <div className="font-semibold mb-1">
                  {q.changes && picked === q.written
                    ? `You picked the written tone (${q.zhuyin}). The rule changes it here.`
                    : !q.changes
                      ? `You changed the tone, but here it stays ${q.zhuyin}.`
                      : `You picked tone ${picked}.`}
                </div>
              )}
              <div>{ruleLine(q, rules)}</div>
              {learn && picked === null && <div className="text-muted mt-1">{rule.explain}</div>}
            </div>
          )}
          <div className="flex flex-col items-center gap-2 text-center">
            <ZhuyinText items={q.items} annot="zhuyin" size={64} marks={marks} />
            <div className="text-muted">{q.english}</div>
          </div>
          <div className="text-muted text-center cjk">
            How do you say <b className="text-ink text-lg">{q.char}</b> in {q.text}?
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
            {[1, 2, 3, 4].map((t, i) => {
              const isAns = t === q.said,
                show = picked !== null || learn;
              const isRight = show && isAns,
                wrong = misses.includes(t) || (picked === t && !isAns);
              const fx = picked === t ? fxClass(isAns ? "right" : "wrong") : "";
              return (
                <button
                  key={t}
                  onClick={() => choose(t)}
                  disabled={picked !== null || misses.includes(t)}
                  className={
                    "tile relative rounded-2xl border-2 px-4 pb-4 pt-6 md:pt-8 text-center transition " +
                    fx +
                    " " +
                    (isRight
                      ? "border-ok bg-ok/10"
                      : wrong
                        ? "border-bad bg-bad/10"
                        : picked !== null
                          ? "border-line bg-card opacity-60"
                          : "border-line bg-card hover:border-accent hover:-translate-y-0.5")
                  }
                >
                  {isAns && picked === t && <Burst count={12} distance={90} />}
                  <span className="absolute left-3 top-3 flex gap-1">
                    <Kbd>{i + 1}</Kbd>
                    <Kbd>{ANSWER_LETTERS[i]}</Kbd>
                  </span>
                  <div className="cjk text-3xl md:text-4xl">{withTone(q.zhuyin, t) || toneMark(t)}</div>
                  <div className="text-xs text-muted mt-1">{TONE_NAME[t]}</div>
                  {t === q.written && <div className="text-[11px] text-muted mt-0.5">written</div>}
                </button>
              );
            })}
          </div>
          {picked === null && misses.length > 0 && (
            <p role="status" className="text-bad">
              Not quite. Try again.
            </p>
          )}
          {picked !== null && (
            <div className="flex flex-col items-center gap-2 max-md:hidden">
              <button className="btn" onClick={next}>
                Next <Kbd>Enter</Kbd>
              </button>
            </div>
          )}
          {picked !== null && (
            <ActionBar
              mobileOnly
              tone={right ? "ok" : "bad"}
              title={right ? "Correct!" : "Not quite"}
              detail={
                <span className="cjk">
                  {q.char}: say <span className="text-accent">{q.said_zhuyin}</span>
                </span>
              }
            >
              <button
                className={
                  "btn ab-primary " + (right ? "!bg-ok !border-ok !text-white" : "!bg-bad !border-bad !text-white")
                }
                onClick={next}
              >
                Continue
              </button>
            </ActionBar>
          )}
        </div>
      )}
      {rules && <RulesGuide rules={rules} />}
    </div>
  );
}

/** The three rules, folded. Also used on the Speaking screen. */
export function RulesGuide({ rules, open = false }: { rules: Rules; open?: boolean }) {
  return (
    <details className="card p-4 text-sm" open={open}>
      <summary className="cursor-pointer text-muted">
        The tone rules: the Bopomofo shows the written tone, not always the tone you say
      </summary>
      <ul className="mt-3 flex flex-col gap-2 cjk">
        {(Object.keys(rules) as RuleId[]).map((id) => (
          <li key={id}>
            <b>{rules[id].name}.</b> {rules[id].explain}
          </li>
        ))}
      </ul>
    </details>
  );
}
