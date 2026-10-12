"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AI_QUOTA_EVENT, api, type AiQuota } from "@/lib/api";
import { useLevels } from "@/lib/levels";
import { quotaCountdown, quotaSeconds } from "@/lib/quota-clock";
import { playSfx } from "@/lib/sfx";
import { BoboPose } from "@/components/mascot/Bobo";

type Snapshot = { quota: AiQuota; receivedAt: number };
type QuotaState = { quota: AiQuota | null; blocked: boolean; refilled: boolean; refresh: () => void };
const Context = createContext<QuotaState>({ quota: null, blocked: false, refilled: false, refresh: () => {} });
const ClockContext = createContext(0);
export const useAiQuota = () => useContext(Context);

/** One poll for all screens. A 429 or a completed AI job updates it at once. No usage persists across accounts. */
export function AiQuotaProvider({ children }: { children: React.ReactNode }) {
  const { userId, isSignedIn } = useAuth();
  return <AiQuotaSession key={userId ?? "signed-out"} userId={userId} isSignedIn={!!isSignedIn}>{children}</AiQuotaSession>;
}

/** The session is reset on account changes. A separate clock context keeps lesson screens from rendering each second. */
export function AiQuotaSession({ children, userId, isSignedIn, loadQuota = api.aiQuota }: {
  children: React.ReactNode; userId: string | null | undefined; isSignedIn: boolean; loadQuota?: () => Promise<AiQuota>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [clock, setClock] = useState(0);
  const [refilled, setRefilled] = useState(false);
  const previous = useRef<AiQuota | null>(null);
  const inFlight = useRef(false);

  const accept = useCallback((q: AiQuota) => {
    if (q.user_id !== userId) return;
    const was = previous.current;
    if (was && was.server_now > q.server_now) return; // a slow response must not restore an older energy reading
    if (was?.user_id === userId && was.blocked && !q.blocked && q.period_started_at > was.period_started_at) {
      setRefilled(true);
      playSfx("right");
    }
    previous.current = q;
    setSnapshot({ quota: q, receivedAt: performance.now() });
  }, [userId]);

  const refresh = useCallback(() => {
    if (!isSignedIn || inFlight.current) return;
    inFlight.current = true;
    loadQuota().then(accept).catch(() => {}).finally(() => { inFlight.current = false; });
  }, [accept, isSignedIn, loadQuota]);

  useEffect(() => {
    refresh();
    const update = (event: Event) => accept((event as CustomEvent<AiQuota>).detail);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const poll = setInterval(visible, 30000);
    window.addEventListener(AI_QUOTA_EVENT, update);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(poll);
      window.removeEventListener(AI_QUOTA_EVENT, update);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [accept, refresh]);

  const quota = snapshot && snapshot.quota.user_id === userId ? snapshot.quota : null;
  const secondsLeft = quota && snapshot ? quotaSeconds(quota, Math.max(0, clock - snapshot.receivedAt)) : 0;
  useEffect(() => {
    if (!quota || !snapshot) return;
    const timer = setInterval(() => setClock(performance.now()), 1000);
    // At zero, ask the server. Only its answer can unlock the buttons, including after sleep or a failed request.
    const refill = setTimeout(refresh, Math.max(0, quotaSeconds(quota) * 1000));
    return () => { clearInterval(timer); clearTimeout(refill); };
  }, [quota, snapshot, refresh]);
  useEffect(() => {
    if (!refilled) return;
    const timer = setTimeout(() => setRefilled(false), 8000);
    return () => clearTimeout(timer);
  }, [refilled]);

  const state = useMemo(() => ({ quota, blocked: !!quota?.blocked, refilled, refresh }), [quota, refilled, refresh]);
  return <Context.Provider value={state}><ClockContext.Provider value={secondsLeft}>{children}</ClockContext.Provider></Context.Provider>;
}

function EnergyIcon({ sleeping = false }: { sleeping?: boolean }) {
  return (
    <span aria-hidden className={"relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-b-4 text-3xl " +
      (sleeping ? "border-rough/30 bg-rough/15 text-rough" : "border-ok/30 bg-ok/15 text-ok")}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" fill="currentColor"><path d="M18 2 6 18h9l-1 12 12-17h-9z" /></svg>
      {sleeping && <span className="absolute -right-2 -top-2 rounded-full bg-card px-1.5 text-xs font-bold">zZ</span>}
    </span>
  );
}

/** The full refill card: no penalty, and no rewards or practice scores for waiting. */
export function AiEnergyCard({ compact = false }: { compact?: boolean }) {
  const { quota, blocked, refilled } = useAiQuota();
  const { routeOpen } = useLevels();
  const secondsLeft = useContext(ClockContext);
  if (!quota) return null;
  const time = quotaCountdown(secondsLeft);
  return (
    <section aria-label="AI energy" className={"card ai-energy-card flex flex-col gap-4 p-4 md:p-5 " +
      (blocked ? "border-rough/40" : refilled ? "zq-pop border-ok/60" : "") }>
      <div className="flex items-center gap-4">
        {blocked ? <BoboPose pose="sleeping" className="w-20 md:w-24" /> : <EnergyIcon />}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Daily AI energy</div>
          <h2 className="text-lg font-bold leading-tight">{blocked ? "Bobo is recharging" : refilled ? "Your AI energy is back!" : "Ready for your next idea"}</h2>
          <p className="mt-1 text-sm text-muted">{blocked ? "Sentences, translation, and AI plans unlock at midnight." : "New sentences, translations, and plans share this energy."}</p>
        </div>
        {!blocked && <b className="shrink-0 text-xl tabular-nums text-ok">{quota.remaining_percent}%</b>}
      </div>
      <div role="progressbar" aria-label="AI energy left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={quota.remaining_percent}
        className="flex h-3.5 gap-1" data-testid="ai-energy-meter">
        {Array.from({ length: 10 }, (_, i) => <span key={i} className={"flex-1 rounded-sm border-b-2 transition-colors " +
          (i < Math.ceil(quota.remaining_percent / 10) ? "border-ok/40 bg-ok" : "border-line bg-raise")} />)}
      </div>
      <div className={"flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raise px-3 py-2.5 " + (blocked ? "border border-rough/20" : "")}>
        <span className="text-xs text-muted">{blocked ? "Full refill in" : "Next daily refill"}<span className="block text-[11px]">Midnight · {quota.timezone.replaceAll("_", " ")}</span></span>
        <span role="timer" aria-label="Time until AI energy refills" className={"font-mono text-2xl font-bold tabular-nums " + (blocked ? "text-rough" : "text-ink")}>
          {secondsLeft > 0 ? time : "Checking…"}
        </span>
      </div>
      {blocked && !compact && (
        <div>
          <p className="mb-3 text-sm text-muted">Keep your streak going. Saved lessons and practice still work while your AI rests.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/listening" className="btn btn-accent flex-1 justify-center font-semibold">Practice tones</Link>
            {routeOpen("/sentences") && <Link href="/sentences" className="btn flex-1 justify-center font-semibold">Saved sentences</Link>}
          </div>
        </div>
      )}
    </section>
  );
}

/** A small meter on every screen. Click to see the full timer in Settings. */
export function AiEnergyBadge() {
  const { quota, blocked } = useAiQuota();
  const secondsLeft = useContext(ClockContext);
  if (!quota) return null;
  return (
    <Link href="/settings#ai-energy" className={"hud !px-2.5 text-xs font-semibold " + (blocked ? "border-rough/40 text-rough" : "text-ok")}
      aria-label={blocked ? "AI energy empty. Refill in " + quotaCountdown(secondsLeft) : "AI energy: " + quota.remaining_percent + "% left"}>
      <span aria-hidden>✦</span> AI {blocked ? <span className="tabular-nums">{secondsLeft > 0 ? quotaCountdown(secondsLeft) : "Checking…"}</span> : quota.remaining_percent + "%"}
    </Link>
  );
}

export function AiEnergyWait() {
  const { blocked, refilled } = useAiQuota();
  if (refilled) return <div role="status" className="mb-4 rounded-xl border border-ok/40 bg-ok/10 p-3 font-semibold text-ok zq-pop">✦ AI energy refilled! Your next idea is ready to go.</div>;
  return blocked ? <div className="mb-5"><AiEnergyCard /></div> : null;
}
