import { Stats } from "@/components/stats/Stats";

export const metadata = { title: "Stats · Zhuyin Studio" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <Stats />
    </div>
  );
}

