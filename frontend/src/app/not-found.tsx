import Link from "next/link";
import { BoboPose } from "@/components/mascot/Bobo";

export const metadata = { title: "Page not found · bopomofo" };

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
      <BoboPose pose="encourage" className="w-40 md:w-52" priority />
      <h1 className="text-2xl font-semibold">Bobo can&apos;t find this page</h1>
      <p className="max-w-sm text-muted">It may have moved. Your practice is safe, and Home is one step away.</p>
      <Link href="/" className="btn btn-accent">
        Back to Home
      </Link>
    </div>
  );
}
