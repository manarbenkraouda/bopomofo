"use client";
import { useEffect, useRef, useState } from "react";
import { keyCaps, useHotkeys, useLayers, type Hotkey } from "@/lib/hotkeys";
import { type RouteInfo } from "@/lib/routes";
import { Caps, Kbd } from "./Kbd";
import { BoboPose, poseFor, routeIcon } from "@/components/mascot/Bobo";

export type Command = { group: string; label: string; hint?: string; caps?: string[]; run: () => void };

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[10vh] backdrop-blur-sm zq-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={"card overflow-hidden shadow-2xl " + (wide ? "w-[min(94vw,900px)]" : "w-[min(94vw,580px)]")}>
        {children}
      </div>
    </div>
  );
}

/** "G then a key": jump to any open screen. Screens that open at a higher level are not in the list. */
export function GotoOverlay({
  routes,
  onGo,
  onClose,
}: {
  routes: RouteInfo[];
  onGo: (href: string) => void;
  onClose: () => void;
}) {
  useHotkeys(
    "goto",
    [
      ...routes.map((r) => ({ keys: [r.key], label: r.label, run: () => onGo(r.href) })),
      { keys: ["Escape", "KeyG"], label: "Close", run: onClose },
    ],
    { modal: true, order: 10 },
  );
  return (
    <Modal onClose={onClose}>
      <div className="p-4">
        <div className="mb-3 text-sm text-muted">Go to: press a key</div>
        <div className="grid grid-cols-2 gap-2">
          {routes.map((r) => (
            <button
              key={r.href}
              onClick={() => onGo(r.href)}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:border-accent"
            >
              <Kbd className="w-7">{keyCaps(r.key)}</Kbd>
              <span className="cjk grid w-6 place-items-center text-lg text-accent">{routeIcon(r, 24)}</span>
              <span className="font-medium">{r.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Ctrl+K: search every screen, setting, and action of the current screen. */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  // Matches in the label come before matches in the group or the hint.
  const rank = (c: Command) => (words.every((w) => c.label.toLowerCase().includes(w)) ? 0 : 1);
  const list = commands
    .filter((c) => words.every((w) => (c.group + " " + c.label + " " + (c.hint ?? "")).toLowerCase().includes(w)))
    .map((c, i) => [rank(c), i, c] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , c]) => c);
  const sel = Math.max(0, Math.min(i, list.length - 1));
  const run = (c: Command) => {
    onClose();
    setTimeout(c.run, 0);
  };
  useHotkeys(
    "palette",
    [
      {
        keys: ["ArrowDown", "Tab"],
        label: "Next",
        run: () => setI(Math.min(sel + 1, list.length - 1)),
        input: true,
        repeat: true,
      },
      {
        keys: ["ArrowUp", "Shift+Tab"],
        label: "Previous",
        run: () => setI(Math.max(sel - 1, 0)),
        input: true,
        repeat: true,
      },
      {
        keys: ["Enter"],
        label: "Run",
        run: () => {
          if (list[sel]) run(list[sel]);
        },
        input: true,
      },
      { keys: ["Escape", "Ctrl+KeyK"], label: "Close", run: onClose, input: true },
    ],
    { modal: true, order: 10 },
  );
  useEffect(() => {
    listRef.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return (
    <Modal onClose={onClose}>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setI(0);
        }}
        placeholder="Type a screen, a setting, or an action…"
        className="w-full border-b border-line bg-transparent px-5 py-4 text-lg outline-none placeholder:text-muted"
      />
      <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
        {list.map((c, k) => (
          <button
            key={c.group + c.label}
            data-sel={k === sel}
            onMouseMove={() => setI(k)}
            onClick={() => run(c)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left data-[sel=true]:bg-accent-soft"
          >
            <span className="w-20 shrink-0 text-xs text-muted">{c.group}</span>
            <span className="flex-1">
              {c.label}
              {c.hint && <span className="text-muted"> · {c.hint}</span>}
            </span>
            {c.caps && <Caps caps={c.caps} />}
          </button>
        ))}
        {!list.length && <div className="px-3 py-8 text-center text-muted">Nothing found.</div>}
      </div>
    </Modal>
  );
}

const GLOBAL_HELP: [string[], string][] = [
  [["G"], "Go to a screen (then the screen's key)"],
  [["Ctrl", "K"], "Command palette"],
  [["?"], "This help"],
  [["M"], "Sounds on or off"],
  [["Alt", "Enter"], "Full screen"],
  [["Esc"], "Close, or leave a text field"],
];

const allCaps = (k: Hotkey) => {
  if (k.show) return [k.show];
  const seen = new Set<string>();
  return k.keys.map(keyCaps).filter((c) => {
    const s = c.join("+");
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
};

/** "?": the keys of the current screen, the global keys, and what the screen is for. */
export function HelpOverlay({
  route,
  routes,
  onClose,
}: {
  route: RouteInfo;
  routes: RouteInfo[];
  onClose: () => void;
}) {
  const layers = useLayers();
  const page = layers
    .filter((l) => l.order === 1)
    .flatMap((l) => l.keys)
    .filter((k) => k.when !== false && k.run && k.keys.length);
  useHotkeys("help", [{ keys: ["Escape", "Shift+Slash"], label: "Close", run: onClose }], { modal: true, order: 10 });
  return (
    <Modal onClose={onClose} wide>
      <div className="grid gap-6 p-6 md:grid-cols-[1fr_1fr]">
        <section>
          <div className="mb-1 flex items-center gap-2">
            <span className="cjk text-2xl text-accent">{routeIcon(route, 36)}</span>
            <h2 className="text-lg font-semibold">{route.label}</h2>
          </div>
          <BoboPose pose={poseFor(route)} className="float-right ml-3 w-24 md:w-28" />
          <p className="mb-4 text-sm leading-relaxed text-muted">{route.about}</p>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Keys on this screen</h3>
          {page.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {page.map((k, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex w-36 shrink-0 flex-wrap items-center gap-1">
                    {allCaps(k).map((c, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <span className="text-xs text-muted">or</span>}
                        <Caps caps={c} />
                      </span>
                    ))}
                  </span>
                  {k.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No special keys here.</p>
          )}
        </section>
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Everywhere</h3>
          <ul className="mb-5 flex flex-col gap-1.5 text-sm">
            {GLOBAL_HELP.map(([c, l]) => (
              <li key={l} className="flex items-center gap-3">
                <Caps caps={c} className="w-24 shrink-0" />
                {l}
              </li>
            ))}
          </ul>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">G, then</h3>
          <ul className="grid grid-cols-2 gap-1.5 text-sm">
            {routes.map((r) => (
              <li key={r.href} className="flex items-center gap-2">
                <Kbd className="w-7">{keyCaps(r.key)}</Kbd>
                {r.label}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-muted">
            Keys follow the position on the keyboard, so they work the same on QWERTY and AZERTY. Answer keys are 1 to
            4, or A S D F on the home row.
          </p>
        </section>
      </div>
    </Modal>
  );
}
