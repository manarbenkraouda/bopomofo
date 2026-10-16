"use client";

/** A small button that plays one recording. */
export function PlaySound({ src, label }: { src: string; label: string }) {
  return (
    <button
      type="button"
      className="play"
      aria-label={label}
      onClick={() => void new Audio(src).play().catch(() => {})}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
      </svg>
    </button>
  );
}
