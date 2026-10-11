import { playableSrc } from "./api";

let player: HTMLAudioElement | null = null;
const listeners = new Set<(src: string | null) => void>();
let unlocked = false;
let seq = 0;
// 10 ms of silence. iOS Safari plays audio only from a click, until the player has played once. A clip that
// must be fetched first starts after the click, so this silence is played inside the click to unlock the player.
const SILENCE = "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

export function playAudio(src: string): Promise<void> {
  if (!player) {
    player = new Audio();
    const stop = () => { if (!player?.src.startsWith("data:")) listeners.forEach((l) => l(null)); };
    player.onended = stop;
    player.onerror = stop;
  }
  const p = player;
  const n = ++seq;
  p.pause();
  listeners.forEach((l) => l(src));
  const fail = () => { if (n === seq) listeners.forEach((l) => l(null)); };
  const ready = playableSrc(src);
  if (typeof ready === "string") {
    p.src = ready;
    return p.play().then(() => { unlocked = true; }, fail);
  }
  if (!unlocked) {
    p.src = SILENCE;
    p.play().then(() => { unlocked = true; }, () => {});
  }
  return ready.then((url) => {
    if (n !== seq) return;  // another clip started while this one was loading
    p.src = url;
    return p.play();
  }).catch(fail);
}

export function onPlaying(fn: (src: string | null) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
