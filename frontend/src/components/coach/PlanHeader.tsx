"use client";

import { BoboFace, BoboPose, VMark } from "@/components/mascot/Bobo";
import { useAiQuota } from "@/components/quota/AiQuota";
import { Kbd } from "@/components/shell/Kbd";
import { type CoachState } from "@/lib/api";
import { ago, share } from "./stepMeta";

// ---------- The plan ----------

export function PlanHeader({
  st,
  sel,
  onSelect,
  onStory,
  onNewPlan,
  writing,
}: {
  st: CoachState;
  sel: number;
  onSelect: (i: number) => void;
  onStory: () => void;
  onNewPlan: () => void;
  writing: boolean;
}) {
  const { quota, blocked: aiBlocked } = useAiQuota();
  const plan = st.plan!;
  const steps = st.steps;
  const done = steps.filter((s) => s.status === "done").length;
  const left = steps.filter((s) => s.status === "open").reduce((a, s) => a + s.minutes, 0);
  const finished = steps.length > 0 && !steps.some((s) => s.status === "open");
  return (
    <section className="card relative overflow-hidden p-5 md:p-7">
      <VMark className="-bottom-16 -right-8 w-72" />
      {/* Phone: headline, progress, buttons. Desktop: the buttons on the right of the headline and the progress. */}
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <BoboFace size={32} />
            <span className="font-semibold uppercase tracking-wide text-accent">
              {plan.status === "active"
                ? "Bobo's plan for you"
                : plan.status === "done"
                  ? "Plan finished"
                  : "Previous plan"}
            </span>
            <span>built {ago(plan.ts)}</span>
            {plan.source !== "llm" && (
              <span className="text-rough" title={plan.error ?? ""}>
                built by rules: Bobo’s planner was not available
              </span>
            )}
          </div>
          <p className="mt-3 max-w-3xl text-xl font-semibold leading-snug md:text-[1.6rem] md:leading-tight">
            {plan.headline ??
              (st.generating ? (
                "Bobo is writing a short summary of this plan…"
              ) : (
                <span className="line-clamp-3 text-base font-normal text-muted">{plan.diagnosis}</span>
              ))}
          </p>
        </div>
        <div className="order-3 flex flex-wrap items-center gap-2 lg:order-none lg:row-span-2 lg:flex-col lg:items-stretch">
          <button
            onClick={onStory}
            disabled={st.generating || (!plan.has_story && (!quota || aiBlocked))}
            className="btn story-btn justify-center !rounded-xl !px-3 !py-2.5 font-semibold md:!px-4"
          >
            <span aria-hidden>✦</span>{" "}
            {writing ? "Writing the story…" : plan.has_story ? "How do we know?" : "Write the story"}{" "}
            <Kbd className="max-md:!hidden">W</Kbd>
          </button>
          <button
            onClick={onNewPlan}
            disabled={st.generating || !quota || aiBlocked}
            className="btn justify-center !rounded-xl !px-3 !py-2.5 md:!px-4"
          >
            {aiBlocked ? "AI is recharging" : "New plan"} <Kbd className="max-md:!hidden">P</Kbd>
          </button>
        </div>
        {steps.length > 0 && (
          <div className="max-w-3xl">
            <div className="flex gap-1.5" aria-label="Plan progress">
              {steps.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => onSelect(i)}
                  aria-label={"Step " + (i + 1) + ": " + s.title}
                  title={i + 1 + ". " + s.title + " · " + s.progress + "/" + s.target}
                  className={
                    "relative h-2.5 flex-1 overflow-hidden rounded-full bg-line transition " +
                    (i === sel ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : "hover:brightness-125")
                  }
                >
                  <i
                    className={
                      "absolute inset-y-0 left-0 rounded-full " +
                      (s.status === "done" ? "bg-ok" : s.status === "skipped" ? "bg-muted/40" : "bg-accent")
                    }
                    style={{ width: (s.status === "open" ? share(s) : 100) + "%" }}
                  />
                </button>
              ))}
            </div>
            <div className="mt-2 text-sm text-muted">
              {finished ? (
                <span className="flex items-center gap-3">
                  <BoboPose pose="celebrate" className="w-16" />
                  All steps are done! Bobo builds the next plan from your new answers.
                </span>
              ) : (
                done + " of " + steps.length + " steps done · about " + left + " min left"
              )}
            </div>
          </div>
        )}
      </div>

      {(plan.stale || st.building_next || st.next_ready) && (
        <div className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {plan.stale && (
            <span className="text-rough">
              {plan.new_answers} new answers since this plan. A new plan reads them all.
            </span>
          )}
          {st.building_next && <span className="text-muted">Preparing the next plan: {st.stage}…</span>}
          {st.next_ready && <span className="text-ok">The next plan is ready. It starts when this one ends.</span>}
        </div>
      )}
    </section>
  );
}
