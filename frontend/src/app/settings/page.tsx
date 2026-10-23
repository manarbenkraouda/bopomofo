import { Preferences } from "@/components/settings/Preferences";
import { LevelAccess } from "@/components/settings/LevelAccess";
import { ReviewSettings } from "@/components/settings/ReviewSettings";
import { VoicePicker } from "@/components/settings/VoicePicker";
import { AiEnergyCard } from "@/components/quota/AiQuota";
import { ProfileLink } from "@/components/profile/ProfileLink";

export const metadata = { title: "Settings · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <ProfileLink />
      <div id="ai-energy" className="scroll-mt-4">
        <AiEnergyCard />
      </div>
      <Preferences />
      <LevelAccess />
      <ReviewSettings />
      <VoicePicker />
    </div>
  );
}
