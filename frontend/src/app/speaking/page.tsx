import { Suspense } from "react";
import { SpeakingPractice } from "@/components/speaking/SpeakingPractice";

export const metadata = { title: "Speaking · Zhuyin Studio" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      {/* The mode reads its focus from the URL, so it renders in the browser. */}
      <Suspense>
        <SpeakingPractice />
      </Suspense>
    </div>
  );
}
