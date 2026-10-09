import { SpeakingPractice } from "@/components/speaking/SpeakingPractice";

export const metadata = { title: "Speaking · Zhuyin Studio" };

export default function SpeakingPage() {
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Speaking</h1>
        <p className="text-muted">Record yourself. A local speech model checks every syllable: initial, final, and tone (including tone changes such as 你好 → ㄋㄧˊ ㄏㄠˇ).</p>
      </header>
      <SpeakingPractice />
    </div>
  );
}
