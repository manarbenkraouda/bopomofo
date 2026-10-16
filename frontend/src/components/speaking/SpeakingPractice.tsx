"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  api,
  ttsUrl,
  type Health,
  type RulePhrase,
  type Sentence,
  type SpeechResult,
  type Syl,
  type TextItem,
} from "@/lib/api";
import { playAudio } from "@/lib/audio";
import { FocusChip, matches, useFocus, type Focus } from "@/lib/focus";
import { cycleKeys, useHotkeys } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { holdHint, useHoldMic, type Clip } from "@/lib/useHoldMic";
import { useReview } from "@/lib/review";
import { correctedScore, pollDeepCheck } from "@/lib/deepCheck";
import { loadData, syllableAudio, TONE_NAME, type SyllableItem } from "@/lib/zhuyin";
import { PlayButton } from "@/components/PlayButton";
import { ActionBar } from "@/components/shell/ActionBar";
import { PHONE, useViewport } from "@/lib/useFit";
import { PitchChart } from "@/components/PitchChart";
import { ZhuyinText } from "@/components/ZhuyinText";
import { Burst, FxFrame, StatusPill, useCountUp, type FxStatus } from "@/components/quiz/Feedback";
import { PinyinCheck } from "@/components/quiz/PinyinCheck";
import { Kbd } from "@/components/shell/Kbd";
import { RulesGuide, ruleLine, type Rules } from "@/components/listening/RuleQuiz";
import { useLevels } from "@/lib/levels";

type Source = "rule" | "sentence" | "syllable" | "custom";
type Card = { text: string; items: TextItem[]; english?: string; audio: string; slow?: string; rule?: RulePhrase };
const SOURCES: Source[] = ["rule", "sentence", "syllable", "custom"];
const SOURCE_LABEL: Record<Source, string> = {
  rule: "Tone rules",
  sentence: "Sentences",
  syllable: "Syllables",
  custom: "My own text",
};
const RULE_NAME: Record<string, string> = { "3-3": "3-3 rule", bu: "不 rule", yi: "一 rule" };
const grade = (score: number): FxStatus => (score >= 85 ? "right" : score >= 60 ? "close" : "wrong");
const verdict = (score: number) =>
  (score >= 85 ? "Excellent! " : score >= 60 ? "Almost: " : "Keep practicing: ") + score;
/** The score of a right recording, as the backend saves it (stats.log_speaking). */
const RIGHT = 80;
/** Misses of a one-syllable card before the app asks what the learner said: the model can mix up close sounds (b and p). */
const CHECK_AFTER = 3;
/** The typed Pinyin check: not asked yet, open, closed with Esc (it can open again), or answered. */
type Check = "none" | "open" | "closed" | "done";
/** A recording where the model heard another initial or final (or nothing). */
const soundMiss = (r: SpeechResult) =>
  r.syllables.some((s) => !s.heard || s.initial_ok === false || s.final_ok === false);
/** For speaking, a tone focus means the tone as said (after tone changes). */
const sylMatch = (i: Syl, f: Focus) =>
  (!f.tones.length || f.tones.includes(i.surface_tone)) &&
  (!f.syms.length || f.syms.some((x) => (i.initial + i.final).includes(x)));
/** The Pinyin of a text, with the punctuation kept next to the word before it. */
const pinyinOf = (items: TextItem[]) =>
  items
    .map((i) => (i.type === "syllable" ? i.pinyin : i.text))
    .join(" ")
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1");
const sentenceCard = (s: Sentence): Card => ({
  text: s.hanzi,
  items: s.items,
  english: s.english,
  audio: ttsUrl(s.hanzi),
  slow: ttsUrl(s.hanzi, -35),
});
const ruleCard = (p: RulePhrase): Card => ({
  text: p.text,
  items: p.items,
  english: p.english,
  audio: ttsUrl(p.text),
  slow: ttsUrl(p.text, -35),
  rule: p,
});
/** The syllables whose said tone is not the written tone, with the rule that changes them. */
const changed = (items: TextItem[]) =>
  items.filter((i): i is Syl => i.type === "syllable" && i.surface_tone !== i.tone);
const saidZhuyin = (s: Syl) =>
  s.zhuyin.replace(/[ˊˇˋ˙]/g, "") +
  ({ 1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ", 5: "" } as Record<number, string>)[s.surface_tone];

/** Before recording: every tone the rules change in this text, said plainly. The Bopomofo shows the written tone only. */
function ToneChanges({ items }: { items: TextItem[] }) {
  const list = changed(items);
  if (!list.length) return null;
  return (
    <div className="flex flex-col items-center gap-1 text-sm cjk max-w-2xl" role="note">
      <div className="text-muted">The tone changes here. Say it this way:</div>
      <div className="flex flex-wrap justify-center gap-2">
        {list.map((s, i) => (
          <span key={i} className="rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1">
            <b>{s.char}</b> <span className="text-muted line-through decoration-1">{s.zhuyin}</span> →{" "}
            <b className="text-accent">{saidZhuyin(s)}</b>
            <span className="text-muted"> · {s.rule ? RULE_NAME[s.rule] : "tone change"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Speaking, as a quiz: one card at a time. Read it aloud and record.
 * The model audio and the Pinyin are the cheat: they unlock with one button (Space), and the recordings after it count as helped.
 */
export function SpeakingPractice() {
  const params = useSearchParams();
  const [health, setHealth] = useState<Health | null>(null);
  const [source, setSource] = useState<Source>(() =>
    params.get("text")
      ? "custom"
      : ((["syllable", "custom", "rule"] as const).find((s) => s === params.get("source")) ?? "sentence"),
  );
  // Only the card types of the learner's level: a locked one (also from a link) falls back to the first open one.
  const { open, known } = useLevels();
  const sources = SOURCES.filter((s) => open("speaking/" + s));
  const openKey = sources.join(",");
  useEffect(() => {
    if (known && sources.length && !sources.includes(source)) setSource(sources[0]);
  }, [known, openKey, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const [allSentences, setSentences] = useState<Sentence[] | null>(null);
  const [allSylls, setSylls] = useState<SyllableItem[]>([]);
  const [ruleData, setRuleData] = useState<{ rules: Rules; phrases: RulePhrase[] } | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [custom, setCustom] = useState(params.get("text") ?? "");
  const [bopo, setBopo] = useState(true);
  const [cheated, setCheated] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fxKey, setFxKey] = useState(0);
  const [session, setSession] = useState({ n: 0, sum: 0, streak: 0 });
  const [typedCheck, setTypedCheck] = useState<Check>("none");
  const [typedNote, setTypedNote] = useState("");
  const [deepNote, setDeepNote] = useState("");
  const { w: vw } = useViewport();
  const fileRef = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);
  // The card in progress: the cheat and the number of recordings already checked, for the stats.
  // eventIds: the saved recordings of this card. misses: recordings without the cheat where a sound was heard wrong.
  const meta = useRef({ card: null as Card | null, cheat: false, tries: 0, eventIds: [] as number[], misses: 0 });
  // The answer on screen (its saved event id). A deep check result only changes the card when it is about this answer.
  const shown = useRef<number | null>(null);
  const alive = useRef(true);
  const firstSentence = useRef(Number(params.get("sentence")) || 0);
  const focus = useFocus();
  // The card order: a few new cards at a time, repeated at growing gaps, and reviews when they are due (lib/review.ts).
  // Coach sentences (?ids=) come in the coach's order, the others in a mixed order.
  const { review, ready: scheduled } = useReview("speaking", source, { order: focus.ids.length ? "pool" : "shuffle" });

  // The focus from the stats or the coach narrows the cards. Coach sentences (?ids=) keep the coach's order. With no match, all cards stay.
  const fSent = useMemo(() => {
    const all = allSentences ?? [];
    if (focus.ids.length) return focus.ids.map((id) => all.find((s) => s.id === id)).filter((s): s is Sentence => !!s);
    return focus.active ? all.filter((s) => s.items.some((i) => i.type === "syllable" && sylMatch(i, focus))) : all;
  }, [allSentences, focus]);
  const fSyl = useMemo(() => allSylls.filter((s) => matches(s.zhuyin, focus)), [allSylls, focus]);
  const fRule = useMemo(
    () => (ruleData?.phrases ?? []).filter((p) => !focus.rules.length || focus.rules.includes(p.rule)),
    [ruleData, focus],
  );
  const sentences = fSent.length ? fSent : (allSentences ?? []);
  const sylls = fSyl.length ? fSyl : allSylls;
  const phrases = fRule.length ? fRule : (ruleData?.phrases ?? []);
  const sentenceKey = sentences.map((s) => s.id).join(",");
  const syllKey = sylls.map((s) => s.id).join(",");
  const phraseKey = phrases.map((p) => p.text).join(",");
  /** The next sentence or syllable from the schedule. The key is the text, as saved with each recording. */
  const nextSentence = () => {
    const t = review().next(sentences.map((s) => s.hanzi));
    return sentences.find((s) => s.hanzi === t);
  };
  // With a focus, some syllables come from the others, so a few weak sounds do not loop (lib/review.ts).
  const nextSyllable = () => {
    const others = fSyl.length && focus.active ? allSylls : [];
    const t = review().next(
      sylls.map((s) => s.char),
      others.map((s) => s.char),
    );
    return sylls.find((s) => s.char === t) ?? others.find((s) => s.char === t);
  };
  const nextPhrase = () => {
    const t = review().next(phrases.map((p) => p.text));
    return phrases.find((p) => p.text === t);
  };

  const clearRecording = () => {
    setResult(null);
    setError("");
    setDeepNote("");
    shown.current = null;
    setMine((m) => {
      if (m) URL.revokeObjectURL(m);
      return null;
    });
  };
  const show = useCallback((c: Card | null) => {
    clearRecording();
    meta.current = { card: c, cheat: false, tries: 0, eventIds: [], misses: 0 };
    setCheated(false);
    setTypedCheck("none");
    setTypedNote("");
    setCard(c);
  }, []);
  const showSyllable = useCallback(
    async (s: SyllableItem) => {
      const id = ++loadId.current;
      const r = await api.analyzeText(s.char).catch(() => null);
      if (id === loadId.current) show({ text: s.char, items: r?.items ?? [], audio: syllableAudio(s.id) });
    },
    [show],
  );
  const applyText = async (t: string) => {
    const text = t.trim();
    if (!text) return;
    const id = ++loadId.current;
    try {
      const r = await api.analyzeText(text);
      if (id !== loadId.current) return;
      show({ text, items: r.items, audio: ttsUrl(text), slow: ttsUrl(text, -35) });
      api
        .translate(text)
        .then((tr) => setCard((cur) => (cur && cur.text === text ? { ...cur, english: tr.english } : cur)))
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    const poll = () =>
      api
        .health()
        .then((h) => {
          setHealth(h);
          if (h.speech_model === "loading") setTimeout(poll, 2000);
        })
        .catch(() => setHealth(null));
    poll();
    loadData().then((d) => setSylls(d.syllables));
    api
      .sentences()
      .then((r) => setSentences(r.sentences))
      .catch((e) => {
        setSentences([]);
        setError(String(e.message ?? e));
      });
    api
      .rules()
      .then(setRuleData)
      .catch(() => {});
    if (params.get("text")) applyText(params.get("text") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A link with ?source= picks the card type.
  const sourceParam = params.get("source");
  useEffect(() => {
    if (sourceParam === "sentence" || sourceParam === "syllable" || sourceParam === "rule") setSource(sourceParam);
  }, [sourceParam]);
  // A new set of sentences starts from the schedule. A link with ?sentence= starts on that one.
  useEffect(() => {
    if (source !== "sentence" || !sentences.length || !scheduled) return;
    const s = sentences.find((x) => x.id === firstSentence.current) ?? nextSentence();
    firstSentence.current = 0;
    loadId.current++;
    if (s) show(sentenceCard(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sentenceKey, scheduled]);
  useEffect(() => {
    if (source !== "syllable" || !sylls.length || !scheduled) return;
    const s = nextSyllable();
    if (s) showSyllable(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, syllKey, scheduled]);
  useEffect(() => {
    if (source !== "rule" || !phrases.length || !scheduled) return;
    const p = nextPhrase();
    loadId.current++;
    if (p) show(ruleCard(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, phraseKey, scheduled]);
  useEffect(() => {
    if (source === "custom" && !params.get("text")) {
      loadId.current++;
      show(null);
    }
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Press and hold to record: the microphone stays open, and each recording keeps half a second from before the press,
  // so the first consonant (b, p, d, t) is not cut.
  const ready = health?.speech_model === "ready";
  const hold = useHoldMic({
    active: ready,
    maxS: 15,
    onClip: (c) => void onClipRef.current(c),
    onDiscard: (why) => setError(holdHint(why, "R", vw < PHONE)),
  });
  const rec: "idle" | "recording" | "analyzing" = analyzing ? "analyzing" : hold.holding ? "recording" : "idle";
  const level = hold.level;

  const next = () => {
    if (rec !== "idle") return;
    // A card left without a recording comes back a little later; its memory does not change.
    if (source !== "custom" && card && meta.current.tries === 0) review().skip(card.text);
    if (source === "sentence" && sentences.length) {
      const s = nextSentence();
      if (s) show(sentenceCard(s));
    } else if (source === "syllable" && sylls.length) {
      const s = nextSyllable();
      if (s) showSyllable(s);
    } else if (source === "rule" && phrases.length) {
      const p = nextPhrase();
      if (p) show(ruleCard(p));
    } else if (source === "custom") {
      loadId.current++;
      show(null);
    }
  };

  const cheat = () => {
    if (!card) return;
    meta.current.cheat = true;
    setCheated(true);
    playAudio(card.audio);
  };
  /** Hearing one syllable is also help for the next recording of this card. */
  const hearSyllable = (char: string) => {
    meta.current.cheat = true;
    setCheated(true);
    playAudio(ttsUrl(char));
  };

  const check = async (audio: Blob) => {
    const m = meta.current;
    if (!m.card) return;
    const c = m.card;
    try {
      const r = await api.speech(audio, c.text, source, { help: m.cheat, tryN: m.tries });
      if (meta.current.card !== c) return;
      // The first recording of a card is the test: right without the cheat moves it on in the schedule.
      if (m.tries === 0 && source !== "custom") review().answer(c.text, r.score >= RIGHT && !m.cheat);
      m.tries += 1;
      if (r.event_id) m.eventIds.push(r.event_id);
      // One-syllable cards: after 3 sound misses without the cheat, ask once what the learner said.
      if (r.score < RIGHT && !m.cheat && soundMiss(r)) m.misses += 1;
      if (c.items.filter((x) => x.type === "syllable").length === 1 && m.misses >= CHECK_AFTER && !m.cheat)
        setTypedCheck((s) => (s === "none" ? "open" : s));
      setResult(r);
      shown.current = r.event_id ?? null;
      if (r.event_id && r.deep_check === "queued") void pollDeep(r.event_id, c);
      const g = grade(r.score);
      playSfx(g === "right" ? "right" : g === "close" ? "close" : "wrong");
      setFxKey((k) => k + 1);
      setSession((s) => ({ n: s.n + 1, sum: s.sum + r.score, streak: g === "right" ? s.streak + 1 : 0 }));
      api
        .health()
        .then(setHealth)
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** After a missed answer, wait for the closer check. A miss it corrected: show the new score here, and mark the notice
   *  seen so no toast repeats it. Partial and real misses, and the shadow mode, show nothing. */
  const pollDeep = async (eventId: number, c: Card) => {
    const d = await pollDeepCheck(
      () => api.deepCheck(eventId),
      () => alive.current && meta.current.card === c,
    );
    const score = correctedScore(d);
    // Only when this answer is still the one on screen: a newer recording of the card replaced it otherwise.
    if (score == null || shown.current !== eventId) return;
    setDeepNote("This was right after a closer check. Your score is now " + score + ".");
    setResult((x) => x && { ...x, score });
    if (d?.notice_id) void api.levelsSeen([d.notice_id]);
  };
  /** The learner typed the sound they said. Same sound: the sound misses of this card count as right (the tones stay as checked). */
  const checkTyped = async (typed: string): Promise<string | null> => {
    const m = meta.current;
    const c = m.card;
    if (!c || !m.eventIds.length) return null;
    const r = await api.confirmSpeech(m.eventIds, typed);
    if (meta.current.card !== c) return null;
    setTypedCheck("done");
    if (r.match) {
      setTypedNote(
        "Thanks! The microphone heard the sound wrong, so these recordings count as right sounds. The tone is checked as before.",
      );
      setResult((x) => x && { ...x, syllables: x.syllables.map((s) => ({ ...s, initial_ok: true, final_ok: true })) });
      playSfx("right");
    } else {
      setTypedNote("You typed " + typed + ". This one is " + pinyinOf(c.items) + ". Listen, then try again or skip.");
      cheat();
    }
    return null;
  };
  const press = () => {
    clearRecording();
    void hold.press();
  };
  const onClip = async (c: Clip) => {
    setAnalyzing(true);
    setMine(URL.createObjectURL(c.wav));
    playSfx("tick");
    await check(c.wav);
    setAnalyzing(false);
  };
  const onClipRef = useRef(onClip);
  useEffect(() => {
    onClipRef.current = onClip;
  });
  const upload = async (f: File) => {
    if (!card) return;
    clearRecording();
    setMine(URL.createObjectURL(f));
    setAnalyzing(true);
    await check(f);
    setAnalyzing(false);
  };

  const marks = useMemo(
    () =>
      result?.syllables.map((s) =>
        !s.heard ? "#d23f3f" : s.tone_ok && s.initial_ok !== false && s.final_ok !== false ? "#2f9466" : "#d23f3f",
      ),
    [result],
  );
  const canRecord = ready && !!card && rec !== "analyzing" && typedCheck !== "open";
  const canNext =
    rec === "idle" &&
    (source === "custom"
      ? !!card
      : source === "sentence"
        ? sentences.length > 0
        : source === "rule"
          ? phrases.length > 0
          : sylls.length > 0);

  useHotkeys("speaking", [
    {
      keys: ["KeyR"],
      label: result ? "Hold to try again" : "Hold to record",
      run: press,
      up: () => void hold.release(),
      when: canRecord,
    },
    { keys: ["Space"], label: cheated ? "Hear it again" : "Cheat: hear it", run: cheat, when: !!card },
    {
      keys: ["Shift+Space"],
      label: "Slow",
      run: () => card?.slow && playAudio(card.slow),
      when: cheated && !!card?.slow,
    },
    { keys: ["KeyP"], label: "My recording", run: () => mine && playAudio(mine), when: !!mine && rec === "idle" },
    { keys: ["Enter"], label: source === "custom" ? "New text" : "Next", run: next, when: canNext && !!result },
    { keys: ["KeyN"], label: "Skip", run: next, when: canNext && !result && source !== "custom" },
    { keys: ["KeyZ"], label: bopo ? "Hide Bopomofo" : "Show Bopomofo", run: () => setBopo((b) => !b), bar: false },
    {
      keys: ["KeyU"],
      label: "Upload a recording",
      run: () => fileRef.current?.click(),
      when: !!card && rec === "idle" && ready,
      bar: false,
    },
    {
      keys: ["Ctrl+Enter"],
      label: "Practice this text",
      run: () => applyText(custom),
      when: source === "custom" && !card && !!custom.trim(),
      input: true,
      bar: false,
    },
    ...cycleKeys("Card type", sources.length ? sources : SOURCES, source, setSource, sources.length > 1),
  ]);

  const single = card ? card.items.filter((x) => x.type === "syllable").length === 1 : false;
  const phone = vw < PHONE;
  const fx: FxStatus =
    rec === "recording" ? "hearing" : rec === "analyzing" ? "checking" : result ? grade(result.score) : "idle";
  const pill =
    rec === "recording"
      ? "Recording… let go when done"
      : rec === "analyzing"
        ? "Checking…"
        : result
          ? verdict(result.score)
          : cheated
            ? "Now say it yourself"
            : "Read it aloud";
  const tone = result && rec === "idle" ? (fx === "right" ? "ok" : fx === "close" ? "close" : "bad") : null;
  const avg = session.n ? Math.round(session.sum / session.n) : 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="chips flex flex-wrap items-center gap-2">
        {sources.length > 1 &&
          sources.map((s) => (
            <button key={s} className="chip" data-active={source === s} onClick={() => setSource(s)}>
              {SOURCE_LABEL[s]}
            </button>
          ))}
        <FocusChip
          focus={focus}
          empty={
            focus.active && (source === "sentence" ? !fSent.length : source === "rule" ? !fRule.length : !fSyl.length)
          }
        />
        <button
          className="chip cjk"
          data-active={bopo}
          onClick={() => setBopo((b) => !b)}
          title="Show or hide the Bopomofo (Z)"
        >
          注音
        </button>
        <div className="ml-auto text-sm text-muted">
          <b className="text-ink">{session.streak}</b> streak
          {session.n > 0 && (
            <>
              {" "}
              · avg <b className="text-ink">{avg}</b> of {session.n}
            </>
          )}
        </div>
      </div>

      {health && !ready && (
        <div className="card p-3 text-sm text-rough">
          {health.speech_model === "loading"
            ? "The speech check is getting ready (a few seconds)…"
            : "The speech check is not available right now. Please try again later."}
        </div>
      )}
      {!health && (
        <div className="card p-3 text-sm text-bad">Can&apos;t connect right now. Please try again in a moment.</div>
      )}

      {source === "custom" && !card ? (
        <div className="card stage border-2 border-line p-5 md:p-8 flex flex-1 flex-col items-center justify-center gap-4">
          <StatusPill status="writing" label="Type what you want to say" />
          <textarea
            className="input cjk text-xl w-full max-w-2xl min-h-32"
            autoFocus
            placeholder="輸入中文，例如：你今天過得怎麼樣？"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <p className="text-sm text-muted text-center max-w-md">
            Anything your partner says. You get Bopomofo, a translation, and a check of every syllable.
          </p>
          <ActionBar>
            <button className="btn btn-primary ab-primary" disabled={!custom.trim()} onClick={() => applyText(custom)}>
              Practice this text <Kbd className="max-md:!hidden">Ctrl</Kbd>
              <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          </ActionBar>
          {error && <div className="text-bad text-sm">{error}</div>}
        </div>
      ) : card ? (
        <div
          className={
            "card stage border-2 p-5 md:p-8 flex flex-col items-center justify-center gap-5 transition-colors duration-300 " +
            (result ? "" : "flex-1 ") +
            (fx === "right"
              ? "border-ok bg-ok/5"
              : fx === "close"
                ? "border-rough/70"
                : fx === "wrong"
                  ? "border-bad/60 bg-bad/5"
                  : fx === "checking"
                    ? "border-rough/70"
                    : fx === "hearing"
                      ? "border-accent/50"
                      : "border-line")
          }
        >
          <div className="flex w-full items-center justify-center gap-3">
            <StatusPill status={fx} label={pill} />
          </div>

          <div className="relative flex flex-col items-center gap-3 text-center">
            {fx === "right" && <Burst key={fxKey} count={14} distance={140} />}
            <FxFrame status={fx} level={level} attempt={fxKey} round={false}>
              <div className="px-2">
                <ZhuyinText
                  items={card.items}
                  annot={bopo ? "zhuyin" : "none"}
                  size={single ? 96 : phone ? 40 : 56}
                  marks={marks}
                  onSyllable={
                    cheated
                      ? (i) => {
                          const s = card.items.filter((x) => x.type === "syllable")[i];
                          if (s && s.type === "syllable") hearSyllable(s.char);
                        }
                      : undefined
                  }
                />
              </div>
            </FxFrame>
            {cheated && card.items.length > 0 && (
              <div className="text-lg md:text-xl text-accent tracking-wide">{pinyinOf(card.items)}</div>
            )}
            {card.english && <div className="text-muted">{card.english}</div>}
          </div>
          {/* The rule drill tests the rule: its answer shows after the cheat or the check. Everywhere else, tone changes show before recording. */}
          {(source !== "rule" || cheated || result) && <ToneChanges items={card.items} />}
          {card.rule && ruleData && (cheated || result) && (
            <div className="text-sm text-muted text-center max-w-xl cjk">{ruleLine(card.rule, ruleData.rules)}</div>
          )}
          {card.rule && !cheated && !result && (
            <div className="text-sm text-muted text-center max-w-xl">
              Say it with the tone rules: the Bopomofo shows the written tone.
            </div>
          )}

          {single && health && !health.speaker_hz && !result && (
            <div className="text-sm text-rough text-center max-w-md">
              Tip: record one full sentence first. The app then learns your voice, which makes single-syllable tone
              checks more accurate.
            </div>
          )}
          {typedNote && (
            <div className="text-sm text-center max-w-md cjk text-muted" role="status">
              {typedNote}
            </div>
          )}
          {deepNote && (
            <div className="text-sm text-center max-w-md text-ok" role="status">
              {deepNote}
            </div>
          )}
          {typedCheck === "open" && rec === "idle" && (
            <PinyinCheck example="po, ma, or zi" check={checkTyped} onClose={() => setTypedCheck("closed")} />
          )}
          {(error || hold.error) && <div className="text-bad text-sm">{error || hold.error}</div>}

          <div className="w-full max-w-3xl">
            <ActionBar
              tone={tone}
              title={tone ? verdict(result!.score) : undefined}
              detail={
                tone
                  ? "Tones " +
                    result!.syllables.filter((s) => s.tone_ok).length +
                    "/" +
                    result!.syllables.length +
                    " correct · details below"
                  : undefined
              }
            >
              <button
                className="btn"
                onClick={cheat}
                title={
                  cheated
                    ? "Hear it again (Space)"
                    : "Hear it and see the Pinyin. The next recording counts as helped. (Space)"
                }
              >
                {cheated ? <>▶ {phone ? "Hear" : "Hear it again"}</> : <>💡 Cheat</>}{" "}
                <Kbd className="max-md:!hidden">Space</Kbd>
              </button>
              {cheated && card.slow && <PlayButton src={card.slow} label="Slow" />}
              {typedCheck === "closed" && !cheated && (
                <button
                  className="btn"
                  onClick={() => setTypedCheck("open")}
                  title="The microphone can mix up close sounds"
                >
                  Type what you said
                </button>
              )}
              {mine && rec === "idle" && <PlayButton src={mine} label={phone ? "Mine" : "My recording"} />}
              <div className="flex-1 max-md:!hidden" />
              {canNext &&
                (result ? (
                  <button className="btn" onClick={next}>
                    {source === "custom" ? "New text" : "Next"} <Kbd className="max-md:!hidden">Enter</Kbd>
                  </button>
                ) : (
                  source !== "custom" && (
                    <button className="btn text-muted" onClick={next}>
                      Skip <Kbd className="max-md:!hidden">N</Kbd>
                    </button>
                  )
                ))}
              {rec === "recording" && (
                <div className="w-24 h-2 rounded bg-line overflow-hidden max-md:!hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: Math.round(level * 100) + "%" }} />
                </div>
              )}
              <button
                {...hold.bind}
                onPointerDown={(e) => {
                  if (e.button === 0) clearRecording();
                  hold.bind.onPointerDown(e);
                }}
                disabled={!canRecord}
                aria-label="Hold to record"
                className={
                  "btn ab-primary !rounded-full !px-6 !py-3 text-base " +
                  (rec === "recording" ? "btn-accent recording" : "btn-primary")
                }
              >
                {rec === "idle" ? (
                  hold.state === "opening" ? (
                    "Starting the mic…"
                  ) : (
                    <>
                      ● Hold to {result ? "try again" : "record"} <Kbd className="max-md:!hidden">R</Kbd>
                    </>
                  )
                ) : rec === "recording" ? (
                  "● Recording… let go"
                ) : (
                  "Checking…"
                )}
              </button>
            </ActionBar>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted max-md:hidden">
            {source === "custom" && (
              <button className="hover:text-ink" onClick={next}>
                Change the text
              </button>
            )}
            <label
              className={"hover:text-ink " + (ready && rec === "idle" ? "cursor-pointer" : "opacity-50")}
              title="Check an audio file (wav, mp3, flac, ogg)"
            >
              Upload a recording (U)
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.wav,.mp3,.flac,.ogg"
                className="hidden"
                disabled={!ready || rec !== "idle"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) upload(f);
                }}
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="card stage border-2 border-line p-8 flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted">
          {source === "sentence" && allSentences && !allSentences.length ? (
            <>
              No sentences yet.
              <Link className="btn btn-primary" href="/sentences">
                Create some sentences
              </Link>
            </>
          ) : (
            "Loading…"
          )}
          {error && <div className="text-bad text-sm">{error}</div>}
        </div>
      )}

      {result && card && <ResultView key={fxKey} result={result} onHear={hearSyllable} />}
      {ruleData && (source === "rule" || (card && changed(card.items).length > 0)) && (
        <RulesGuide rules={ruleData.rules} />
      )}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg text-muted">{label} –</span>;
  return (
    <span className={"text-[11px] px-1.5 py-0.5 rounded " + (ok ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad")}>
      {label} {ok ? "✓" : "✗"}
    </span>
  );
}

/** What the check heard, syllable by syllable. The pitch chart and the tone guide are folded. */
function ResultView({ result, onHear }: { result: SpeechResult; onHear: (char: string) => void }) {
  const sy = result.syllables;
  const tone = sy.filter((s) => s.tone_ok).length;
  const sounds = sy.filter((s) => s.heard && s.initial_ok !== false && s.final_ok !== false).length;
  const shown = useCountUp(result.score);
  return (
    <div className="card p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap">
        <div
          className={
            "text-4xl font-semibold tabular-nums " +
            (result.score >= 85 ? "text-ok" : result.score >= 60 ? "text-rough" : "text-bad")
          }
        >
          {shown}
        </div>
        <div className="text-muted">
          tones{" "}
          <b className="text-ink">
            {tone}/{sy.length}
          </b>{" "}
          · sounds{" "}
          <b className="text-ink">
            {sounds}/{sy.length}
          </b>
        </div>
        <div className="text-xs text-muted sm:ml-auto">Tap a syllable to hear it</div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
        {sy.map((s, i) => {
          const ok = s.heard && s.tone_ok && s.initial_ok !== false && s.final_ok !== false;
          return (
            <button
              key={i}
              onClick={() => onHear(s.expected.char)}
              className={
                "text-left rounded-xl border p-3 hover:shadow-sm " +
                (ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5")
              }
            >
              <div className="flex items-center gap-2 cjk">
                <span className="text-2xl">{s.expected.char}</span>
                <span className="text-accent">{s.expected.zhuyin}</span>
                <span className="ml-auto text-sm">
                  {ok ? <span className="text-ok">✓</span> : <span className="text-bad">✗</span>}
                </span>
              </div>
              <div className="text-xs text-muted mt-1 cjk">
                {s.expected.surface_tone !== s.expected.tone && (
                  <>
                    written {s.expected.zhuyin} · say <b className="text-accent">{saidZhuyin(s.expected)}</b>
                    {s.expected.rule ? " (" + RULE_NAME[s.expected.rule] + ")" : ""} ·{" "}
                  </>
                )}
                heard <b className="text-ink">{s.heard?.zhuyin ?? "—"}</b>
              </div>
              {s.rule_error === "literal" && (
                <div className="mt-2 text-xs font-semibold text-bad">
                  You read the written tone. The {RULE_NAME[s.rule ?? ""] ?? "tone rule"} changes it here.
                </div>
              )}
              {s.rule_error === "over" && (
                <div className="mt-2 text-xs font-semibold text-bad">
                  The {RULE_NAME[s.rule ?? ""]} does not apply here: keep the written tone.
                </div>
              )}
              {!ok && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  <Badge ok={s.heard ? s.initial_ok : false} label="initial" />
                  <Badge ok={s.heard ? s.final_ok : false} label="final" />
                  <Badge ok={s.tone_ok} label="tone" />
                </div>
              )}
              {s.messages.length > 0 && (
                <ul className="mt-2 text-xs leading-snug list-disc pl-4 cjk">
                  {s.messages.map((m, k) => (
                    <li key={k}>{m}</li>
                  ))}
                </ul>
              )}
              {s.tone_source === "pitch" && (
                <div className="text-[11px] text-muted mt-1">Tone estimated from your voice.</div>
              )}
              {s.tone_source === "model+pitch" && (
                <div className="text-[11px] text-muted mt-1">
                  Low falling tone 3 (Taiwan style), from your pitch range.
                </div>
              )}
              {s.uncertain && !s.tone_ok && !s.rule_error && (
                <div className="text-[11px] text-rough mt-1">
                  Hard to hear: it sounded between tone {s.model_tone} and tone {s.pitch_tone}.
                </div>
              )}
            </button>
          );
        })}
      </div>
      {result.extra.length > 0 && (
        <div className="text-sm text-muted cjk">Extra sounds heard: {result.extra.map((e) => e.zhuyin).join(" ")}</div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Pitch curve</summary>
        <div className="mt-2 text-xs text-muted mb-1">
          Your pitch (black) against the target tone shapes (colored bands), per syllable
        </div>
        <PitchChart result={result} />
      </details>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Tone guide</summary>
        <ul className="mt-2 grid sm:grid-cols-2 gap-1">
          {[1, 2, 3, 4, 5].map((t) => (
            <li key={t}>{TONE_NAME[t]}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
