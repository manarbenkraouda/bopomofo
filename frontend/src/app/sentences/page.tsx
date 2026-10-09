import { Sentences } from "@/components/sentences/Sentences";

export const metadata = { title: "Sentences · Zhuyin Studio" };

export default function SentencesPage() {
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Sentences</h1>
        <p className="text-muted">Generate short Taiwan Mandarin sentences on any topic. Each one gets Bopomofo, audio, a translation, and word glosses. Click a character to hear it.</p>
      </header>
      <Sentences />
    </div>
  );
}
