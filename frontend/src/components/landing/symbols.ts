import type { StrokeData } from "@/lib/zhuyin";

// The symbols on the landing page. The server reads only these from the stroke and audio tables.
export const HERO_SYMBOLS = [..."ㄅㄆㄇㄈ"];
export const DRILL_SYMBOLS = [..."ㄕㄓㄅㄩㄗㄤㄆㄙㄇㄦㄈㄨㄉㄞ"];

export type LandingData = { glyphs: StrokeData; audio: Record<string, string> };
