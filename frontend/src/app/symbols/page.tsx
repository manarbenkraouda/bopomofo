import { SymbolChart } from "@/components/symbols/SymbolChart";

export const metadata = { title: "Symbols · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <SymbolChart />
    </div>
  );
}
