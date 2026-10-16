"use client";

import { LockedScreen, UnlockOverlay } from "@/components/levels/LevelUi";
import { GUIDES } from "@/components/landing/brand";
import { BoboPose } from "@/components/mascot/Bobo";
import { AiEnergyWait, AiQuotaProvider } from "@/components/quota/AiQuota";
import { api, type Health, type LevelNotice } from "@/lib/api";
import { capsOf, keyCaps, useHotkeys, useLayers } from "@/lib/hotkeys";
import { LevelsProvider, useLevels } from "@/lib/levels";
import { setTheme, THEME_KEY, usePref } from "@/lib/prefs";
import { missingFacts, useProfile } from "@/lib/profile";
import { LAST_KEY, routeFor, ROUTES } from "@/lib/routes";
import { goalMinutes, markActive, setGoalMinutes, tick, useToday } from "@/lib/session";
import { playSfx, setSfxEnabled, SFX_KEY } from "@/lib/sfx";
import Image from "next/image";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ControlsBar } from "./ControlsBar";
import { BottomNav, Rail } from "./Navigation";
import { GotoOverlay, HelpOverlay, Palette, type Command } from "./Overlays";
import { MobileTop, statusOf, TopBar } from "./StatusBars";
import { StepBanner } from "./StepBanner";

type Overlay = null | "palette" | "help" | "goto";

/**
 * The landing page is public and draws its own page. It shows at "/" through a rewrite, so it is found by its route
 * segment: usePathname() reads "/welcome" in the prerendered HTML and "/" in the browser, and the two would not hydrate. The sign-in and sign-up pages show only the Clerk form, and the
 * onboarding and the placement test fill the screen. Every other page gets the app shell, and first checks that the
 * onboarding (and a due placement test) is done.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const segment = useSelectedLayoutSegment();
  // The landing page and the public guides draw their own page, without the app shell.
  if (segment === "welcome" || GUIDES.some((g) => g.href === path)) return children;
  if (path.startsWith("/onboarding") || path.startsWith("/placement")) return <div className="h-full">{children}</div>;
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-4 lg:flex-row lg:gap-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-3">
            <Image src="/icon-192.png" alt="" width={44} height={44} className="rounded-2xl shadow" priority />
            <span className="text-xl font-semibold">bopomofo</span>
          </div>
          <BoboPose pose="welcome" className="w-32 md:w-40 lg:w-72" priority />
          <p className="max-w-xs text-sm text-muted max-lg:hidden">
            <b className="text-ink">歡迎!</b> I&apos;m Bobo, a Formosan black bear. Sign in and I&apos;ll coach you
            through Bopomofo, one tone at a time.
          </p>
        </div>
        {children}
      </main>
    );
  }
  return (
    <AiQuotaProvider>
      <LevelsProvider>
        <OnboardingGate />
        <AppShell>{children}</AppShell>
      </LevelsProvider>
    </AiQuotaProvider>
  );
}

/** Sends a learner who has not finished the onboarding (or a due placement test) to it, and keeps the daily goal the same on every device. */
function OnboardingGate() {
  const router = useRouter();
  useEffect(() => {
    api
      .me()
      .then((m) => {
        if (!m.onboarded) router.replace("/onboarding");
        else if (m.placement === "due") router.replace("/placement");
        else if (m.goal_min && m.goal_min !== goalMinutes()) setGoalMinutes(m.goal_min);
      })
      .catch(() => {});
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
  const [unlock, setUnlock] = useState<LevelNotice | null>(null);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [dayStreak, setDayStreak] = useState<number | null>(null);
  const sfxOn = usePref(SFX_KEY, "on") !== "off";
  const theme = usePref(THEME_KEY, "dark");
  const today = useToday();
  const layers = useLayers();
  const profile = useProfile();
  const profileGaps = profile ? missingFacts(profile).length : 0;
  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);
  const { lv, routeOpen, refresh } = useLevels();
  const routes = ROUTES.filter((r) => routeOpen(r.href));
  const locked = !!lv && !routeOpen(route.href);
  const shownNotices = useRef(new Set<number>());

  useEffect(() => {
    if (route.area === "practice" && !locked) localStorage.setItem(LAST_KEY, route.href);
  }, [route, locked]);

  // Backend status for the top bar: quick polls while the speech model loads, slow polls after.
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const poll = () =>
      api
        .health()
        .then((h) => {
          if (stop) return;
          setHealth(h);
          t = setTimeout(poll, h.speech_model === "loading" ? 2000 : 30000);
        })
        .catch(() => {
          if (stop) return;
          setHealth("down");
          t = setTimeout(poll, 5000);
        });
    poll();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, []);

  // The day streak comes from the backend history. Refresh it after the first answer of the day.
  const practicedToday = today.cards > 0;
  useEffect(() => {
    api
      .summary()
      .then((s) => setDayStreak(s.day_streak))
      .catch(() => {});
  }, [practicedToday]);

  useEffect(() => {
    // After a mouse click, do not leave focus on the button: Space and Enter belong to the practice keys.
    const act = () => markActive();
    const drop = () =>
      setTimeout(() => {
        const a = document.activeElement;
        if (
          a instanceof HTMLButtonElement ||
          a instanceof HTMLAnchorElement ||
          (a instanceof HTMLInputElement && (a.type === "checkbox" || a.type === "radio"))
        )
          a.blur();
      }, 0);
    const fs = () => setFull(!!document.fullscreenElement);
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let ticks = 0;
    const iv = setInterval(() => {
      // Every 30 s, save today's active time, so the stats keep a minutes history.
      if (++ticks % 6 === 0) {
        const t = todayRef.current;
        if (t.seconds) api.saveDay(t.date, t.seconds, goalMinutes());
      }
      if (!tick(5)) return;
      setToast("✓ Daily goal reached! " + goalMinutes() + " minutes today.");
      playSfx("right");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(""), 5000);
    }, 5000);
    // Level messages come back with an answer: a new level or new symbols, or a known item that needs a review.
    // An unlock gets Bobo's celebration; a review or a comeback gets a short toast. Each message shows once.
    const levelNotice = (e: Event) => {
      const list = ((e as CustomEvent<LevelNotice[]>).detail || []).filter((n) => !shownNotices.current.has(n.id));
      if (!list.length) return;
      for (const n of list) shownNotices.current.add(n.id);
      refresh();
      const unlocks = list.filter((n) => n.kind === "unlock");
      if (unlocks.length) {
        setUnlock(unlocks[unlocks.length - 1]);
        playSfx("right");
      }
      const other = list.filter((n) => n.kind !== "unlock");
      if (other.length) {
        const last = other[other.length - 1];
        setToast((last.kind === "drop" ? "↻ " : "★ ") + last.title + ". " + last.text);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => setToast(""), 7000);
      }
      api.levelsSeen(list.map((n) => n.id));
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
  }, [refresh]);

  const close = () => setOverlay(null);
  const go = (href: string) => {
    setOverlay(null);
    router.push(href);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  const toggleSfx = () => setSfxEnabled(!sfxOn);
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  useHotkeys(
    "global",
    [
      { keys: ["KeyG"], label: "Go to", run: () => setOverlay("goto") },
      { keys: ["Ctrl+KeyK"], label: "Commands", run: () => setOverlay("palette"), input: true },
      { keys: ["Shift+Slash"], label: "Shortcuts", run: () => setOverlay("help") },
      { keys: ["KeyM"], label: sfxOn ? "Mute sounds" : "Turn sounds on", run: toggleSfx },
      { keys: ["Alt+Enter"], label: full ? "Leave full screen" : "Full screen", run: toggleFull },
      {
        keys: ["Escape"],
        label: "Leave the text field",
        run: () => (document.activeElement as HTMLElement | null)?.blur?.(),
        input: true,
      },
    ],
    { order: 0 },
  );

  const pageKeys = layers.filter((l) => l.order === 1).flatMap((l) => l.keys);
  const commands: Command[] = [
    ...pageKeys
      .filter((k) => k.run && k.when !== false && k.keys.length)
      .map((k) => ({
        group: route.label,
        label: k.label,
        caps: capsOf(k),
        run: () => k.run!(new KeyboardEvent("keydown")),
      })),
    ...routes.map((r) => ({
      group: "Go to",
      label: r.label,
      hint: r.desc,
      caps: ["G", keyCaps(r.key)[0]],
      run: () => router.push(r.href),
    })),
    { group: "App", label: sfxOn ? "Mute sounds" : "Turn sounds on", caps: ["M"], run: toggleSfx },
    { group: "App", label: full ? "Leave full screen" : "Full screen", caps: ["Alt", "Enter"], run: toggleFull },
    { group: "App", label: theme === "dark" ? "Light theme" : "Dark theme", run: toggleTheme },
    { group: "App", label: "Keyboard shortcuts", caps: ["?"], run: () => setOverlay("help") },
  ];
  const status = statusOf(health);
  const lesson = route.area === "practice";

  return (
    <div className="shell">
      <Rail path={path} profileGaps={profileGaps} routes={routes} locked={ROUTES.length - routes.length} />
      <TopBar
        route={route}
        status={status}
        dayStreak={dayStreak}
        today={today}
        sfxOn={sfxOn}
        full={full}
        onSfx={toggleSfx}
        onFull={toggleFull}
        onHelp={() => setOverlay("help")}
        onPalette={() => setOverlay("palette")}
      />
      <MobileTop
        route={route}
        status={status}
        dayStreak={dayStreak}
        today={today}
        sfxOn={sfxOn}
        onSfx={toggleSfx}
        lesson={lesson}
      />
      <main className="min-h-0 overflow-x-hidden overflow-y-auto">
        <div className="flex min-h-full flex-col px-4 py-3 pb-[calc(var(--ab-space,0px)+0.75rem)] md:px-6 md:py-5 lg:px-10">
          {lesson && !locked && (
            <Suspense fallback={null}>
              <StepBanner />
            </Suspense>
          )}
          {!lesson && path !== "/settings" && <AiEnergyWait />}
          {locked ? <LockedScreen route={route} /> : children}
        </div>
      </main>
      <ControlsBar />
      {!lesson && <BottomNav path={path} profileGaps={profileGaps} />}
      {overlay === "goto" && <GotoOverlay routes={routes} onGo={go} onClose={close} />}
      {overlay === "palette" && <Palette commands={commands} onClose={close} />}
      {overlay === "help" && <HelpOverlay route={route} routes={routes} onClose={close} />}
      {unlock && !overlay && (
        <UnlockOverlay
          notice={unlock}
          onGo={(href) => {
            setUnlock(null);
            router.push(href);
          }}
          onClose={() => setUnlock(null)}
        />
      )}
      {toast && (
        <div
          className="fixed left-1/2 top-16 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-ok px-5 py-2 text-center font-semibold text-white shadow-lg zq-pop"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
