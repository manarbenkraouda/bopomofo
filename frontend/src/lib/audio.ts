let player: HTMLAudioElement | null = null;
const listeners = new Set<(src: string | null) => void>();

export function playAudio(src: string): Promise<void> {
  if (!player) {
    player = new Audio();
    player.onended = () => listeners.forEach((l) => l(null));
    player.onerror = () => listeners.forEach((l) => l(null));
  }
  player.pause();
  player.src = src;
  listeners.forEach((l) => l(src));
  return player.play().catch(() => listeners.forEach((l) => l(null)));
}

export function onPlaying(fn: (src: string | null) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
