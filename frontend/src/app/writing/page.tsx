import { WritingPractice } from "@/components/writing/WritingPractice";

export const metadata = { title: "Writing · Zhuyin Studio" };

export default function WritingPage() {
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Writing</h1>
        <p className="text-muted">Hear a sound, write the Bopomofo by hand, and get a correction for every stroke: order, direction, shape, and missing or extra strokes.</p>
      </header>
      <WritingPractice />
    </div>
  );
}
