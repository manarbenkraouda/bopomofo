"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type Know = "none" | "some" | "read";
const NEXT: Record<Know, string> = {
  none: "We start with ㄅ, the first symbol.",
  some: "The placement test will find your level.",
  read: "Take the placement test and skip ahead.",
};
const OPTIONS: [Know, string][] = [
  ["none", "Not yet"],
  ["some", "I know some symbols"],
  ["read", "I can read it"],
];

/** The first question of the onboarding. Bobo answers as you type; the account itself is made on the sign-up page. */
export function NameDialog({ signedIn }: { signedIn: boolean }) {
  const [name, setName] = useState("");
  const [know, setKnow] = useState<Know>("none");
  const first = name.trim();
  return (
    <form className="dialog" data-ui onSubmit={(e) => e.preventDefault()}>
      <Image className="face" src="/mascot/bobo-face.webp" alt="" width={128} height={128} />
      <h3>What should we call you?</h3>
      <label>
        Your first name
        <input
          type="text"
          name="name"
          autoComplete="given-name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <fieldset>
        <legend>Do you know Bopomofo?</legend>
        {OPTIONS.map(([value, text]) => (
          <label className="opt" key={value}>
            <input type="radio" name="know" value={value} checked={know === value} onChange={() => setKnow(value)} />
            {text}
          </label>
        ))}
      </fieldset>
      <p className="reply" aria-live="polite">
        {first ? "Nice to meet you, " + first + ". " + NEXT[know] : ""}
      </p>
      <Link className="go" href={signedIn ? "/" : "/sign-up"}>
        {signedIn ? "Open the app" : "Make my account"} <span aria-hidden="true">&rarr;</span>
      </Link>
      {!signedIn && (
        <p className="alt">
          Already have one?{" "}
          <Link className="link-plain" href="/sign-in">
            Sign in
          </Link>
        </p>
      )}
    </form>
  );
}
