"use client";

import { capsOf, useLayers, type Hotkey } from "@/lib/hotkeys";
import { Caps, Kbd } from "./Kbd";

/** The bottom bar: the keys you can press now. */
export function ControlsBar() {
  const layers = useLayers();
  const modal = layers.find((l) => l.modal);
  const keys: Hotkey[] = modal ? modal.keys : layers.filter((l) => l.order === 1).flatMap((l) => l.keys);
  const shown = keys.filter((k) => k.when !== false && k.bar !== false && capsOf(k).length);
  return (
    <footer className="hidden min-w-0 items-center gap-4 border-t border-line bg-card px-4 text-xs text-muted md:flex">
      <div className="flex min-w-0 flex-1 items-center gap-x-4 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_92%,transparent)]">
        {shown.map((k, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <Caps caps={capsOf(k)} />
            <span>{k.label}</span>
          </span>
        ))}
      </div>
      {!modal && (
        <div className="hidden shrink-0 items-center gap-4 whitespace-nowrap md:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>G</Kbd>Go to
          </span>
          <span className="flex items-center gap-1.5">
            <Caps caps={["Ctrl", "K"]} />
            Commands
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>?</Kbd>Shortcuts
          </span>
        </div>
      )}
    </footer>
  );
}
