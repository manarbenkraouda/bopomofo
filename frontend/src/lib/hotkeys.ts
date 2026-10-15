"use client";
// One keyboard system for the whole app.
// Keys are matched on KeyboardEvent.code (the physical key), so they work the same on QWERTY, AZERTY, and other layouts.
// Each screen registers a layer of keys. The controls bar, the help overlay, and the command palette read the same layers.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

export type Hotkey = {
  /** KeyboardEvent.code values with optional "Ctrl+", "Alt+", "Shift+" prefixes, e.g. "Space", "Digit1", "Shift+Slash". */
  keys: string[];
  label: string;
  run?: (e: KeyboardEvent) => void;
  /** false: the key does nothing now and is not shown. */
  when?: boolean;
  /** false: hidden from the controls bar (still listed in help). */
  bar?: boolean;
  /** Also works while typing in a field. */
  input?: boolean;
  /** Fires again while the key is held down. */
  repeat?: boolean;
  /** Key caps to show instead of the real keys, e.g. "1-4". */
  show?: string[];
  /** Hold the key: run fires once on the press, up on the release (or when the window loses focus). */
  up?: () => void;
};

type Layer = { id: number; name: string; modal: boolean; order: number; get: () => Hotkey[] };

const layers: Layer[] = [];
const subs = new Set<() => void>();
let version = 0;
let seq = 0;
let installed = false;
/** Keys held down now, with their release handlers. */
const held = new Map<string, () => void>();
const emit = () => { version++; subs.forEach((f) => f()); };

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT" ||
    (t instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit", "file"].includes(t.type)));

export const comboOf = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + e.code;

/** Layers from the top: overlays, then the screen, then the global keys. */
const ordered = () => [...layers].sort((a, b) => b.order - a.order || b.id - a.id);

function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.defaultPrevented) return;
  if (e.repeat && held.has(e.code)) { e.preventDefault(); return; }
  const combo = comboOf(e);
  const typing = isTyping(e.target);
  for (const layer of ordered()) {
    const hit = layer.get().find((k) => k.run && k.when !== false && k.keys.includes(combo) && (!typing || k.input) && (!e.repeat || k.repeat));
    if (hit) {
      e.preventDefault();
      if (hit.up) held.set(e.code, hit.up);
      hit.run!(e);
      return;
    }
    if (layer.modal) return;
  }
}

function onKeyUp(e: KeyboardEvent) {
  const up = held.get(e.code);
  if (!up) return;
  held.delete(e.code);
  e.preventDefault();
  up();
}

function releaseAll() {
  const ups = [...held.values()];
  held.clear();
  ups.forEach((f) => f());
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);
}

const signature = (keys: Hotkey[]) => keys.map((k) => k.keys.join(",") + ":" + k.label + ":" + (k.when !== false) + ":" + (k.bar !== false)).join("|");

/**
 * Register keys while the component is mounted. Pass a fresh array on every render; handlers always see the latest state.
 * order: 0 = global keys, 1 = screen keys (default), 10+ = overlays. A modal layer blocks all layers below it.
 */
export function useHotkeys(name: string, keys: Hotkey[], opts: { modal?: boolean; order?: number; active?: boolean } = {}) {
  const ref = useRef(keys);
  const { modal = false, order = 1, active = true } = opts;
  useLayoutEffect(() => { ref.current = keys; });
  const sig = signature(keys);
  useEffect(() => {
    if (!active) return;
    const layer: Layer = { id: ++seq, name, modal, order, get: () => ref.current };
    layers.push(layer);
    install();
    emit();
    return () => { layers.splice(layers.indexOf(layer), 1); emit(); };
  }, [active, name, modal, order]);
  useEffect(() => { emit(); }, [sig]);
}

export type LayerView = { name: string; modal: boolean; order: number; keys: Hotkey[] };

/** The registered layers, from the top. Re-renders when keys change. */
export function useLayers(): LayerView[] {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version, () => 0);
  return ordered().map((l) => ({ name: l.name, modal: l.modal, order: l.order, keys: l.get() }));
}

const NAMES: Record<string, string> = {
  Space: "Space", Enter: "Enter", Escape: "Esc", Backspace: "⌫", Delete: "Del", Tab: "Tab",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  BracketLeft: "[", BracketRight: "]", Slash: "/", Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Minus: "-", Equal: "=",
};

/** Key caps for one combo, e.g. "Ctrl+KeyK" gives ["Ctrl", "K"]. */
export function keyCaps(combo: string): string[] {
  if (combo === "Shift+Slash") return ["?"];
  const parts = combo.split("+");
  const code = parts.pop()!;
  return [...parts, NAMES[code] ?? code.replace(/^(Key|Digit|Numpad)/, "")];
}

/** The key caps to show for a hotkey: its first key, or its custom caps. */
export const capsOf = (k: Hotkey) => k.show ?? (k.keys[0] ? keyCaps(k.keys[0]) : []);

/** Keys for "previous / next" in a list of modes, bound to [ and ]. */
export function cycleKeys<T>(label: string, list: readonly T[], cur: T, set: (v: T) => void, when = true): Hotkey[] {
  const go = (d: number) => set(list[(list.indexOf(cur) + d + list.length) % list.length]);
  return [
    { keys: ["BracketLeft"], label: label + " (previous)", run: () => go(-1), when, bar: false },
    { keys: ["BracketRight"], label: label + " (next)", run: () => go(1), when, bar: false },
    { keys: [], label, show: ["[", "]"], when },
  ];
}

/** Answer keys: 1-4 on the number row or keypad, or A S D F on the home row. */
export const ANSWER_KEYS = [
  ["Digit1", "Numpad1", "KeyA"],
  ["Digit2", "Numpad2", "KeyS"],
  ["Digit3", "Numpad3", "KeyD"],
  ["Digit4", "Numpad4", "KeyF"],
];
export const ANSWER_LETTERS = ["A", "S", "D", "F"];
