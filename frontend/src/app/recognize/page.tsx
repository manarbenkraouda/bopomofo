import { Suspense } from "react";
import { RecognizeQuiz } from "@/components/recognize/RecognizeQuiz";

export const metadata = { title: "Recognize · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
      {/* The mode reads its focus from the URL, so it renders in the browser. */}
      <Suspense>
        <RecognizeQuiz />
      </Suspense>
    </div>
  );
}

