import { Suspense } from "react";
import { WritingPractice } from "@/components/writing/WritingPractice";

export const metadata = { title: "Writing · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      {/* The mode reads its focus from the URL, so it renders in the browser. */}
      <Suspense>
        <WritingPractice />
      </Suspense>
    </div>
  );
}
