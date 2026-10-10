// The story spec, as saved by the backend (backend/app/story.py). The backend checks every block against its CATALOG
// and fills every number in before saving, so the frontend only draws: a block never computes or invents a number.

export type Fact = { key: string; label: string; value: number; unit: string };
export type Series = { key: string; label: string; values: number[]; labels: string[]; unit: string; series: true };
export type Mood = "warm" | "calm" | "bright" | "deep" | "win";

export type BlockSpec =
  | { type: "kicker"; props: { text: string } }
  | { type: "headline"; props: { text: string } }
  | { type: "text"; props: { text: string } }
  | { type: "big_number"; props: { value: Fact; label: string } }
  | { type: "ring"; props: { value: Fact; label: string } }
  | { type: "bars"; props: { items: { label: string; value: Fact; highlight?: boolean }[] } }
  | { type: "versus"; props: { left: { label: string; value: Fact }; right: { label: string; value: Fact } } }
  | { type: "symbol_grid"; props: { highlight?: string[] } }
  | { type: "confusion"; props: { pairs: { from: string; to: string; count: Fact }[] } }
  | { type: "calendar"; props: Record<string, never> }
  | { type: "sparkline"; props: { series: Series; label: string } }
  | { type: "chips"; props: { items: string[] } }
  | { type: "steps"; props: Record<string, never> }
  | { type: "sticker"; props: { glyph: string; text?: string } }
  | { type: "cta"; props: { label: string; action: "start" | "close" } };

export type BlockType = BlockSpec["type"];

export type StoryCard = { id: string; mood: Mood; seconds: number; blocks: BlockSpec[] };

export type StoryContext = {
  alphabet: { known: string; learning: string; new: string; reps: Record<string, number>; reps_needed: number; next: string[] };
  calendar: { day: string; minutes: number }[];
  steps: { type: string; title: string; target: number; minutes: number | null; learn: boolean }[];
};

export type Story = { v: 1; source: "llm" | "rules"; cards: StoryCard[]; context: StoryContext; plan_id: number; headline: string | null };

/** What every block component gets: its props, the story data, when to start (seconds), and the button handler. */
export type BlockProps<T extends BlockType> = {
  props: Extract<BlockSpec, { type: T }>["props"];
  ctx: StoryContext;
  delay: number;
  onAction: (a: "start" | "close") => void;
};

