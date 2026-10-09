"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/symbols", label: "Symbols", icon: "ㄅ" },
  { href: "/sentences", label: "Sentences", icon: "句" },
  { href: "/speaking", label: "Speaking", icon: "說" },
  { href: "/writing", label: "Writing", icon: "寫" },
  { href: "/listening", label: "Listening", icon: "聽" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-line bg-card px-3 py-3 md:px-4 md:py-6 flex md:flex-col gap-1 md:sticky md:top-0 md:h-screen overflow-x-auto">
      <Link href="/" className="hidden md:flex items-center gap-2 px-2 mb-6">
        <span className="cjk grid place-items-center w-9 h-9 rounded-xl bg-accent text-white text-lg">注</span>
        <span className="font-semibold text-lg">Zhuyin Studio</span>
      </Link>
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={"flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] whitespace-nowrap " + (active ? "bg-ink text-white" : "text-ink hover:bg-bg")}>
            <span className="cjk w-5 text-center">{l.icon}</span>
            {l.label}
          </Link>
        );
      })}
      <div className="hidden md:block mt-auto text-xs text-muted px-2 leading-relaxed">
        Taiwan Mandarin · 注音符號
        <br />
        Stroke data: MOE 國語注音符號手冊
      </div>
    </nav>
  );
}
