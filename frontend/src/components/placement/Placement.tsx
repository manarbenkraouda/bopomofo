"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { api, type Placement as Content, type PlacementResult } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alphabet } from "./Alphabet";
import { Intro } from "./Intro";
import { Result } from "./Result";
import { type Card } from "./types";
import { Voice } from "./Voice";

/**
 * The placement test, once, after the onboarding of a learner who speaks everyday Mandarin or more (backend/app/placement.py).
 * 1. The alphabet (only for learners who know some Bopomofo): type each symbol's pinyin, with three attempts without hints.
 * 2. The voice: say 42 syllables (every symbol and tone), then 12 sentences. Up to three recordings each; the speech check scores sounds and tones.
 * About 10 minutes. A reload resumes where the learner stopped.
 * Every answer is saved as a normal Recognize or Speaking answer. At the end the server scores the answers and opens levels.
 * Keyboard: Enter checks and continues, Space records and stops (and is "I don't know" in the alphabet), → skips a card.
 */

type Part = "loading" | "intro" | "alphabet" | "voice" | "saving" | "result";

type Draft = { part: Part; order: string; i: number; vi: number; alphaIds: number[]; voiceIds: number[]; ts?: number };

// The test in progress, kept on the device: closing the tab and coming back resumes it. The server counts answers of the last
// 6 hours only (placement.MAX_AGE), so an older draft starts again.
const DRAFT_KEY = "zhuyin.placement";

const DRAFT_MAX_MS = 5 * 3600 * 1000;

const shuffle = (s: string) => {
  const a = [...s];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join("");
};

export function Placement() {
  const router = useRouter();
  const [content, setContent] = useState<Content | null>(null);
  const [d, setD] = useState<Draft>({ part: "loading", order: "", i: 0, vi: 0, alphaIds: [], voiceIds: [] });
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<Promise<unknown>[]>([]);
  // The saved answers of the test (event ids). A ref: finish() must see ids saved after the last render.
  const ids = useRef({ alphaIds: [] as number[], voiceIds: [] as number[] });
  const addId = (k: "alphaIds" | "voiceIds", id: number) => {
    if (ids.current[k].includes(id)) return;
    ids.current = { ...ids.current, [k]: [...ids.current[k], id] };
    setD((x) => ({ ...x, ...ids.current }));
  };

  // Load the test. A done test shows its result; a learner without a due test goes home. A reload resumes the draft.
  useEffect(() => {
    api
      .placement()
      .then((c) => {
        setContent(c);
        if (c.status === "done" && c.result) {
          setResult(c.result);
          setD((x) => ({ ...x, part: "result" }));
          return;
        }
        if (c.status !== "due") {
          router.replace("/");
          return;
        }
        try {
          const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as Draft | null;
          if (
            saved &&
            ["alphabet", "voice"].includes(saved.part) &&
            saved.order.length === c.symbols.length &&
            Date.now() - (saved.ts ?? 0) < DRAFT_MAX_MS
          ) {
            ids.current = { alphaIds: saved.alphaIds, voiceIds: saved.voiceIds };
            setD(saved);
            return;
          }
        } catch {}
        setD({ part: "intro", order: shuffle(c.symbols), i: 0, vi: 0, alphaIds: [], voiceIds: [] });
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);
  useEffect(() => {
    if (d.part === "alphabet" || d.part === "voice")
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, ts: d.ts ?? Date.now() }));
  }, [d]);

  const cards: Card[] = content
    ? [
        ...content.syllables.map((s) => ({ ...s, mode: "syllable" as const })),
        ...content.sentences.map((s) => ({ ...s, mode: "sentence" as const })),
      ]
    : [];

  const finish = useCallback(async (voiceSkipped: boolean, none = false) => {
    setD((x) => ({ ...x, part: "saving" }));
    setError("");
    await Promise.allSettled(pending.current);
    const use = none ? { alphaIds: [], voiceIds: [] } : ids.current;
    try {
      const r = await api.placementFinish({
        alphabet_ids: use.alphaIds,
        voice_ids: use.voiceIds,
        voice_skipped: voiceSkipped,
      });
      setResult(r.result);
      playSfx("right");
    } catch (e) {
      // Already done (another tab): show the saved result.
      const c = await api.placement().catch(() => null);
      if (c?.result) setResult(c.result);
      else {
        setError((e as Error).message);
        setD((x) => ({ ...x, part: "voice" }));
        return;
      }
    }
    localStorage.removeItem(DRAFT_KEY);
    setD((x) => ({ ...x, part: "result" }));
  }, []);

  // ts: when the test started. The draft is dropped once the first answers are too old for the server.
  const start = () => {
    playSfx("tick");
    setD((x) => ({ ...x, part: content?.alphabet ? "alphabet" : "voice", ts: Date.now() }));
  };
  const skipAll = () => void finish(true, true);

  // The intro and the result screens: Enter is the main button.
  useHotkeys("placement", [
    { keys: ["Enter", "NumpadEnter"], label: "Start the test", run: start, when: d.part === "intro" && !!content },
    {
      keys: ["Enter", "NumpadEnter"],
      label: "Start learning",
      run: () => router.replace("/"),
      when: d.part === "result",
    },
  ]);

  const total = (content?.alphabet ? d.order.length : 0) + cards.length;
  const doneCount =
    d.part === "alphabet"
      ? d.i
      : d.part === "voice"
        ? (content?.alphabet ? d.order.length : 0) + d.vi
        : d.part === "result" || d.part === "saving"
          ? total
          : 0;
  const first = content?.alphabet ? 1 : 0; // part numbers: the alphabet part comes first when there is one
  const partLabel =
    d.part === "alphabet"
      ? "Part 1 · Symbols"
      : cards[d.vi]?.mode === "sentence"
        ? "Part " + (first + 2) + " · Sentences"
        : "Part " + (first + 1) + " · Sounds";

  return (
    <div className="flex h-full flex-col">
      <header className="pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-3 md:h-16 md:px-6">
          {d.part === "alphabet" || d.part === "voice" ? (
            <>
              <span className="w-28 shrink-0 text-xs font-semibold text-muted">{partLabel}</span>
              <div
                className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={doneCount}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-500"
                  style={{ width: (100 * doneCount) / Math.max(1, total) + "%" }}
                />
              </div>
              <span className="w-12 text-right text-xs font-semibold tabular-nums text-muted">
                {doneCount}/{total}
              </span>
            </>
          ) : (
            <span className="h-10" />
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-5 pb-[calc(var(--ab-space,0px)+1.25rem)] pt-2 md:pt-6">
          {d.part === "loading" && <div className="m-auto text-muted">{error || "Loading…"}</div>}
          {d.part === "intro" && content && (
            <Intro
              alphabet={content.alphabet}
              syllables={content.syllables.length}
              sentences={content.sentences.length}
            />
          )}
          {d.part === "alphabet" && (
            <Alphabet
              key={d.i}
              sym={d.order[d.i]}
              onAnswer={(p) => {
                pending.current.push(
                  p.then((id) => {
                    if (id) addId("alphaIds", id);
                  }),
                );
              }}
              onNext={() =>
                setD((x) => (x.i + 1 >= x.order.length ? { ...x, i: x.i + 1, part: "voice" } : { ...x, i: x.i + 1 }))
              }
            />
          )}
          {d.part === "voice" && cards[d.vi] && (
            <Voice
              key={d.vi}
              card={cards[d.vi]}
              last={d.vi + 1 >= cards.length}
              onAnswer={(id) => addId("voiceIds", id)}
              onNext={() => {
                if (d.vi + 1 >= cards.length) void finish(false);
                else setD((x) => ({ ...x, vi: x.vi + 1 }));
              }}
              onSkipVoice={() => void finish(true)}
              error={error}
            />
          )}
          {d.part === "saving" && (
            <div className="m-auto flex flex-col items-center gap-3 text-center">
              <BoboPose pose="thinking" className="w-36" />
              <p className="text-muted">Bobo is reading your answers…</p>
            </div>
          )}
          {d.part === "result" && result && <Result r={result} />}
        </div>
      </main>
      {(d.part === "intro" || d.part === "result") && (
        <div className="mx-auto w-full max-w-lg px-5 md:pb-8 md:pt-4">
          <ActionBar>
            {d.part === "intro" && (
              <button className="btn justify-center md:flex-1 md:!py-3" onClick={skipAll}>
                Skip, start from level 1
              </button>
            )}
            <button
              className="btn btn-accent ab-primary justify-center font-semibold md:flex-1 md:!py-3 md:text-base"
              onClick={d.part === "intro" ? start : () => router.replace("/")}
            >
              {d.part === "intro" ? "Start the test" : "Start learning"}
              <Kbd className="max-md:!hidden">Enter</Kbd>
            </button>
          </ActionBar>
        </div>
      )}
    </div>
  );
}
