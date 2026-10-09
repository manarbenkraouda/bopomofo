import { Listening } from "@/components/listening/Listening";

export const metadata = { title: "Listening · Zhuyin Studio" };

export default function ListeningPage() {
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Listening</h1>
        <p className="text-muted">Train your ear: name the tone, or pick the Bopomofo that matches the sound.</p>
      </header>
      <Listening />
    </div>
  );
}
