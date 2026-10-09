import { Dashboard } from "@/components/home/Dashboard";

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-end gap-4">
        <div>
          <h1 className="text-3xl font-semibold"><span className="cjk">注音</span> Zhuyin Studio</h1>
          <p className="text-muted">Read, write, hear, and speak Bopomofo, with feedback on every stroke and every tone.</p>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}
