"use client";
// The learner's settings for the card order (lib/review.ts): one slider per setting, for all exercises or for one.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  DEFAULT_REVIEW,
  EMPTY_REVIEW,
  type ExerciseKey,
  loadReviewSettings,
  rememberReviewSettings,
  resolveReview,
  REVIEW_EXERCISES,
  REVIEW_STOPS,
  type ReviewConfig,
  type ReviewKey,
  type SavedReview,
} from "@/lib/reviewSettings";
import { EXERCISE_NAMES, MAIN_KEYS, MORE_KEYS, REVIEW_TEXT } from "./reviewText";

type Tab = "all" | ExerciseKey;

/** The stop nearest to a value, so an old or odd saved value still sits on the slider. */
const nearest = (stops: number[], v: number) =>
  stops.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(stops[best] - v) ? i : best), 0);

export function ReviewSettings() {
  const [saved, setSaved] = useState<SavedReview>(EMPTY_REVIEW);
  const [tab, setTab] = useState<Tab>("all");
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadReviewSettings()
      .then(setSaved)
      .catch(() => {});
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Save a moment after the last change, so dragging a slider sends one request.
  const store = (next: SavedReview) => {
    setSaved(next);
    rememberReviewSettings(next);
    setNote("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .saveSettings({ review: next })
        .then((m) => {
          if (m.review) rememberReviewSettings(m.review);
          setNote("Saved. Open a practice page to use it.");
        })
        .catch((e: Error) => setNote(e.message));
    }, 600);
  };

  const own = tab === "all" ? saved.all : (saved.exercises[tab] ?? {});
  const shown = resolveReview(saved, tab === "all" ? undefined : tab);
  const base = resolveReview({ all: saved.all, exercises: {} });

  const setPart = (part: Partial<ReviewConfig>) =>
    store(tab === "all" ? { ...saved, all: part } : { ...saved, exercises: { ...saved.exercises, [tab]: part } });
  const change = (key: ReviewKey, v: number) => {
    const part = { ...own, [key]: v };
    // A value equal to what it would be anyway is not a change: drop it, so a later change for all exercises applies.
    if (v === (tab === "all" ? DEFAULT_REVIEW : base)[key]) delete part[key];
    setPart(part);
  };
  const reset = (key: ReviewKey) => {
    const part = { ...own };
    delete part[key];
    setPart(part);
  };
  const changed = Object.keys(own).length > 0;

  const row = (key: ReviewKey) => (
    <Slider
      key={key}
      k={key}
      config={shown}
      own={key in own}
      tab={tab}
      onChange={(v) => change(key, v)}
      onReset={() => reset(key)}
    />
  );

  return (
    <div id="card-order" className="card flex scroll-mt-4 flex-col gap-4 p-5">
      <div>
        <h2 className="font-semibold">How cards come back</h2>
        <p className="mt-1 text-sm text-muted">
          The app picks the next card for you: new things in small groups, mistakes again soon, and things you know on
          later days, before you forget them. Move the sliders to change how it picks. The first values are the ones we
          recommend. You can change all exercises at once, or one exercise only.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="chip" data-active={tab === "all"} onClick={() => setTab("all")}>
          All exercises
        </button>
        {REVIEW_EXERCISES.map((e) => (
          <button key={e} className="chip" data-active={tab === e} onClick={() => setTab(e)}>
            {EXERCISE_NAMES[e]}
            {saved.exercises[e] && Object.keys(saved.exercises[e]!).length ? " •" : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {tab === "all"
          ? "These settings apply to every exercise, unless an exercise has its own value (marked with •)."
          : "Changes here apply to " +
            EXERCISE_NAMES[tab] +
            " only. Settings you do not change here follow All exercises."}
      </p>
      <div className="flex flex-col gap-5">{MAIN_KEYS.map(row)}</div>
      <button className="chip self-start" onClick={() => setMore((m) => !m)}>
        {more ? "Fewer settings" : "More settings"}
      </button>
      {more && <div className="flex flex-col gap-5">{MORE_KEYS.map(row)}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {changed && (
          <button className="chip" onClick={() => setPart({})}>
            {tab === "all" ? "Back to the recommended values" : "Use All exercises for " + EXERCISE_NAMES[tab]}
          </button>
        )}
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
    </div>
  );
}

function Slider({
  k,
  config,
  own,
  tab,
  onChange,
  onReset,
}: {
  k: ReviewKey;
  config: ReviewConfig;
  own: boolean;
  tab: Tab;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  const t = REVIEW_TEXT[k];
  const stops = REVIEW_STOPS[k];
  const v = config[k];
  const i = nearest(stops, v);
  const recommended = v === DEFAULT_REVIEW[k];
  return (
    <div className="grid gap-2 md:grid-cols-[220px_1fr]">
      <div>
        <div className="text-sm font-medium">{t.title}</div>
        <div className="text-xs text-muted">{t.what}</div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{t.label(v)}</span>
          {recommended && <span className="text-xs text-muted">(recommended)</span>}
          {own && tab !== "all" && (
            <button className="chip text-xs" onClick={onReset}>
              Use All exercises
            </button>
          )}
          {!recommended && (
            <button className="text-xs text-muted underline" onClick={() => onChange(DEFAULT_REVIEW[k])}>
              Recommended: {t.label(DEFAULT_REVIEW[k])}
            </button>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={i}
          aria-label={t.title}
          aria-valuetext={t.label(v)}
          onChange={(e) => onChange(stops[Number(e.target.value)])}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-xs text-muted">
          <span>{t.ends[0]}</span>
          <span>{t.ends[1]}</span>
        </div>
        <div className="text-xs">For example: {t.example(config)}</div>
      </div>
    </div>
  );
}
