import Link from "next/link";
import { Preferences } from "@/components/settings/Preferences";
import { VoicePicker } from "@/components/settings/VoicePicker";

export const metadata = { title: "Settings · Zhuyin Studio" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
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
