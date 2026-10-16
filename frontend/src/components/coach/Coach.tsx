"use client";

import { BoboFace, BoboPackshot, BoboPose, VMark } from "@/components/mascot/Bobo";
import { useAiQuota } from "@/components/quota/AiQuota";
import { ActionBar } from "@/components/shell/ActionBar";
import { Kbd } from "@/components/shell/Kbd";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import { api, type CoachState, type CoachStep } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { missingFacts, useProfile } from "@/lib/profile";
import { useViewport } from "@/lib/useFit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AboutPlan } from "./AboutPlan";
import { PlanHeader } from "./PlanHeader";
import { SKIP, STEP_ICON, type More } from "./stepMeta";
import { StepDetail, StepRow } from "./Steps";

/**
 * The coach page. The plan comes first: its headline, a track of the steps, and the selected step in detail.
 * What the plan is based on (goals, alphabet, findings, notes, past plans) is one tabbed section below it.
 */
export function Coach() {
  const { quota, blocked: aiBlocked } = useAiQuota();
  const profile = useProfile();
  const profileGaps = profile ? missingFacts(profile).length : 0;
  const router = useRouter();
  const [st, setSt] = useState<CoachState | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(0);
  const [more, setMore] = useState<More | null>(null);
  const [allFindings, setAllFindings] = useState(false);
  const [now, setNow] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const moreRef = useRef<HTMLElement>(null);
  const { w } = useViewport();
  const wide = w >= 1024;
  const load = useCallback(
    () =>
      api
        .coach()
        .then((s) => {
          setSt(s);
          setErr("");
        })
        .catch((e: Error) => setErr(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  // Quick polls while the coach builds a plan, slow polls after (checkpoint notes arrive in the background).
  useEffect(() => {
    const t = setTimeout(load, st?.generating ? 2500 : 20000);
    return () => clearTimeout(t);
  }, [st, load]);
  useEffect(() => {
    if (!st?.generating) return;
    const tick = () => setNow(Date.now() / 1000);
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [st?.generating]);

  const steps = st?.steps ?? [];
  const firstOpen = steps.findIndex((s) => s.status === "open");
  const planId = st?.plan?.id;
  // A new plan selects its first open step.
  useEffect(() => {
    setSel(Math.max(0, firstOpen));
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = steps[sel];
  const open = cur?.status === "open";
  const start = (s?: CoachStep) => {
    if (s && s.status === "open") router.push(s.href);
  };
  const skip = (reason: keyof typeof SKIP) => {
    if (cur && open)
      api
        .skipStep(cur.id, reason)
        .then(setSt)
        .catch((e: Error) => setErr(e.message));
  };
  const newPlan = () => {
    if (quota && !aiBlocked)
      api
        .coachPlan("The learner asked for a new plan now.")
        .then(setSt)
        .catch((e: Error) => setErr(e.message));
  };
  const hasStory = !!st?.plan?.has_story;
  // "How do we know?": open the story, or write it first for a plan that has none.
  const story = () => {
    if (!st?.plan || st.generating) return;
    if (hasStory) setStoryOpen(true);
    else if (quota && !aiBlocked)
      api
        .writeStory(st.plan.id)
        .then(setSt)
        .catch((e: Error) => setErr(e.message));
  };
  const showMore = (m: More) => {
    setMore(m);
    requestAnimationFrame(() => moreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  useHotkeys(
    "coach",
    [
      {
        keys: ["Enter"],
        label: "Start the step",
        run: () => start(open ? cur : steps[firstOpen]),
        when: firstOpen >= 0,
      },
      ...steps.map((s, i) => ({
        keys: ["Digit" + (i + 1), "Numpad" + (i + 1)],
        label: "Start: " + s.title,
        run: () => start(s),
        when: s.status === "open",
        bar: false,
      })),
      { keys: [], label: "Start step 1-" + steps.length, show: ["1–" + steps.length], when: steps.length > 1 },
      {
        keys: ["ArrowDown", "KeyJ"],
        label: "Next step",
        run: () => setSel((i) => Math.min(steps.length - 1, i + 1)),
        when: steps.length > 1,
        bar: false,
        repeat: true,
      },
      {
        keys: ["ArrowUp", "KeyK"],
        label: "Previous step",
        run: () => setSel((i) => Math.max(0, i - 1)),
        when: steps.length > 1,
        bar: false,
        repeat: true,
      },
      { keys: [], label: "Select", show: ["↑", "↓"], when: steps.length > 1 },
      { keys: ["KeyH"], label: "Too hard", run: () => skip("too_hard"), when: open },
      { keys: ["KeyE"], label: "Too easy", run: () => skip("too_easy"), when: open },
      { keys: ["KeyN"], label: "Not now", run: () => skip("not_now"), when: open },
      {
        keys: ["KeyF"],
        label: "Show the evidence",
        run: () => showMore("evidence"),
        when: !!st?.plan?.findings.length,
        bar: false,
      },
      { keys: ["KeyP"], label: "New plan", run: newPlan, when: !!st && !st.generating && !!quota && !aiBlocked },
      {
        keys: ["KeyW"],
        label: hasStory ? "How do we know?" : "Write the story",
        run: story,
        when: !!st?.plan && !st.generating && (hasStory || (!!quota && !aiBlocked)),
      },
    ],
    { active: !storyOpen },
  );

  if (!st)
    return (
      <div className="grid flex-1 place-items-center text-muted">
        {err || (
          <span className="flex flex-col items-center gap-3">
            <BoboFace size={64} pulse />
            Bobo is on the way…
          </span>
        )}
      </div>
    );
  const plan = st.plan;
  const elapsed = st.generating && now ? Math.max(0, Math.round(now - st.started)) : 0;
  const lead = open ? cur : firstOpen >= 0 ? steps[firstOpen] : null;
  const writing = !!st.writing_story && st.writing_story === plan?.id;
  const detail = cur && (
    <StepDetail
      s={cur}
      i={sel}
      alphabet={st.alphabet}
      findings={plan?.findings ?? []}
      onStart={() => start(cur)}
      onSkip={skip}
      onEvidence={() => showMore("evidence")}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-5 md:gap-6">
      {err && (
        <div className="card flex items-center gap-3 border-bad/60 p-3 text-sm text-bad">
          <BoboPose pose="encourage" className="w-12" />
          {err}
        </div>
      )}
      {storyOpen && plan && hasStory && (
        <StoryPlayer
          planId={plan.id}
          onClose={() => setStoryOpen(false)}
          onStart={() => {
            setStoryOpen(false);
            start(lead ?? undefined);
          }}
        />
      )}

      {st.generating && !st.building_next && !writing && (
        <section className="card flex items-center gap-4 p-5">
          <BoboPose pose="thinking" className="w-16" bob />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Bobo is building your next plan…</div>
            <div className="text-sm text-muted">
              {st.stage || "Starting"} · {elapsed}s · about a minute
            </div>
          </div>
        </section>
      )}

      {plan && <PlanHeader st={st} sel={sel} onSelect={setSel} onStory={story} onNewPlan={newPlan} writing={writing} />}

      {steps.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-6">
          <section aria-label="Steps" className="flex min-w-0 flex-col gap-2">
            {steps.map((s, i) => (
              <div key={s.id} id={"step-" + s.id} className="flex scroll-mt-2 flex-col gap-2">
                <StepRow
                  s={s}
                  i={i}
                  active={i === sel}
                  onSelect={() => {
                    setSel(i);
                    // Narrow screens: the step above closes, so bring the opened step to the top.
                    if (!wide)
                      requestAnimationFrame(() =>
                        document.getElementById("step-" + s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
                      );
                  }}
                />
                {!wide && i === sel && <div className="card p-4 md:p-5">{detail}</div>}
              </div>
            ))}
          </section>
          {wide && cur && <aside className="card sticky top-0 p-6">{detail}</aside>}
        </div>
      )}
      {!steps.length && !st.generating && (
        <div className="card relative flex flex-col items-center gap-5 overflow-hidden p-6 sm:flex-row sm:items-center md:p-8">
          <VMark className="-bottom-24 -right-10 w-72" />
          <BoboPackshot className="w-40 shrink-0 md:w-52" priority />
          <div className="relative flex flex-col items-start gap-3">
            <div className="text-xl font-semibold">
              Hi, I&apos;m Bobo! <span className="cjk text-accent">波波</span>
            </div>
            <p className="text-sm text-muted">
              I&apos;m a Formosan black bear, and your coach. I read your answers and build a short plan of steps for
              you.
            </p>
            {profileGaps > 0 && (
              <p className="text-sm text-muted">
                Your first plan waits for your profile, so its sentences talk about your life.{" "}
                <Link href="/profile" className="text-accent hover:underline">
                  Complete your profile ({profileGaps} facts missing)
                </Link>
              </p>
            )}
            <button className="btn btn-accent" onClick={newPlan} disabled={!quota || aiBlocked}>
              {aiBlocked ? "AI is recharging" : "Build my plan"} <Kbd className="max-md:!hidden">P</Kbd>
            </button>
          </div>
        </div>
      )}

      <AboutPlan
        st={st}
        cur={cur}
        tab={more}
        setTab={setMore}
        allFindings={allFindings}
        setAllFindings={setAllFindings}
        innerRef={moreRef}
      />

      <ActionBar mobileOnly>
        {open ? (
          <>
            <button className="btn" onClick={() => skip("too_hard")}>
              Too hard
            </button>
            <button className="btn" onClick={() => skip("too_easy")}>
              Too easy
            </button>
            <button className="btn btn-accent ab-primary" onClick={() => start(cur)}>
              <span className="cjk">{STEP_ICON[cur.type]}</span> Start step {sel + 1}
            </button>
          </>
        ) : lead ? (
          <button className="btn btn-accent ab-primary" onClick={() => start(lead)}>
            Start: {lead.title}
          </button>
        ) : (
          <button className="btn ab-primary" onClick={newPlan} disabled={st.generating || !quota || aiBlocked}>
            {aiBlocked ? "AI is recharging" : st.generating ? "Building your next plan…" : "New plan"}
          </button>
        )}
      </ActionBar>
    </div>
  );
}
