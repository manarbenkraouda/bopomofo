import { Sentences } from "@/components/sentences/Sentences";

export const metadata = { title: "Sentences · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      <Sentences />
    </div>
  );
}
