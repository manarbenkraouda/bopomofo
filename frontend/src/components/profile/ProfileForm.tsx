"use client";
import { useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { Kbd } from "@/components/shell/Kbd";

const FIELDS: { key: string; label: string; hint: string; long?: boolean }[] = [
  { key: "name", label: "Name", hint: "e.g. Manar" },
  { key: "chinese_name", label: "Chinese name", hint: "e.g. 馬納 (optional)" },
  { key: "age", label: "Age", hint: "e.g. 32" },
  { key: "nationality", label: "Nationality", hint: "e.g. French" },
  { key: "hometown", label: "Hometown", hint: "e.g. Lyon" },
  { key: "lives_in", label: "Lives in", hint: "e.g. Paris" },
  { key: "job", label: "Job", hint: "e.g. software engineer" },
  { key: "company", label: "Company or school", hint: "e.g. my own tech company" },
  { key: "studies", label: "Studies", hint: "e.g. computer science" },
  { key: "languages", label: "Languages", hint: "e.g. French, English, Arabic" },
  { key: "family", label: "Family", hint: "e.g. married, one younger sister", long: true },
  { key: "hobbies", label: "Hobbies", hint: "e.g. climbing, cooking, video games", long: true },
  { key: "food", label: "Favorite food", hint: "e.g. beef noodle soup" },
  { key: "why_mandarin", label: "Why you learn Mandarin", hint: "e.g. I want to travel in Taiwan", long: true },
  { key: "taiwan", label: "Connection to Taiwan", hint: "e.g. I visited Taipei in 2025", long: true },
  { key: "notes", label: "Other facts", hint: "Anything else you want in your sentences", long: true },
];

export function ProfileForm() {
  const [p, setP] = useState<Profile>({});
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved">("loading");
  const [error, setError] = useState("");

  useEffect(() => { api.profile().then((r) => { setP(r); setState("idle"); }).catch((e) => { setError(e.message); setState("idle"); }); }, []);

  const set = (k: string, v: string) => { setP({ ...p, [k]: v }); setState("idle"); };
  const save = async () => {
    setState("saving"); setError("");
    try { setP(await api.saveProfile(p)); setState("saved"); } catch (e) { setError((e as Error).message); setState("idle"); }
  };
  useHotkeys("profile", [{ keys: ["Ctrl+KeyS", "Ctrl+Enter"], label: "Save", run: save, when: state !== "saving" && state !== "loading", input: true }]);

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="grid md:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <label key={f.key} className={"flex flex-col gap-1 text-sm " + (f.long ? "md:col-span-2" : "")}>
            <span className="font-medium">{f.label}</span>
            {f.long
              ? <textarea className="input min-h-20" placeholder={f.hint} value={p[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
              : <input className="input" placeholder={f.hint} value={p[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-accent" onClick={save} disabled={state === "saving" || state === "loading"}>{state === "saving" ? "Saving…" : <>Save profile <Kbd>Ctrl</Kbd><Kbd>S</Kbd></>}</button>
        {state === "saved" && <span className="text-sm text-ok">Saved. New sentences will use your profile.</span>}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
    </div>
  );
}
