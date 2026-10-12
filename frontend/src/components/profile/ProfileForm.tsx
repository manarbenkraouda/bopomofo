"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, type Profile, type Sentence, type Summary, type Totals } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { useLevels } from "@/lib/levels";
import { missingFacts, setProfileCache } from "@/lib/profile";
import { playSfx } from "@/lib/sfx";
import { Kbd } from "@/components/shell/Kbd";

type Field = { key: string; label: string; hint: string; long?: boolean };
type Section = { icon: string; title: string; note: string; fields: Field[] };

const SECTIONS: Section[] = [
  { icon: "我", title: "About you", note: "Who the sentences talk about", fields: [
    { key: "name", label: "Name", hint: "e.g. Manar" },
    { key: "chinese_name", label: "Chinese name", hint: "e.g. 馬納" },
    { key: "age", label: "Age", hint: "e.g. 32" },
    { key: "nationality", label: "Nationality", hint: "e.g. French" },
  ] },
  { icon: "住", title: "Places", note: "Where you come from and live", fields: [
    { key: "hometown", label: "Hometown", hint: "e.g. Lyon" },
    { key: "lives_in", label: "Lives in", hint: "e.g. Paris" },
  ] },
  { icon: "工", title: "Work and studies", note: "What you do every day", fields: [
    { key: "job", label: "Job", hint: "e.g. software engineer" },
    { key: "company", label: "Company or school", hint: "e.g. my own tech company" },
    { key: "studies", label: "Studies", hint: "e.g. computer science" },
    { key: "languages", label: "Languages", hint: "e.g. French, English, Arabic" },
  ] },
  { icon: "家", title: "Life", note: "The people and things you talk about", fields: [
    { key: "family", label: "Family", hint: "e.g. married, one younger sister", long: true },
    { key: "hobbies", label: "Hobbies", hint: "e.g. climbing, cooking, video games", long: true },
    { key: "food", label: "Favorite food", hint: "e.g. beef noodle soup" },
    { key: "notes", label: "Other facts", hint: "Anything else you want in your sentences", long: true },
  ] },
  { icon: "學", title: "Mandarin", note: "Why you learn, and your link to Taiwan", fields: [
    { key: "level", label: "Your level", hint: "e.g. I know some common words. I know some Bopomofo symbols.", long: true },
    { key: "why_mandarin", label: "Why you learn Mandarin", hint: "e.g. I want to travel in Taiwan", long: true },
    { key: "taiwan", label: "Connection to Taiwan", hint: "e.g. I visited Taipei in 2025", long: true },
  ] },
];
const FIELDS = SECTIONS.flatMap((s) => s.fields);
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
const filled = (p: Profile, k: string) => !!(p[k] ?? "").trim();
const COMPLETE = "Profile complete! Bobo knows you now.";

// Words that say nothing about the learner, so they do not count as a match in a sentence.
const STOP = new Set("with from that this have want going last next month year years bigger smaller older younger couple about their there where which when what into also very much more some like just been them they will would could should than then only other each".split(" "));

/** The saved sentences that use facts of the profile, best first, with the words that match. */
function factsInSentences(p: Profile, sentences: Sentence[]) {
  const words: { w: string; key: string }[] = [];
  for (const f of FIELDS) {
    for (const w of (p[f.key] ?? "").toLowerCase().split(/[^a-z\u00c0-\u024f]+/)) if (w.length >= 4 && !STOP.has(w)) words.push({ w, key: f.key });
  }
  return sentences
    .map((s) => {
      const en = s.english.toLowerCase();
      const hits = words.filter((x) => new RegExp("\\b" + x.w + "\\b").test(en));
      return { s, hits, keys: [...new Set(hits.map((h) => h.key))] };
    })
    .filter((x) => x.hits.length)
    .sort((a, b) => b.keys.length - a.keys.length || b.hits.length - a.hits.length)
    .slice(0, 3);
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp("\\b(" + words.map((w) => w.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")).join("|") + ")\\b", "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">{part}</mark> : part))}</>;
}

/**
 * The profile. The sentence writer and the coach use these facts to write sentences about the learner's life.
 * A hero card with progress, a strength meter that points to the missing facts, the sentences that already use them,
 * and the facts in grouped lists. Tap a row to edit it; each fact saves by itself.
 */
export function ProfileForm() {
  const { routeOpen } = useLevels();
  const [p, setP] = useState<Profile>({});
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sel, setSel] = useState(-1);
  const [toast, setToast] = useState<{ text: string; bad?: boolean; id: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const rows = useRef<Record<string, HTMLElement | null>>({});
  const say = (text: string, bad = false) => setToast((t) => ({ text, bad, id: (t?.id ?? 0) + 1 }));

  useEffect(() => {
    api.profile().then((r) => {
      setP(r); setLoaded(true); setProfileCache(r);
      // A link from Home (/profile?fact=job) opens that fact at once.
      const k = new URLSearchParams(window.location.search).get("fact");
      const i = FIELDS.findIndex((f) => f.key === k);
      if (k && i >= 0) {
        setEditing(k); setDraft(r[k] ?? ""); setSel(i);
        setTimeout(() => rows.current[k]?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
      }
    }).catch((e) => { setLoaded(true); setToast({ text: e.message, bad: true, id: 1 }); });
    api.summary().then(setSummary).catch(() => {});
    api.stats(0).then((s) => setTotals(s.overview)).catch(() => {});
    api.sentences().then((r) => setSentences(r.sentences)).catch(() => {});
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.bad ? 4000 : toast.text === COMPLETE ? 3200 : 1600); return () => clearTimeout(t); }, [toast]);

  const open = (k: string) => {
    setEditing(k);
    setDraft(p[k] ?? "");
    setSel(FIELDS.findIndex((f) => f.key === k));
    requestAnimationFrame(() => rows.current[k]?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const close = () => setEditing(null);
  /** Save the open fact. With "then", open the next one (Tab). */
  const save = (then?: string) => {
    if (!editing) return;
    const k = editing, v = draft.trim();
    if (v !== (p[k] ?? "").trim()) {
      const next = { ...p, [k]: v };
      const wasComplete = !missingFacts(p).length;
      setP(next);
      say("Saving…");
      api.saveProfile(next).then((r) => {
        setP(r); setProfileCache(r);
        if (!wasComplete && !missingFacts(r).length) { playSfx("right"); say(COMPLETE); }
        else say(v ? "Saved" : LABEL[k] + " removed");
      }).catch((e) => say("Not saved: " + e.message, true));
    }
    if (then) open(then); else close();
  };

  const count = FIELDS.filter((f) => filled(p, f.key)).length;
  const missing = FIELDS.filter((f) => !filled(p, f.key));
  const used = useMemo(() => factsInSentences(p, sentences), [p, sentences]);

  useHotkeys("profile", [
    { keys: ["ArrowDown", "KeyJ"], label: "Next fact", run: () => setSel((i) => Math.min(FIELDS.length - 1, i + 1)), when: !editing && loaded, repeat: true, bar: false },
    { keys: ["ArrowUp", "KeyK"], label: "Previous fact", run: () => setSel((i) => Math.max(0, i - 1)), when: !editing && loaded, repeat: true, bar: false },
    { keys: [], label: "Select", show: ["↑", "↓"], when: !editing && loaded },
    { keys: ["Enter"], label: "Edit", run: () => open(FIELDS[Math.max(0, sel)].key), when: !editing && loaded },
    { keys: ["KeyN"], label: "Next missing fact", run: () => missing[0] && open(missing[0].key), when: !editing && missing.length > 0 },
  ]);
  useEffect(() => { if (sel >= 0 && !editing) rows.current[FIELDS[sel].key]?.scrollIntoView({ block: "nearest" }); }, [sel, editing]);

  function keys(e: React.KeyboardEvent, long: boolean) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Enter" && (!long || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); save(); }
    else if (e.key === "Tab" && !e.shiftKey) {
      const i = FIELDS.findIndex((f) => f.key === editing);
      if (i >= 0 && i + 1 < FIELDS.length) { e.preventDefault(); save(FIELDS[i + 1].key); }
    }
  }

  const avatar = (p.chinese_name ?? "").trim()[0] ?? ((p.name ?? "").trim()[0] ?? "我").toUpperCase();
  const facts = [p.age?.trim() && p.age.trim() + " years old", p.nationality?.trim(), p.lives_in?.trim() && "lives in " + p.lives_in.trim()].filter(Boolean).join(" · ");
  const numbers: [string, number | string | undefined, string][] = [
    ["🔥", summary?.day_streak, "day streak"],
    ["", totals?.days, "days practiced"],
    ["", totals?.minutes, "minutes"],
    ["", summary?.attempts, "answers"],
  ];

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="card relative overflow-hidden p-5 md:p-7">
        <div className="pointer-events-none absolute -bottom-12 -right-3 select-none cjk text-[180px] leading-none text-accent opacity-[.06] md:left-[38%] md:right-auto">我</div>
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
          <div className="flex min-w-0 items-center gap-4 md:gap-5">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-[#a8321f] text-4xl font-semibold text-white shadow-lg cjk md:h-24 md:w-24 md:text-5xl">
              {avatar}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent">Your profile</div>
              <h1 className="truncate text-2xl font-semibold md:text-3xl">
                {loaded ? (p.name?.trim() || <button className="text-muted hover:text-ink" onClick={() => open("name")}>Add your name</button>) : "…"}
                {p.chinese_name?.trim() && <span className="ml-2 cjk text-accent">{p.chinese_name.trim()}</span>}
              </h1>
              {facts && <div className="mt-0.5 line-clamp-2 text-sm text-muted md:truncate">{facts}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 md:ml-auto md:gap-x-8">
            {numbers.map(([icon, v, label]) => (
              <div key={label}>
                <div className="text-2xl font-semibold tabular-nums md:text-3xl">{icon && <span className="mr-1 text-xl">{icon}</span>}{v ?? "–"}</div>
                <div className="text-xs text-muted">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Phone: strength, facts, sentences. Desktop: facts on the left, strength and sentences on the right. */}
      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
          <section className="card p-5 lg:col-start-2 lg:row-start-1">
            <div className="flex items-center gap-4">
              <Ring value={count} total={FIELDS.length} />
              <div className="min-w-0">
                <div className="font-semibold">{count === FIELDS.length ? "Profile complete" : count + " of " + FIELDS.length + " facts"}</div>
                <p className="text-sm text-muted">Your sentences and Bobo’s plans use these facts. Nothing is invented about you.</p>
              </div>
            </div>
            {missing.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {missing.map((f) => (
                  <button key={f.key} className="chip flex items-center gap-1 !border-dashed text-sm hover:!border-accent hover:text-accent" onClick={() => open(f.key)}>
                    <span className="text-accent">+</span> {f.label}
                  </button>
                ))}
              </div>
            )}
          </section>

        <div className="flex flex-col gap-4 md:gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {SECTIONS.map((sec) => (
            <section key={sec.title}>
              <div className="mb-2 flex items-center gap-2.5 px-1">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft cjk text-sm text-accent">{sec.icon}</span>
                <h2 className="shrink-0 font-semibold">{sec.title}</h2>
                <span className="truncate text-sm text-muted">· {sec.note}</span>
              </div>
              <div className="card divide-y divide-line overflow-hidden">
                {sec.fields.map((f) => {
                  const v = (p[f.key] ?? "").trim();
                  const i = FIELDS.indexOf(f);
                  if (editing === f.key) {
                    return (
                      <div key={f.key} ref={(el) => { rows.current[f.key] = el; }} className="bg-accent-soft/40 px-4 py-3.5">
                        <label className="text-xs font-medium text-accent" htmlFor={"pf-" + f.key}>{f.label}</label>
                        {f.long ? (
                          <textarea id={"pf-" + f.key} autoFocus rows={3} className="input mt-1.5 w-full resize-none leading-relaxed" placeholder={f.hint} value={draft}
                            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => keys(e, true)} />
                        ) : (
                          <input id={"pf-" + f.key} autoFocus className={"input mt-1.5 w-full " + (f.key === "chinese_name" ? "cjk" : "")} placeholder={f.hint} value={draft}
                            inputMode={f.key === "age" ? "numeric" : undefined} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => keys(e, false)} />
                        )}
                        <div className="mt-2.5 flex items-center gap-2">
                          <span className="hidden text-xs text-muted sm:block">{f.long ? "Ctrl+Enter saves · Tab saves and opens the next" : "Enter saves · Tab saves and opens the next"}</span>
                          <button className="btn ml-auto !py-1.5 text-sm" onClick={close}>Cancel <Kbd className="max-md:!hidden">Esc</Kbd></button>
                          <button className="btn btn-accent !py-1.5 text-sm" onClick={() => save()}>Save</button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button key={f.key} ref={(el) => { rows.current[f.key] = el; }} onClick={() => open(f.key)}
                      className={"group flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raise " + (sel === i ? "bg-raise ring-1 ring-inset ring-accent/50" : "")}>
                      {f.long ? (
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-muted">{f.label}</div>
                          <div className={"mt-0.5 line-clamp-2 text-[15px] leading-snug " + (v ? "" : "text-accent")}>{v || "+ Add"}</div>
                        </div>
                      ) : (
                        <>
                          <span className="shrink-0 text-[15px]">{f.label}</span>
                          <span className={"ml-auto min-w-0 truncate text-right text-[15px] " + (v ? "text-muted" : "text-accent") + (f.key === "chinese_name" && v ? " cjk" : "")}>{v || "+ Add"}</span>
                        </>
                      )}
                      <span className="shrink-0 text-lg leading-none text-muted opacity-40 transition-opacity group-hover:opacity-100">›</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

          {used.length > 0 && (
            <section className="card p-5 lg:col-start-2 lg:row-start-2">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">In your sentences</h2>
                {routeOpen("/sentences") && <Link href="/sentences" className="text-sm text-accent hover:underline">All →</Link>}
              </div>
              <div className="flex flex-col gap-3">
                {used.map(({ s, hits, keys: ks }) => (
                  <div key={s.id} className="rounded-xl bg-bg/60 p-3">
                    <div className="cjk text-lg leading-snug">{s.hanzi}</div>
                    <div className="mt-0.5 text-sm text-muted"><Highlight text={s.english} words={[...new Set(hits.map((h) => h.w))]} /></div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ks.map((k) => <span key={k} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{LABEL[k]}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
      </div>

      {toast && (
        <div key={toast.id} role="status" className={"app-toast fixed left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg " + (toast.bad ? "bg-bad text-white" : "bg-ink text-bg")}>
          {!toast.bad && (toast.text === "Saved" || toast.text === COMPLETE) && "✓ "}{toast.text}
        </div>
      )}
    </div>
  );
}

function Ring({ value, total }: { value: number; total: number }) {
  const r = 26, c = 2 * Math.PI * r, f = total ? value / total : 0;
  return (
    <div className="relative grid h-16 w-16 shrink-0 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={f === 1 ? "var(--ok)" : "var(--accent)"} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - f)} style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.3,1)" }} />
      </svg>
      <span className="text-sm font-semibold tabular-nums">{Math.round(100 * f)}%</span>
    </div>
  );
}


