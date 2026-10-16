"use client";

import { BoboPose } from "@/components/mascot/Bobo";
import { type CoachState, type CoachStep, type Finding, type Milestone } from "@/lib/api";
import Link from "next/link";
import { ago, DOMAIN, type More } from "./stepMeta";

// ---------- What the plan is based on ----------

export function AboutPlan({
  st,
  cur,
  tab,
  setTab,
  allFindings,
  setAllFindings,
  innerRef,
}: {
  st: CoachState;
  cur: CoachStep | undefined;
  tab: More | null;
  setTab: (m: More) => void;
  allFindings: boolean;
  setAllFindings: (f: (v: boolean) => boolean) => void;
  innerRef: React.RefObject<HTMLElement | null>;
}) {
  const plan = st.plan;
  const findings = plan?.findings ?? [];
  const past = st.history.filter((h) => h.id !== plan?.id);
  const a = st.alphabet;
  const tabs: { id: More; label: string; count?: string }[] = [];
  if (st.milestones.length)
    tabs.push({
      id: "goals",
      label: "Goals",
      count: st.milestones.filter((m) => m.status === "achieved").length + "/" + st.milestones.length,
    });
  if (a && a.known_count < 37) tabs.push({ id: "alphabet", label: "Alphabet", count: a.known_count + "/37" });
  if (findings.length) tabs.push({ id: "evidence", label: "Evidence", count: String(findings.length) });
  if (st.notes.length) tabs.push({ id: "notes", label: "Bobo's notes", count: String(st.notes.length) });
  if (past.length) tabs.push({ id: "history", label: "Past plans", count: String(past.length) });
  if (!tabs.length) return null;
  const active = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  return (
    <section ref={innerRef} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">About this plan</h2>
        <div className="chips flex gap-1.5" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              className="chip flex items-center gap-1.5"
              data-active={active === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count && <span className="text-[11px] tabular-nums opacity-70">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="card p-4 md:p-5" role="tabpanel">
        {active === "goals" && <Milestones list={st.milestones} />}
        {active === "alphabet" && a && <Alphabet a={a} />}
        {active === "evidence" && plan && (
          <Evidence plan={plan} cur={cur} all={allFindings} toggle={() => setAllFindings((v) => !v)} />
        )}
        {active === "notes" && (
          <div className="flex flex-col gap-3">
            {st.notes.slice(0, 12).map((n) => (
              <div key={n.id} className="text-sm leading-relaxed">
                <div className="text-xs text-muted">
                  {ago(n.ts)} · {n.kind.startsWith("checkpoint:") ? "checkpoint" : "after a step"}
                </div>
                {n.text}
              </div>
            ))}
          </div>
        )}
        {active === "history" && (
          <div className="flex flex-col gap-3">
            {past.slice(0, 8).map((h) => (
              <div key={h.id} className="flex items-start gap-3 text-sm">
                <span
                  className={
                    "mt-0.5 shrink-0 rounded-md px-1.5 text-xs font-semibold tabular-nums " +
                    (h.status === "done" ? "bg-ok/15 text-ok" : "bg-line text-muted")
                  }
                >
                  {h.done}/{h.steps}
                </span>
                <span className="line-clamp-2 flex-1 text-muted" title={h.headline ?? h.diagnosis}>
                  {h.headline ?? h.diagnosis}
                </span>
                <span className="shrink-0 text-xs text-muted">{ago(h.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Milestones({ list }: { list: Milestone[] }) {
  return (
    <div>
      <p className="mb-4 text-xs text-muted">Long goals, measured on your latest answers. The line marks the goal.</p>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {list.map((m) => {
          const c = m.criterion;
          const score = c.unit === "score";
          const alpha = c.unit === "alphabet";
          const v = alpha ? (100 * m.n) / 37 : (m.value ?? 0);
          const achieved = m.status === "achieved";
          return (
            <div key={m.id} title={m.why}>
              <div className="flex items-start gap-2">
                <span className="cjk flex-1 text-sm font-semibold leading-snug">{m.title}</span>
                {achieved ? (
                  <span className="font-bold text-ok">✓</span>
                ) : (
                  <span className="text-sm font-semibold tabular-nums">
                    {alpha ? m.n + "/37" : m.value == null ? "–" : Math.round(m.value) + (score ? "" : "%")}
                  </span>
                )}
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-line">
                <div
                  className={"h-full rounded-full " + (achieved ? "bg-ok" : v >= c.min_acc ? "bg-ok/70" : "bg-accent")}
                  style={{ width: Math.min(100, v) + "%" }}
                />
                {!alpha && (
                  <div
                    className="absolute -top-1 h-4 w-0.5 rounded bg-ink"
                    style={{ left: c.min_acc + "%" }}
                    title={"Goal " + c.min_acc}
                  />
                )}
              </div>
              <div className="mt-1 text-xs text-muted">
                {achieved
                  ? "Reached " + ago(m.done_ts ?? m.ts)
                  : alpha
                    ? "symbols known"
                    : m.n < c.window
                      ? m.n + " of " + c.window + " answers so far"
                      : "on the last " + c.window + " answers"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Evidence({
  plan,
  cur,
  all,
  toggle,
}: {
  plan: NonNullable<CoachState["plan"]>;
  cur: CoachStep | undefined;
  all: boolean;
  toggle: () => void;
}) {
  // The findings behind the selected step come first.
  const list = [...plan.findings].sort(
    (x, y) =>
      Number(!!cur?.finding_ids.includes(y.id)) - Number(!!cur?.finding_ids.includes(x.id)) || y.severity - x.severity,
  );
  const shown = all ? list : list.slice(0, 4);
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-3 text-xs text-muted">
        <BoboPose pose="investigate" className="w-14" />
        What Bobo found in your stats before writing the plan. Highlighted: the findings behind the selected step.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((f) => (
          <FindingCard key={f.id} f={f} cited={!!cur?.finding_ids.includes(f.id)} />
        ))}
      </div>
      <button className="btn w-fit !py-1.5 text-sm" onClick={toggle}>
        {all ? "Show less" : "Show all " + list.length + " findings, strengths, and gaps"}
      </button>
      {all && (plan.strengths.length > 0 || plan.unknown.length > 0 || plan.too_advanced.length > 0) && (
        <div className="grid gap-4 border-t border-line pt-4 text-sm md:grid-cols-3">
          <List title="Strengths" items={plan.strengths} cls="text-ok" />
          <List title="Not known yet" items={plan.unknown} cls="text-rough" />
          <List title="Too early for now" items={plan.too_advanced} cls="text-muted" />
        </div>
      )}
    </div>
  );
}

function FindingCard({ f, cited }: { f: Finding; cited: boolean }) {
  return (
    <div className={"rounded-xl border p-3.5 " + (cited ? "border-accent/60 bg-accent-soft/40" : "border-line")}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{DOMAIN[f.domain] ?? f.domain}</span>
        <span className="ml-auto flex gap-0.5" title={"How much it matters: " + f.severity + "/5"}>
          {[1, 2, 3, 4, 5].map((k) => (
            <i key={k} className={"h-1.5 w-3 rounded-full " + (k <= f.severity ? "bg-accent" : "bg-line")} />
          ))}
        </span>
      </div>
      <div className="mt-1.5 text-sm leading-relaxed">{f.problem}</div>
      {f.items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {f.items.slice(0, 10).map((x) => (
            <span key={x} className="cjk rounded-md bg-raise px-1.5 text-xs">
              {x}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function List({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className={"mb-1.5 text-xs font-semibold uppercase tracking-wide " + cls}>{title}</div>
      <ul className="flex flex-col gap-1.5 text-muted">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** The 37 symbols: known, seen but not known yet, never practiced. The ring marks the next group the coach teaches.
 * The bar under a symbol fills with right repetitions; tests from memory start when it is full. */
function Alphabet({ a }: { a: NonNullable<CoachState["alphabet"]> }) {
  const cls = {
    known: "border-ok/60 bg-ok/15 text-ok",
    learning: "border-rough/60 bg-rough/10",
    new: "border-line text-muted",
  };
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        {a.known_count} of 37 known{a.gate ? ". The alphabet comes first in every plan" : ""}. Each symbol starts with{" "}
        {a.learn_reps} repetitions, then tests from memory. Click a symbol to practice it.
      </p>
      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(19,minmax(0,1fr))]">
        {a.symbols.map((s) => (
          <Link
            key={s.sym}
            href={"/reading?syms=" + encodeURIComponent(s.sym) + (s.phase === "repeat" ? "&learn=1" : "")}
            title={
              s.state +
              " · " +
              Math.min(s.reps, a.learn_reps) +
              "/" +
              a.learn_reps +
              " repetitions" +
              (s.answers
                ? " · from memory: said " +
                  (s.say ?? "–") +
                  (s.type ? " · typed " + s.type : "") +
                  " · written " +
                  (s.write ?? "–") +
                  (s.pick ? " · picked " + s.pick : "")
                : s.reps
                  ? ""
                  : " · never practiced")
            }
            className={
              "cjk relative grid aspect-square place-items-center overflow-hidden rounded-lg border text-lg transition hover:scale-110 " +
              cls[s.state] +
              (a.next_group.includes(s.sym) ? " ring-2 ring-accent" : "")
            }
          >
            {s.sym}
            {s.phase !== "known" && s.reps > 0 && (
              <i
                className="absolute bottom-0 left-0 h-1 bg-accent"
                style={{ width: Math.min(100, (100 * s.reps) / a.learn_reps) + "%" }}
              />
            )}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ok" />
          known
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rough" />
          seen, not known yet
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-line" />
          new
        </span>
        <span className="text-accent">ring: next to learn</span>
      </div>
    </div>
  );
}
