"use client";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, type Health, type LevelNotice } from "@/lib/api";
import { capsOf, keyCaps, useHotkeys, useLayers, type Hotkey } from "@/lib/hotkeys";
import { setTheme, THEME_KEY, usePref } from "@/lib/prefs";
import { missingFacts, useProfile } from "@/lib/profile";
import { LAST_KEY, ROUTES, routeFor, type RouteInfo } from "@/lib/routes";
import { goalMinutes, markActive, setGoalMinutes, tick, useToday, type Today } from "@/lib/session";
import { playSfx, setSfxEnabled, SFX_KEY } from "@/lib/sfx";
import { Caps, Kbd } from "./Kbd";
import { GotoOverlay, HelpOverlay, Palette, type Command } from "./Overlays";
import { StepBanner } from "./StepBanner";
import { BoboPose, routeIcon } from "@/components/mascot/Bobo";
import Image from "next/image";
import { AiEnergyBadge, AiEnergyWait, AiQuotaProvider } from "@/components/quota/AiQuota";

type Overlay = null | "palette" | "help" | "goto";

/**
 * The sign-in and sign-up pages show only the Clerk form, and the onboarding fills the screen.
 * Every other page gets the app shell, and first checks that the onboarding is done.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path.startsWith("/onboarding")) return <div className="h-full">{children}</div>;
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-4 lg:flex-row lg:gap-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-3">
            <Image src="/icon-192.png" alt="" width={44} height={44} className="rounded-2xl shadow" priority />
            <span className="text-xl font-semibold">bopomofo</span>
          </div>
          <BoboPose pose="welcome" className="w-32 md:w-40 lg:w-72" priority />
          <p className="max-w-xs text-sm text-muted max-lg:hidden"><b className="text-ink">歡迎!</b> I&apos;m Bobo, a Formosan black bear. Sign in and I&apos;ll coach you through Bopomofo, one tone at a time.</p>
        </div>
        {children}
      </main>
    );
  }
  return <AiQuotaProvider><OnboardingGate /><AppShell>{children}</AppShell></AiQuotaProvider>;
}

/** Sends a learner who has not finished the onboarding to it, and keeps the daily goal the same on every device. */
function OnboardingGate() {
  const router = useRouter();
  useEffect(() => {
    api.me().then((m) => {
      if (!m.onboarded) router.replace("/onboarding");
      else if (m.goal_min && m.goal_min !== goalMinutes()) setGoalMinutes(m.goal_min);
    }).catch(() => {});
  }, [router]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const route = routeFor(path);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [full, setFull] = useState(false);
  const [toast, setToast] = useState("");
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [dayStreak, setDayStreak] = useState<number | null>(null);
  const sfxOn = usePref(SFX_KEY, "on") !== "off";
  const theme = usePref(THEME_KEY, "dark");
  const today = useToday();
  const layers = useLayers();
  const profile = useProfile();
  const profileGaps = profile ? missingFacts(profile).length : 0;
  const todayRef = useRef(today);
  useEffect(() => { todayRef.current = today; }, [today]);

  useEffect(() => {
    if (route.area === "practice") localStorage.setItem(LAST_KEY, route.href);
  }, [route]);

  // Backend status for the top bar: quick polls while the speech model loads, slow polls after.
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const poll = () => api.health()
      .then((h) => { if (stop) return; setHealth(h); t = setTimeout(poll, h.speech_model === "loading" ? 2000 : 30000); })
      .catch(() => { if (stop) return; setHealth("down"); t = setTimeout(poll, 5000); });
    poll();
    return () => { stop = true; clearTimeout(t); };
  }, []);

  // The day streak comes from the backend history. Refresh it after the first answer of the day.
  const practicedToday = today.cards > 0;
  useEffect(() => { api.summary().then((s) => setDayStreak(s.day_streak)).catch(() => {}); }, [practicedToday]);

  useEffect(() => {
    // After a mouse click, do not leave focus on the button: Space and Enter belong to the practice keys.
    const act = () => markActive();
    const drop = () => setTimeout(() => {
      const a = document.activeElement;
      if (a instanceof HTMLButtonElement || a instanceof HTMLAnchorElement || (a instanceof HTMLInputElement && (a.type === "checkbox" || a.type === "radio"))) a.blur();
    }, 0);
    const fs = () => setFull(!!document.fullscreenElement);
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let ticks = 0;
    const iv = setInterval(() => {
      // Every 30 s, save today's active time, so the stats keep a minutes history.
      if (++ticks % 6 === 0) { const t = todayRef.current; if (t.seconds) api.saveDay(t.date, t.seconds, goalMinutes()); }
      if (!tick(5)) return;
      setToast("✓ Daily goal reached! " + goalMinutes() + " minutes today.");
      playSfx("right");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(""), 5000);
    }, 5000);
    // Level messages come back with an answer: a new level or new symbols, or a known item that needs a review.
    const levelNotice = (e: Event) => {
      const list = (e as CustomEvent<LevelNotice[]>).detail || [];
      if (!list.length) return;
      const last = list[list.length - 1];
      setToast((last.kind === "drop" ? "↻ " : "★ ") + last.title + ". " + last.text);
      if (list.some((n) => n.kind === "unlock")) playSfx("right");
      api.levelsSeen(list.map((n) => n.id));
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(""), 7000);
    };
    window.addEventListener("zs:levels", levelNotice);
    window.addEventListener("keydown", act);
    window.addEventListener("pointerdown", act);
    window.addEventListener("pointerup", drop);
    document.addEventListener("fullscreenchange", fs);
    return () => {
      clearInterval(iv);
      clearTimeout(toastTimer);
      window.removeEventListener("zs:levels", levelNotice);
      window.removeEventListener("keydown", act);
      window.removeEventListener("pointerdown", act);
      window.removeEventListener("pointerup", drop);
      document.removeEventListener("fullscreenchange", fs);
    };
  }, []);

  const close = () => setOverlay(null);
  const go = (href: string) => { setOverlay(null); router.push(href); };
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().catch(() => {}); };
  const toggleSfx = () => setSfxEnabled(!sfxOn);
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  useHotkeys("global", [
    { keys: ["KeyG"], label: "Go to", run: () => setOverlay("goto") },
    { keys: ["Ctrl+KeyK"], label: "Commands", run: () => setOverlay("palette"), input: true },
    { keys: ["Shift+Slash"], label: "Shortcuts", run: () => setOverlay("help") },
    { keys: ["KeyM"], label: sfxOn ? "Mute sounds" : "Turn sounds on", run: toggleSfx },
    { keys: ["Alt+Enter"], label: full ? "Leave full screen" : "Full screen", run: toggleFull },
    { keys: ["Escape"], label: "Leave the text field", run: () => (document.activeElement as HTMLElement | null)?.blur?.(), input: true },
  ], { order: 0 });

  const pageKeys = layers.filter((l) => l.order === 1).flatMap((l) => l.keys);
  const commands: Command[] = [
    ...pageKeys.filter((k) => k.run && k.when !== false && k.keys.length).map((k) => ({ group: route.label, label: k.label, caps: capsOf(k), run: () => k.run!(new KeyboardEvent("keydown")) })),
    ...ROUTES.map((r) => ({ group: "Go to", label: r.label, hint: r.desc, caps: ["G", keyCaps(r.key)[0]], run: () => router.push(r.href) })),
    { group: "App", label: sfxOn ? "Mute sounds" : "Turn sounds on", caps: ["M"], run: toggleSfx },
    { group: "App", label: full ? "Leave full screen" : "Full screen", caps: ["Alt", "Enter"], run: toggleFull },
    { group: "App", label: theme === "dark" ? "Light theme" : "Dark theme", run: toggleTheme },
    { group: "App", label: "Keyboard shortcuts", caps: ["?"], run: () => setOverlay("help") },
  ];
  const status = statusOf(health);
  const lesson = route.area === "practice";

  return (
    <div className="shell">
      <Rail path={path} profileGaps={profileGaps} />
      <TopBar route={route} status={status} dayStreak={dayStreak} today={today} sfxOn={sfxOn} full={full}
        onSfx={toggleSfx} onFull={toggleFull} onHelp={() => setOverlay("help")} onPalette={() => setOverlay("palette")} />
      <MobileTop route={route} status={status} dayStreak={dayStreak} today={today} sfxOn={sfxOn} onSfx={toggleSfx} lesson={lesson} />
      <main className="min-h-0 overflow-x-hidden overflow-y-auto">
        <div className="flex min-h-full flex-col px-4 py-3 pb-[calc(var(--ab-space,0px)+0.75rem)] md:px-6 md:py-5 lg:px-10">
          {lesson && <Suspense fallback={null}><StepBanner /></Suspense>}
          {!lesson && path !== "/settings" && <AiEnergyWait />}
          {children}
        </div>
      </main>
      <ControlsBar />
      {!lesson && <BottomNav path={path} profileGaps={profileGaps} />}
      {overlay === "goto" && <GotoOverlay onGo={go} onClose={close} />}
      {overlay === "palette" && <Palette commands={commands} onClose={close} />}
      {overlay === "help" && <HelpOverlay route={route} onClose={close} />}
      {toast && <div className="fixed left-1/2 top-16 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-ok px-5 py-2 text-center font-semibold text-white shadow-lg zq-pop" role="status">{toast}</div>}
    </div>
  );
}

/** The blinking dot under a tab while the profile is not complete. */
function NudgeDot({ gaps }: { gaps: number }) {
  return <><i className="nudge-dot" aria-hidden="true" /><span className="sr-only">: {gaps} profile facts missing</span></>;
}

function Rail({ path, profileGaps }: { path: string; profileGaps: number }) {
  const item = (r: RouteInfo) => {
    const active = r.href === "/" ? path === "/" : path.startsWith(r.href);
    const nudge = r.href === "/profile" && profileGaps > 0;
    return (
      <Link key={r.href} href={r.href} data-active={active} className="rail-item"
        title={nudge ? "Complete your profile: " + profileGaps + " facts missing (G then P)" : r.label + " (G then " + keyCaps(r.key).join("") + ")"}>
        <span className="cjk text-[21px] leading-none">{routeIcon(r, 26)}</span>
        <span className="text-[10px] leading-none">{r.label}</span>
        {nudge && <NudgeDot gaps={profileGaps} />}
      </Link>
    );
  };
  return (
    <nav className="row-span-3 hidden flex-col items-center gap-1 overflow-y-auto border-r border-line bg-card py-3 md:flex">
      <Link href="/" title="Home (G then H)" className={"cjk mb-2 grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl text-white shadow transition " + (path === "/" ? "bg-accent ring-4 ring-accent-soft" : "bg-accent/85 hover:bg-accent")}>注</Link>
      {ROUTES.filter((r) => r.area === "progress").map(item)}
      <div className="my-1.5 h-px w-8 shrink-0 bg-line" />
      {ROUTES.filter((r) => r.area === "practice").map(item)}
      <div className="my-1.5 h-px w-8 shrink-0 bg-line" />
      {ROUTES.filter((r) => r.area === "study").map(item)}
      <div className="mt-auto" />
      {ROUTES.filter((r) => r.area === "me").map(item)}
    </nav>
  );
}

type Status = { cls: string; label: string; tip: string; ok: boolean };
const statusOf = (health: Health | null | "down"): Status =>
  health === null ? { cls: "bg-muted", label: "Connecting…", tip: "", ok: true }
    : health === "down" ? { cls: "bg-bad", label: "Offline", tip: "Can't connect right now. Please try again in a moment.", ok: false }
    : health.speech_model === "ready" ? { cls: "bg-ok", label: "Ready", tip: "Everything is ready.", ok: true }
    : health.speech_model === "loading" ? { cls: "bg-rough animate-pulse", label: "Getting ready…", tip: "The speech check is getting ready (a few seconds).", ok: false }
    : { cls: "bg-bad", label: "Speech check off", tip: "The speech check is not available right now. The other exercises still work.", ok: false };

function TopBar({ route, status, dayStreak, today, sfxOn, full, onSfx, onFull, onHelp, onPalette }: {
  route: RouteInfo; status: Status; dayStreak: number | null; today: Today; sfxOn: boolean; full: boolean;
  onSfx: () => void; onFull: () => void; onHelp: () => void; onPalette: () => void;
}) {
  const goal = goalMinutes();
  const minutes = Math.floor(today.seconds / 60);
  const pct = Math.min(100, (100 * today.seconds) / (goal * 60));
  const acc = today.cards ? Math.round((100 * today.ok) / today.cards) : null;
  return (
    <header className="hidden min-w-0 items-center gap-4 border-b border-line bg-card px-5 md:flex">
      <div className="flex min-w-0 items-center gap-3">
        <span className="cjk grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg text-accent">{routeIcon(route, 36)}</span>
        <div className="min-w-0">
          <div className="font-semibold leading-tight">{route.label}</div>
          <div className="truncate text-xs text-muted">{route.desc}</div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
        <AiEnergyBadge />
        <span className="hud" title={status.tip}><i className={"inline-block h-2 w-2 rounded-full " + status.cls} />{status.label}</span>
        <span className="hud hud-optional" title="Days in a row with practice">🔥 <b className="tabular-nums">{dayStreak ?? "–"}</b> <span className="text-muted">days</span></span>
        <span className="hud" title={"Active practice today. Daily goal: " + goal + " minutes (change it in Settings)."}>
          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line"><span className={"absolute inset-y-0 left-0 rounded-full transition-all " + (today.goalHit ? "bg-ok" : "bg-accent")} style={{ width: pct + "%" }} /></span>
          <b className="tabular-nums">{minutes}</b><span className="text-muted">/{goal} min</span>{today.goalHit && <span className="text-ok">✓</span>}
        </span>
        <span className="hud hud-optional" title="Answers today, and how many were right">
          <b className="tabular-nums">{today.cards}</b> <span className="text-muted">{today.cards === 1 ? "card" : "cards"}</span>{acc !== null && <><span className="text-muted">·</span><b className="tabular-nums">{acc}%</b></>}
        </span>
        <span key={today.combo} className={"hud " + (today.combo >= 2 ? "zq-pop border-accent/60 text-accent" : "")} title={"Right answers in a row, on all screens. Best today: " + today.best}>
          ⚡ <b className="tabular-nums">×{today.combo}</b>
        </span>
        <div className="ml-1 flex items-center gap-1">
          <button className="icon-btn" onClick={onPalette} title="Commands (Ctrl+K)">⌘</button>
          <button className="icon-btn" onClick={onSfx} title="Sounds (M)">{sfxOn ? "🔊" : "🔇"}</button>
          <button className="icon-btn" onClick={onFull} title="Full screen (Alt+Enter)">{full ? "🗗" : "⛶"}</button>
          <button className="icon-btn font-semibold" onClick={onHelp} title="Shortcuts (?)">?</button>
          <span className="ml-1 grid h-9 w-9 place-items-center"><UserButton /></span>
        </div>
      </div>
    </header>
  );
}

/** The bottom bar: the keys you can press now. */
function ControlsBar() {
  const layers = useLayers();
  const modal = layers.find((l) => l.modal);
  const keys: Hotkey[] = modal ? modal.keys : layers.filter((l) => l.order === 1).flatMap((l) => l.keys);
  const shown = keys.filter((k) => k.when !== false && k.bar !== false && capsOf(k).length);
  return (
    <footer className="hidden min-w-0 items-center gap-4 border-t border-line bg-card px-4 text-xs text-muted md:flex">
      <div className="flex min-w-0 flex-1 items-center gap-x-4 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_92%,transparent)]">
        {shown.map((k, i) => <span key={i} className="flex items-center gap-1.5"><Caps caps={capsOf(k)} /><span>{k.label}</span></span>)}
      </div>
      {!modal && (
        <div className="hidden shrink-0 items-center gap-4 whitespace-nowrap md:flex">
          <span className="flex items-center gap-1.5"><Kbd>G</Kbd>Go to</span>
          <span className="flex items-center gap-1.5"><Caps caps={["Ctrl", "K"]} />Commands</span>
          <span className="flex items-center gap-1.5"><Kbd>?</Kbd>Shortcuts</span>
        </div>
      )}
    </footer>
  );
}

/**
 * Phone top bar. In a practice mode it works like a lesson screen: ✕ back to Home, the daily-goal progress bar, and the combo.
 * On the other screens: the title, the day streak, and the combo.
 */
function MobileTop({ route, status, dayStreak, today, sfxOn, onSfx, lesson }: {
  route: RouteInfo; status: Status; dayStreak: number | null; today: Today; sfxOn: boolean; onSfx: () => void; lesson: boolean;
}) {
  const goal = goalMinutes();
  const minutes = Math.floor(today.seconds / 60);
  const pct = Math.min(100, (100 * today.seconds) / (goal * 60));
  const combo = <span key={today.combo} className={"flex items-center gap-0.5 text-sm font-bold tabular-nums " + (today.combo >= 2 ? "text-accent zq-pop" : "text-muted")} title="Right answers in a row">⚡{today.combo}</span>;
  return (
    <header className="border-b border-line bg-card pt-[env(safe-area-inset-top)] md:hidden">
      {lesson ? (
        <div className="flex h-14 items-center gap-3 px-3">
          <Link href="/" aria-label="Back to Home" className="icon-btn !h-10 !w-10 text-xl">✕</Link>
          <span className="cjk text-lg text-accent" aria-label={route.label}>{routeIcon(route, 28)}</span>
          <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line" title={"Daily goal: " + minutes + " of " + goal + " minutes"}>
            <div className={"absolute inset-y-0 left-0 rounded-full transition-all duration-500 " + (today.goalHit ? "bg-ok" : "bg-accent")} style={{ width: Math.max(4, pct) + "%" }} />
            <div className="absolute inset-x-2 top-[3px] h-1 rounded-full bg-white/25" style={{ width: "calc(" + Math.max(4, pct) + "% - 1rem)" }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-muted">{minutes}/{goal}m</span>
          {combo}
          <button className="icon-btn !h-9 !w-9" onClick={onSfx} aria-label={sfxOn ? "Mute sounds" : "Turn sounds on"}>{sfxOn ? "🔊" : "🔇"}</button>
        </div>
      ) : (
        <div className="flex h-14 items-center gap-2.5 px-4">
          <span className={"cjk grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg " + (route.area === "home" ? "bg-accent text-white" : "bg-accent-soft text-accent")}>{route.area === "home" ? "注" : routeIcon(route, 36)}</span>
          <div className="min-w-0 flex-1 truncate font-semibold">{route.area === "home" ? "bopomofo" : route.label}</div>
          <span className="hud !h-8 !px-2.5" title="Days in a row with practice">🔥<b className="tabular-nums">{dayStreak ?? "–"}</b></span>
          <span className="hud !h-8 !px-2.5">{combo}</span>
          <button className="icon-btn !h-9 !w-9" onClick={onSfx} aria-label={sfxOn ? "Mute sounds" : "Turn sounds on"}>{sfxOn ? "🔊" : "🔇"}</button>
          <span className="grid h-9 w-9 place-items-center"><UserButton /></span>
        </div>
      )}
      <div className="flex justify-end border-t border-line px-4 py-1.5"><AiEnergyBadge /></div>
      {!status.ok && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-xs">
          <i className={"inline-block h-2 w-2 rounded-full " + status.cls} />
          <b>{status.label}</b><span className="truncate text-muted">{status.tip}</span>
        </div>
      )}
    </header>
  );
}

const TABS = ["/", "/coach", "/stats", "/symbols", "/sentences", "/settings"];

/** Phone bottom tab bar (hidden inside practice modes, where ✕ leads back to Home). The profile is inside Settings on a phone. */
function BottomNav({ path, profileGaps }: { path: string; profileGaps: number }) {
  return (
    <nav className="grid grid-cols-6 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      {TABS.map((href) => {
        const r = routeFor(href);
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} data-active={active} className="tab">
            <span className="tab-icon cjk">{routeIcon(r, 24)}</span>
            {r.label}
            {href === "/settings" && profileGaps > 0 && <NudgeDot gaps={profileGaps} />}
          </Link>
        );
      })}
    </nav>
  );
}
