import { LevelPath } from "@/components/levels/LevelPath";

export const metadata = { title: "Levels · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <LevelPath />
    </div>
  );
}

