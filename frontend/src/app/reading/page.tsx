import { Suspense } from "react";
import { ReadingQuiz } from "@/components/reading/ReadingQuiz";

export const metadata = { title: "Reading · Zhuyin Studio" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
      {/* The mode reads its focus from the URL, so it renders in the browser. */}
      <Suspense>
        <ReadingQuiz />
      </Suspense>
    </div>
  );
}
