"use client";
// The coach step of a practice screen (?step=12): its progress, the coach's latest note, and the way to the next step.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type StepState } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { playSfx } from "@/lib/sfx";
import { Caps } from "./Kbd";
import { BoboFace, BoboPose } from "@/components/mascot/Bobo";

const FOCUS_KEYS = ["tones", "syms", "items", "ids", "rules", "nums", "bands", "chars", "learn"];

export function StepBanner() {
  const q = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const id = Number(q.get("step")) || 0;
  const [s, setS] = useState<StepState | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!id) return;
    let stop = false;
    let later: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api
        .coachStep(id)
        .then((r) => {
          if (!stop) setS(r);
        })
        .catch(() => {});
    load();
    // After an answer: the progress at once, then again a few seconds later for the checkpoint note.
    const on = () => {
      load();
      clearTimeout(later);
      later = setTimeout(load, 7000);
    };
    window.addEventListener("zs:answered", on);
    return () => {
      stop = true;
      clearTimeout(later);
      window.removeEventListener("zs:answered", on);
    };
  }, [id]);

  const step = s && s.step.id === id ? s.step : null;
  const done = !!step && step.status !== "open";
  useEffect(() => {
    if (!step) return;
    if (wasOpen.current && step.status === "done") playSfx("right");
    wasOpen.current = step.status === "open";
  }, [step]);

  // A checkpoint can change the focus of the step (fewer tones, a smaller deck). Offer to apply it.
  const target = step ? new URL(step.href, "http://x") : null;
  const changed =
    !!step &&
    step.status === "open" &&
    !!target &&
    target.pathname === path &&
    FOCUS_KEYS.some((k) => (target.searchParams.get(k) ?? "") !== (q.get(k) ?? ""));
  const next = s?.next ?? null;

  useHotkeys(
    "coach-step",
    [
      {
        keys: ["Shift+Enter"],
        label: "Next coach step",
        run: () => {
          if (next) router.push(next.href);
        },
        when: done && !!next,
      },
      {
        keys: ["Shift+KeyU"],
        label: "Apply the coach's change",
        run: () => {
          if (step) router.replace(step.href);
        },
        when: changed,
      },
    ],
    { active: !!step },
  );

  if (!id || !step || !s) return null;
  const pct = Math.min(100, (100 * step.progress) / Math.max(1, step.target));
  return (
    <div
      className={
        "sticky top-0 z-20 -mx-4 -mt-3 mb-3 border-b px-4 py-2.5 backdrop-blur md:-mx-6 md:-mt-5 md:mb-4 md:px-6 lg:-mx-10 lg:px-10 " +
        (done ? "border-ok/50 bg-ok/10" : "border-line bg-card/95")
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href="/coach"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-accent"
          title="Open Bobo's plan (G then C)"
        >
          {done ? <BoboPose pose="celebrate" className="w-6" /> : <BoboFace size={24} />} {step.pos + 1}/{s.count}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {done ? "✓ Step done: " : ""}
            {step.title}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className={"h-full rounded-full transition-all duration-500 " + (done ? "bg-ok" : "bg-accent")}
                style={{ width: pct + "%" }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums">
              {step.progress}/{step.target}
            </span>
          </div>
        </div>
        {done && next && (
          <button
            onClick={() => router.push(next.href)}
            className="btn btn-accent shrink-0 font-semibold max-md:w-full max-md:justify-center max-md:!py-3"
          >
            Next: <span className="max-w-[16rem] truncate">{next.title}</span>{" "}
            <Caps caps={["Shift", "Enter"]} className="max-md:!hidden" />
          </button>
        )}
        {done && !next && (
          <Link href="/coach" className="btn shrink-0 max-md:w-full max-md:justify-center">
            {s.generating ? "Plan done · the next plan is being built…" : "Plan done · back to Bobo"}
          </Link>
        )}
      </div>
      {step.note && !done && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <BoboFace size={18} />
          <span>
            <b className="text-accent">Bobo:</b> {step.note.text}
          </span>
        </div>
      )}
      {changed && (
        <button
          onClick={() => router.replace(step.href)}
          className="chip mt-1.5 flex items-center gap-1.5 !border-accent text-xs text-accent"
        >
          Bobo changed the focus of this step. Apply <Caps caps={["Shift", "U"]} className="max-md:!hidden" />
        </button>
      )}
    </div>
  );
}
