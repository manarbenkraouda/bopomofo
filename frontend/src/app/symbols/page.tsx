import { SymbolChart } from "@/components/symbols/SymbolChart";

export const metadata = { title: "Symbols · Zhuyin Studio" };

export default function SymbolsPage() {
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">The 37 symbols and 5 tones</h1>
        <p className="text-muted">Click a symbol to hear it (official MOE recordings) and watch its stroke order.</p>
      </header>
      <SymbolChart />
    </div>
  );
}
