import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in · bopomofo", robots: { index: false } };

// Hash routing keeps the steps of the form in the URL hash, so this page has one fixed path.
export default function Page() {
  return <SignIn routing="hash" />;
}
