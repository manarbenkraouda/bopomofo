"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Health, type Summary } from "@/lib/api";

const AREAS = [
  { key: "speaking", href: "/speaking", title: "Speaking", icon: "說", text: "Record yourself and get a check of each syllable's initial, final, and tone." },
  { key: "writing", href: "/writing", title: "Writing", icon: "寫", text: "Write what you hear and get corrections for each stroke." },
  { key: "listening", href: "/listening", title: "Listening", icon: "聽", text: "Tone and Bopomofo listening quizzes." },
  { key: "sentences", href: "/sentences", title: "Sentences", icon: "句", text: "Generate sentences on any topic, with Bopomofo and audio." },
  { key: "symbols", href: "/symbols", title: "Symbols", icon: "ㄅ", text: "All 37 symbols with sounds and stroke order." },
];

export function Dashboard() {
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [sum, setSum] = useState<Summary | null>(null);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth("down"));
    api.summary().then(setSum).catch(() => {});
  }, []);
  const weak = sum ? Object.entries(sum.symbols).filter(([, v]) => v.n >= 2).sort((a, b) => (b[1].err + 1) / (b[1].n + 2) - (a[1].err + 1) / (a[1].n + 2)).slice(0, 8) : [];
  return (
    <div className="flex flex-col gap-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Day streak" value={sum ? String(sum.day_streak) : "–"} />
        <Stat label="Practice attempts" value={sum ? String(sum.attempts) : "–"} />
        <Stat label="Saved sentences" value={sum ? String(sum.sentences) : "–"} />
        <div className="card p-4">
          <div className="text-xs text-muted">System</div>
          {health === "down" ? <div className="text-bad text-sm mt-1">Backend not running. Start it with start.cmd.</div> : health ? (
            <div className="text-sm mt-1 leading-relaxed">
              Speech model: <b className={health.speech_model === "ready" ? "text-ok" : "text-rough"}>{health.speech_model}</b>
              <br />Sentences: <b className={health.llm_configured ? "text-ok" : "text-bad"}>{health.llm_configured ? health.llm_model : "no API key"}</b>
            </div>
          ) : <div className="text-sm text-muted mt-1">Checking…</div>}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {AREAS.map((a) => {
          const st = sum?.areas[a.key];
          return (
            <Link key={a.key} href={a.href} className="card p-5 hover:border-ink transition flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="cjk grid place-items-center w-10 h-10 rounded-xl bg-accent-soft text-accent text-xl">{a.icon}</span>
                <span className="text-lg font-semibold">{a.title}</span>
              </div>
              <p className="text-sm text-muted">{a.text}</p>
              {st && <div className="text-xs text-muted mt-auto">{st.total} attempts · {Math.round((100 * st.ok) / Math.max(1, st.total))}% correct · {st.week} this week</div>}
            </Link>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="font-semibold mb-3">Speaking: tone accuracy</div>
          {sum && Object.keys(sum.tones).length ? [1, 2, 3, 4, 5].map((t) => {
            const v = sum.tones[String(t)];
            if (!v) return null;
            const pct = Math.round((100 * (v.n - v.err)) / v.n);
            return (
              <div key={t} className="flex items-center gap-3 text-sm mb-2">
                <span className="w-16 text-muted">{t === 5 ? "Neutral" : "Tone " + t}</span>
                <div className="flex-1 h-2 rounded bg-line overflow-hidden"><div className="h-full bg-ok" style={{ width: pct + "%" }} /></div>
                <span className="w-20 text-right">{pct}% <span className="text-muted">/{v.n}</span></span>
              </div>
            );
          }) : <div className="text-sm text-muted">Record some sentences to see your tone accuracy.</div>}
        </div>
        <div className="card p-5">
          <div className="font-semibold mb-3">Writing: symbols to practice</div>
          {weak.length ? (
            <div className="flex flex-wrap gap-2">
              {weak.map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line px-3 py-2 text-center">
                  <div className="cjk text-3xl">{k}</div>
                  <div className="text-xs text-muted">{Math.round((100 * v.err) / v.n)}% errors</div>
                </div>
              ))}
            </div>
          ) : <div className="text-sm text-muted">Practice writing to find your weak symbols.</div>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}
