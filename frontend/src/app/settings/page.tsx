import Link from "next/link";
import { Preferences } from "@/components/settings/Preferences";
import { VoicePicker } from "@/components/settings/VoicePicker";
import { AiEnergyCard } from "@/components/quota/AiQuota";

export const metadata = { title: "Settings · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div id="ai-energy" className="scroll-mt-4"><AiEnergyCard /></div>
      <Preferences />
      <VoicePicker />
      <Link href="/profile" className="card flex items-center gap-3 p-4 hover:border-accent md:hidden">
        <span className="cjk grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-xl text-accent">我</span>
        <span className="flex-1"><b>Profile</b><span className="block text-xs text-muted">Facts about you for generated sentences</span></span>
        <span className="text-muted">›</span>
      </Link>
    </div>
  );
}
