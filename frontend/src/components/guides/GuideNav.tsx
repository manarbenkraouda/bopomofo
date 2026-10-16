"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUIDES } from "@/components/landing/brand";

export function GuideNav() {
  const path = usePathname();
  return (
    <nav className="guide-nav" aria-label="Guides">
      {GUIDES.map((g) => (
        <Link key={g.href} className="link" href={g.href} aria-current={path === g.href ? "page" : undefined}>
          {g.short}
        </Link>
      ))}
    </nav>
  );
}
