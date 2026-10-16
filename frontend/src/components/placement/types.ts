import { type TextItem } from "@/lib/api";

export type Card = { text: string; english?: string; items: TextItem[]; mode: "syllable" | "sentence" };
