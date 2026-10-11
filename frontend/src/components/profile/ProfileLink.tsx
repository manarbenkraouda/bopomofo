"use client";
import Link from "next/link";
import { missingFacts, PROFILE_KEYS, useProfile } from "@/lib/profile";

/** The way to the profile on a phone (the desktop rail has its own tab). A blinking dot while facts are missing. */
export function ProfileLink() {
  const p = useProfile();
  const gaps = p ? missingFacts(p).length : 0;
  return (
    <Link href="/profile" className={"card flex items-center gap-3 p-4 hover:border-accent md:hidden " + (gaps ? "border-accent/50" : "")}>
      <span className="relative cjk grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-xl text-accent">
        我
        {gaps > 0 && <i className="nudge-dot !-bottom-1" aria-hidden="true" />}
      </span>
      <span className="flex-1">
        <b>Profile</b>
        <span className={"block text-xs " + (gaps ? "text-accent" : "text-muted")}>
          {gaps ? (PROFILE_KEYS.length - gaps) + " of " + PROFILE_KEYS.length + " facts · complete it so your sentences talk about you" : "Facts about you for generated sentences"}
        </span>
      </span>
      <span className="text-muted">›</span>
    </Link>
  );
}
