"use client";

import { routeIcon } from "@/components/mascot/Bobo";
import { keyCaps } from "@/lib/hotkeys";
import { routeFor, type RouteInfo } from "@/lib/routes";
import Link from "next/link";

/** The blinking dot under a tab while the profile is not complete. */
function NudgeDot({ gaps }: { gaps: number }) {
  return (
    <>
      <i className="nudge-dot" aria-hidden="true" />
      <span className="sr-only">: {gaps} profile facts missing</span>
    </>
  );
}

/** The side rail: only the screens that are open at the learner's level, and one link to the path for the rest. */
export function Rail({
  path,
  profileGaps,
  routes,
  locked,
}: {
  path: string;
  profileGaps: number;
  routes: RouteInfo[];
  locked: number;
}) {
  const item = (r: RouteInfo) => {
    const active = r.href === "/" ? path === "/" : path.startsWith(r.href);
    const nudge = r.href === "/profile" && profileGaps > 0;
    return (
      <Link
        key={r.href}
        href={r.href}
        data-active={active}
        className="rail-item"
        title={
          nudge
            ? "Complete your profile: " + profileGaps + " facts missing (G then P)"
            : r.label + " (G then " + keyCaps(r.key).join("") + ")"
        }
      >
        <span className="cjk text-[21px] leading-none">{routeIcon(r, 26)}</span>
        <span className="text-[10px] leading-none">{r.label}</span>
        {nudge && <NudgeDot gaps={profileGaps} />}
      </Link>
    );
  };
  return (
    <nav className="row-span-3 hidden flex-col items-center gap-1 overflow-y-auto border-r border-line bg-card py-3 md:flex">
      <Link
        href="/"
        title="Home (G then H)"
        className={
          "cjk mb-2 grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl text-white shadow transition " +
          (path === "/" ? "bg-accent ring-4 ring-accent-soft" : "bg-accent/85 hover:bg-accent")
        }
      >
        注
      </Link>
      {routes.filter((r) => r.area === "progress").map(item)}
      <div className="my-1.5 h-px w-8 shrink-0 bg-line" />
      {routes.filter((r) => r.area === "practice" || r.area === "study").map(item)}
      {locked > 0 && (
        <Link
          href="/levels"
          className="rail-item opacity-60 hover:opacity-100"
          title={locked + " more screens open at higher levels (G then V)"}
        >
          <span className="text-[17px] leading-none">🔒</span>
          <span className="text-[10px] leading-none">+{locked}</span>
        </Link>
      )}
      <div className="mt-auto" />
      {routes.filter((r) => r.area === "me").map(item)}
    </nav>
  );
}

const TABS = ["/", "/levels", "/coach", "/stats", "/symbols", "/settings"];

/** Phone bottom tab bar (hidden inside practice modes, where ✕ leads back to Home). The profile is inside Settings on a phone. */
export function BottomNav({ path, profileGaps }: { path: string; profileGaps: number }) {
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
