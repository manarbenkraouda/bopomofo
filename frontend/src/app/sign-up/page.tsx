import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Sign up · bopomofo" };

// A new account goes to the onboarding first.
export default function Page() {
  return <SignUp routing="hash" forceRedirectUrl="/onboarding" />;
}
