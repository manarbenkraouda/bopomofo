export const BOX: number;
export const TONE_MARKS: string[];
export type Pt = [number, number];
export type Templates = Record<string, { variant: string; strokes: Pt[][] }[]>;
export type StrokeResult = { index: number; status: "ok" | "rough" | "wrong" | "reversed" | "missing" | "joined"; userIdx: number | null; hint: string | null; cost?: number; joinedWith?: number; orderError?: boolean };
export type SymbolResult = {
  expected: string; empty?: boolean; variant?: string; recognized?: string | null; ranking?: { ch: string; score: number }[];
  score?: number; frame?: { name: string; scale: number; tx: number; ty: number }; ok: boolean; nearly?: boolean;
  strokes: StrokeResult[]; extras: number[]; messages: string[];
};
export function buildTemplates(data: Record<string, { track: Pt[] }[]>): Templates;
export function recognize(strokes: Pt[][], templates: Templates, candidates: string[]): { ch: string; variant: string; score: number }[];
export function correctSymbol(strokes: Pt[][], expected: string, templates: Templates, candidates: string[]): SymbolResult;
export function splitZhuyin(z: string): { symbols: string[]; tone: string };
export function resample(pts: Pt[], n?: number): Pt[];
