import { Suspense } from "react";
import { Characters } from "@/components/characters/Characters";

export const metadata = { title: "Characters · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
      {/* The exercise reads its focus from the URL, so it renders in the browser. */}
      <Suspense>
        <Characters />
      </Suspense>
    </div>
  );
}
