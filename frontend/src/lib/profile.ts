import { useEffect, useSyncExternalStore } from "react";
import { api, type Profile } from "./api";

/** The facts of the profile, in the order of the profile screen. The same keys as PROFILE_LABELS in the backend. */
export const PROFILE_KEYS = [
  "name",
  "chinese_name",
  "age",
  "nationality",
  "hometown",
  "lives_in",
  "job",
  "company",
  "studies",
  "languages",
  "family",
  "hobbies",
  "food",
  "notes",
  "level",
  "why_mandarin",
  "taiwan",
] as const;

export const PROFILE_LABELS: Record<string, string> = {
  name: "Name",
  chinese_name: "Chinese name",
  age: "Age",
  nationality: "Nationality",
  hometown: "Hometown",
  lives_in: "Lives in",
  job: "Job",
  company: "Company or school",
  studies: "Studies",
  languages: "Languages",
  family: "Family",
  hobbies: "Hobbies",
  food: "Favorite food",
  notes: "Other facts",
  level: "Your level",
  why_mandarin: "Why you learn Mandarin",
  taiwan: "Connection to Taiwan",
};

/** The facts that are still empty. */
export const missingFacts = (p: Profile) => PROFILE_KEYS.filter((k) => !(p[k] ?? "").trim());

// One copy of the profile for the whole app: Home, the navigation dot, and the profile screen share it.
let current: Profile | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Give the store a newer profile (after a save), so every screen updates at once. */
export function setProfileCache(p: Profile) {
  current = p;
  listeners.forEach((f) => f());
}

function refresh() {
  pending ??= api
    .profile()
    .then(setProfileCache)
    .catch(() => {})
    .finally(() => {
      pending = null;
    });
}

/** The signed-in learner's profile, or null while it loads. It loads again when a screen that uses it opens. */
export function useProfile(): Profile | null {
  const p = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => current,
    () => null,
  );
  useEffect(refresh, []);
  return p;
}
