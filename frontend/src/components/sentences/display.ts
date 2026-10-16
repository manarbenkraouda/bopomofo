import { ttsUrl, type TextItem } from "@/lib/api";
import { playAudio } from "@/lib/audio";

export const scoreTone = (n: number) =>
  n >= 85 ? "text-ok bg-ok/15" : n >= 60 ? "text-rough bg-rough/15" : "text-bad bg-bad/15";

export const sayWord = (t: string) => playAudio(ttsUrl(t));

/** Topics typed by hand can differ only in case ("Complete introduction", "complete introduction"): they are one topic. */
export const topicKey = (t: string) => t.trim().toLowerCase();

export const topicName = (t: string) => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);

export const hearSyllable = (items: TextItem[], i: number) => {
  const s = items.filter((x) => x.type === "syllable")[i];
  if (s?.type === "syllable") sayWord(s.char);
};
