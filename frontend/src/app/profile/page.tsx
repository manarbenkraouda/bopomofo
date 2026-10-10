import { ProfileForm } from "@/components/profile/ProfileForm";

export const metadata = { title: "Profile · bopomofo" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      <ProfileForm />
    </div>
  );
}
