import { Coach } from "@/components/coach/Coach";

export const metadata = { title: "Bobo, your coach · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <Coach />
    </div>
  );
}

