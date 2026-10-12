import Image from "next/image";
import type { ReactNode } from "react";
import type { RouteInfo } from "@/lib/routes";

/**
 * Bobo (波波, ㄅㄛ ㄅㄛ), the Formosan black bear who coaches the learner. ㄅ "bo" is the first Bopomofo symbol.
 * The white V collar on the chest is the mark of the brand: it comes back as the V shape behind coach cards.
 * The bear is near black, so it always sits on a light disc or glow, in both themes.
 */
export const BOBO = { name: "Bobo", hanzi: "波波", zhuyin: "ㄅㄛ ㄅㄛ" } as const;

/** Bobo's face and V collar in a round light disc: the avatar of the coach. */
export function BoboFace({ size = 40, className = "", pulse = false }: { size?: number; className?: string; pulse?: boolean }) {
  return (
    <span className={"bobo-disc relative inline-block shrink-0 overflow-hidden rounded-full " + (pulse ? "bobo-bob " : "") + className} style={{ width: size, height: size }}>
      <Image src="/mascot/bobo-face.webp" alt={BOBO.name} width={320} height={320} className="h-full w-full object-cover" />
    </span>
  );
}

/** Bobo full body, waving, on a soft glow. */
export function BoboPackshot({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <span className={"bobo-glow relative inline-block " + className}>
      <Image src="/mascot/bobo.webp" alt={BOBO.name + ", the Formosan black bear coach"} width={720} height={755} priority={priority} className="relative h-auto w-full drop-shadow-xl" />
    </span>
  );
}

/** The white V collar of Bobo, as a large faint mark behind a card. Give it a size and a position. */
export function VMark({ className = "" }: { className?: string }) {
  return <span aria-hidden className={"v-mark pointer-events-none absolute select-none " + className} />;
}

/** A line Bobo says, with its face. */
export function BoboSays({ children, size = 28, className = "" }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <div className={"flex items-start gap-2.5 " + className}>
      <BoboFace size={size} />
      <div className="min-w-0 flex-1 rounded-xl bg-raise px-3.5 py-2.5 text-sm">{children}</div>
    </div>
  );
}

/** The icon of a route: Bobo's face for the coach, the character for the other screens. */
export function routeIcon(r: RouteInfo, size: number): ReactNode {
  return r.href === "/coach" ? <BoboFace size={size} /> : r.icon;
}

/** Bobo in a scene. Every pose keeps the white V collar visible. */
export type Pose = "welcome" | "thinking" | "celebrate" | "listening" | "speaking" | "reading" | "writing" | "sleeping" | "encourage" | "investigate" | "bubbletea" | "tones" | "symbol" | "sound" | "mixup" | "stats" | "plan";

const POSE_ALT: Record<Pose, string> = {
  welcome: "Bobo waves hello with a red lantern",
  thinking: "Bobo thinks, a brush at its chin",
  celebrate: "Bobo jumps for joy in red and gold confetti",
  listening: "Bobo listens with red headphones",
  speaking: "Bobo speaks into a gold microphone",
  reading: "Bobo reads a red book",
  writing: "Bobo writes ㄅ with a brush",
  sleeping: "Bobo sleeps on a red cushion",
  encourage: "Bobo gives a thumbs-up",
  investigate: "Bobo looks through a magnifying glass",
  bubbletea: "Bobo drinks a bubble tea",
  tones: "Bobo conducts five colored tone contours",
  symbol: "Bobo sorts Bopomofo symbol tiles",
  sound: "Bobo listens for Mandarin sounds",
  mixup: "Bobo solves a Bopomofo mix-up",
  stats: "Bobo presents a learner progress chart",
  plan: "Bobo guides the learner along a path",
};

export function BoboPose({ pose, className = "", priority = false, bob = false }: { pose: Pose; className?: string; priority?: boolean; bob?: boolean }) {
  return (
    <span className={"relative inline-block shrink-0 " + (bob ? "bobo-bob " : "") + className}>
      <Image src={pose.startsWith("tones") || ["symbol", "sound", "mixup", "stats", "plan"].includes(pose) ? "/mascot/bobo-story-" + pose + ".webp" : "/mascot/bobo-" + pose + ".webp"}
        alt={POSE_ALT[pose]} width={560} height={587} priority={priority} className="h-auto w-full drop-shadow-lg" />
    </span>
  );
}

/** The pose that goes with each screen. */
const ROUTE_POSE: Record<string, Pose> = {
  "/": "welcome", "/levels": "plan", "/coach": "thinking", "/stats": "investigate", "/reading": "reading", "/listening": "listening", "/dictation": "writing",
  "/speaking": "speaking", "/writing": "writing", "/recognize": "thinking", "/symbols": "reading", "/sentences": "speaking", "/profile": "welcome", "/settings": "bubbletea",
};
export const poseFor = (r: RouteInfo): Pose => ROUTE_POSE[r.href] ?? "welcome";
