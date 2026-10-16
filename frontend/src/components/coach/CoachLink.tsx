"use client";

import { Caps } from "@/components/shell/Kbd";
import Link from "next/link";

export function CoachLink() {
  return (
    <Link href="/coach" className="flex items-center gap-1 text-xs text-accent hover:underline">
      Open Bobo’s plan <Caps caps={["G", "C"]} className="max-md:!hidden" />
    </Link>
  );
}
