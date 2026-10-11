"use client";
// "How do we know?": the plan's story, like Spotify Wrapped. Cards play by themselves with progress bars at the top.
// Keys: ← → move, Space or P pause, Enter next (or the button on the last card), Esc close. Phone: tap left or right, hold to pause.
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { Kbd } from "@/components/shell/Kbd";
import { BoboFace, BoboPose, type Pose } from "@/components/mascot/Bobo";
import { Block } from "./registry";
import type { Mood, Story, StoryCard } from "./types";

const MOOD: Record<Mood, { bg: string; blob: string }> = {
  warm: { bg: "linear-gradient(160deg,#c24a2c 0%,#6a2131 52%,#1d1019 100%)", blob: "#ff9a6b" },
  calm: { bg: "linear-gradient(160deg,#2366b5 0%,#173c70 52%,#0c1427 100%)", blob: "#63ceff" },
  bright: { bg: "linear-gradient(160deg,#dc9c1f 0%,#8f4d13 55%,#24140a 100%)", blob: "#ffe27a" },
  deep: { bg: "linear-gradient(160deg,#7134c4 0%,#3b1b72 55%,#120a25 100%)", blob: "#cf9bff" },
  win: { bg: "linear-gradient(160deg,#17a06a 0%,#0f5c46 55%,#07201a 100%)", blob: "#86ffc8" },
};

/** Choose Bobo's pose from the exact data and practice modes shown on this story card. */
export function storyPose(card: StoryCard, ctx: Story["context"]): Pose {
  const types = new Set(card.blocks.map((b) => b.type));
  const copy = card.blocks.map((b) => JSON.stringify(b.props)).join(" ").toLowerCase();

  if (types.has("confusion") || /mix.?up|confus|instead|mistake/.test(copy)) return "mixup";
  if (types.has("symbol_grid")) return /dictat|writ|stroke|write_symbols|write_syllables/.test(copy) ? "writing" : "symbol";
  if (/listen_tones|tone|pitch|contour/.test(copy)) return "tones";
  if (/listen_sounds|listening|hear|ear|sound/.test(copy)) return "sound";
  if (/speak_sentences|speak_sounds|speaking|record|voice/.test(copy)) return "speaking";
  if (/write_symbols|write_syllables|dictat|stroke|writing/.test(copy)) return "writing";
  if (/read_symbols|recognize_symbols|reading|alphabet|symbol/.test(copy)) return "symbol";
  if (types.has("steps") || /step|practice plan|next practice/.test(copy)) {
    const exercise = ctx.steps.map((s) => s.type).join(" ").toLowerCase();
    if (/listen_tones/.test(exercise)) return "tones";
    if (/listen_sounds/.test(exercise)) return "sound";
    if (/speak_/.test(exercise)) return "speaking";
    if (/write_/.test(exercise)) return "writing";
    if (/read_symbols|recognize_symbols/.test(exercise)) return "symbol";
    return "plan";
  }
  if (types.has("calendar") || types.has("sparkline") || types.has("bars") || types.has("versus") ||
      types.has("ring") || types.has("big_number")) return "stats";
  if (types.has("cta") || card.mood === "win") return "celebrate";
  if (card.mood === "bright") return "tones";
  if (card.mood === "calm") return "listening";
  if (card.mood === "deep") return "investigate";
  return "welcome";
}

export function StoryPlayer({ planId, onClose, onStart }: { planId: number; onClose: () => void; onStart: () => void }) {
  const [story, setStory] = useState<Story | null>(null);
  const [err, setErr] = useState("");
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasHeld = useRef(false);

  useEffect(() => { api.coachStory(planId).then(setStory).catch((e: Error) => setErr(e.message)); }, [planId]);
  // The page behind does not scroll while the story is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const n = story?.cards.length ?? 0;
  const last = idx >= n - 1;
  const go = useCallback((d: number) => {
    elapsed.current = 0;
    setProgress(0);
    setIdx((i) => Math.max(0, Math.min(n - 1, i + d)));
  }, [n]);

  // The card timer. It stops while paused, held, or when the tab is hidden; the last card waits.
  useEffect(() => {
    if (!story) return;
    const card = story.cards[idx];
    let raf = 0;
    let t0 = performance.now();
    const tick = (t: number) => {
      const dt = t - t0;
      t0 = t;
      if (!paused && !held && document.visibilityState === "visible") elapsed.current += dt;
      const p = Math.min(1, elapsed.current / (card.seconds * 1000));
      setProgress(p);
      if (p >= 1) {
        if (idx < story.cards.length - 1) go(1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, idx, paused, held, go]);

  const act = (a: "start" | "close") => (a === "start" ? onStart() : onClose());
  const card = story?.cards[idx];
  const cta = card?.blocks.find((b) => b.type === "cta");
  const finalAction = () => act(cta && cta.type === "cta" ? cta.props.action : "start");

  useHotkeys("story", [
    { keys: ["ArrowRight", "KeyL"], label: "Next card", run: () => { if (!last) go(1); }, when: !!story },
    { keys: ["ArrowLeft", "KeyH"], label: "Previous card", run: () => go(-1), when: !!story },
    { keys: ["Space", "KeyP"], label: paused ? "Play" : "Pause", run: () => setPaused((p) => !p), when: !!story },
    { keys: ["Enter"], label: last ? "Start the first step" : "Next card", run: () => (last ? finalAction() : go(1)), when: !!story },
    { keys: ["Escape"], label: "Close the story", run: onClose },
  ], { modal: true, order: 20 });

  // Hold to pause; a short tap moves: the left third goes back, the rest goes forward.
  const down = () => {
    wasHeld.current = false;
    holdTimer.current = setTimeout(() => { wasHeld.current = true; setHeld(true); }, 180);
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (wasHeld.current) { setHeld(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) go(-1);
    else if (!last) go(1);
  };
  const cancel = () => { if (holdTimer.current) clearTimeout(holdTimer.current); setHeld(false); };

  const mood = MOOD[card?.mood ?? "warm"] ?? MOOD.warm;
  const node = (
    <MotionConfig reducedMotion="user">
      <motion.div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md md:gap-6"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} role="dialog" aria-modal="true" aria-label="How do we know? Your story">
        <button onClick={() => go(-1)} disabled={!idx} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20 disabled:opacity-20 max-md:!hidden" aria-label="Previous card">‹</button>

        <motion.div className="relative h-dvh w-full touch-none select-none overflow-hidden shadow-2xl md:h-[min(92dvh,860px)] md:w-[min(94vw,500px)] md:rounded-[28px]"
          initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 240, damping: 26 }}>
          <AnimatePresence initial={false}>
            <motion.div key={card?.id ?? "x"} className="absolute inset-0" style={{ background: mood.bg }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
          </AnimatePresence>
          <motion.div aria-hidden className="pointer-events-none absolute -right-1/4 -top-1/4 h-[70%] w-[90%] rounded-full opacity-40 blur-3xl"
            style={{ background: mood.blob }} animate={{ x: [0, -40, 10, 0], y: [0, 30, -10, 0], scale: [1, 1.1, 0.95, 1] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div aria-hidden className="pointer-events-none absolute -bottom-1/4 -left-1/4 h-[55%] w-[80%] rounded-full opacity-25 blur-3xl"
            style={{ background: mood.blob }} animate={{ x: [0, 30, -20, 0], y: [0, -20, 10, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }} />

          {/* Progress bars and the header. */}
          <div className="absolute inset-x-0 top-0 z-20 px-4 pt-[max(14px,env(safe-area-inset-top))]">
            <div className="flex gap-1">
              {(story?.cards ?? [null]).map((c, i) => (
                <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-white" style={{ width: (i < idx ? 100 : i === idx ? progress * 100 : 0) + "%" }} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-white">
              <BoboFace size={32} className="!shadow-none" />
              <span className="text-sm font-semibold">How do we know?</span>
              <span className="text-xs text-white/60">{story ? idx + 1 + " / " + n : ""}</span>
              <button onClick={() => setPaused((p) => !p)} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
                className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm hover:bg-white/20" aria-label={paused ? "Play" : "Pause"} title="Pause (Space)">
                {paused || held ? "▶" : "❚❚"}
              </button>
              <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg hover:bg-white/20" aria-label="Close" title="Close (Esc)">✕</button>
            </div>
          </div>

          {/* The card. */}
          <div className="absolute inset-0 z-10" onPointerDown={down} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={cancel}>
            <AnimatePresence mode="wait">
              {card ? (
                <motion.div key={card.id} className="relative flex h-full flex-col gap-4 overflow-hidden px-6 pb-[max(48px,env(safe-area-inset-bottom))] pt-24 [justify-content:safe_center] md:gap-5 md:px-9"
                  initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -24, scale: 0.97 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[7%] z-0 flex justify-end">
                    <BoboPose pose={storyPose(card, story!.context)} className="w-[46%] opacity-80" />
                  </div>
                  <div className="relative z-10 flex min-h-0 flex-col gap-4 [justify-content:safe_center] md:gap-5">
                    {card.blocks.map((b, i) => <Block key={card.id + i} b={b} i={i} ctx={story!.context} onAction={act} />)}
                  </div>
                </motion.div>
              ) : (
                <div className="grid h-full place-items-center px-8 text-center text-white/80">{err || "Opening your story…"}</div>
              )}
            </AnimatePresence>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center gap-3 text-[11px] text-white/55 max-md:!hidden">
            <span><Kbd>←</Kbd> <Kbd>→</Kbd> move</span><span><Kbd>Space</Kbd> pause</span><span><Kbd>Esc</Kbd> close</span>
          </div>
        </motion.div>

        <button onClick={() => go(1)} disabled={last} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20 disabled:opacity-20 max-md:!hidden" aria-label="Next card">›</button>
      </motion.div>
    </MotionConfig>
  );
  return createPortal(node, document.body);
}

