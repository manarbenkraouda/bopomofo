"use client";
// Small browser-side preferences with change events, so every open view updates at once.
import { useSyncExternalStore } from "react";

const EVENT = "zhuyin:pref";

export function setPref(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export function usePref(key: string, fallback: string): string {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener(EVENT, f);
      window.addEventListener("storage", f);
      return () => {
        window.removeEventListener(EVENT, f);
        window.removeEventListener("storage", f);
      };
    },
    () => localStorage.getItem(key) ?? fallback,
    () => fallback,
  );
}

export type Theme = "dark" | "light";
export const THEME_KEY = "zhuyin.theme";
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  setPref(THEME_KEY, t);
}
