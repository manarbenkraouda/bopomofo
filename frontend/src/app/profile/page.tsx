import { ProfileForm } from "@/components/profile/ProfileForm";

export const metadata = { title: "Profile · Zhuyin Studio" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
      <ProfileForm />
    </div>
  );
}
