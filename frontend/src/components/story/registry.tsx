"use client";
// The block catalog of the story, on the frontend side. The keys must match CATALOG in backend/app/story.py:
// .agents/skills/feature/scripts/check_registries.py compares them. An unknown type renders nothing.
import type { ComponentType } from "react";
import type { BlockProps, BlockSpec, BlockType, StoryContext } from "./types";
import { Bars, Calendar, Confusion, Sparkline } from "./blocks/charts";
import { BigNumber, Ring, Versus } from "./blocks/numbers";
import { Steps, SymbolGrid } from "./blocks/symbols";
import { Chips, Cta, Headline, Kicker, Sticker, Text } from "./blocks/text";

export const BLOCKS: { [T in BlockType]: ComponentType<BlockProps<T>> } = {
  // catalog:start
  kicker: Kicker,
  headline: Headline,
  text: Text,
  big_number: BigNumber,
  ring: Ring,
  bars: Bars,
  versus: Versus,
  symbol_grid: SymbolGrid,
  confusion: Confusion,
  calendar: Calendar,
  sparkline: Sparkline,
  chips: Chips,
  steps: Steps,
  sticker: Sticker,
  cta: Cta,
  // catalog:end
};

/** One block from the spec. Each block starts 0.3 s after the one before it. */
export function Block({
  b,
  i,
  ctx,
  onAction,
}: {
  b: BlockSpec;
  i: number;
  ctx: StoryContext;
  onAction: (a: "start" | "close") => void;
}) {
  const C = BLOCKS[b.type] as ComponentType<BlockProps<BlockType>> | undefined;
  if (!C) return null;
  return <C props={b.props as never} ctx={ctx} delay={0.25 + i * 0.32} onAction={onAction} />;
}
