import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Sign up · bopomofo" };

export default function Page() {
  return <SignUp routing="hash" />;
}
