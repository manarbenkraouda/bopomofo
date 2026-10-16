"use client";

import { Kbd } from "@/components/shell/Kbd";

/** A question: the app's icon tile speaks it in a bubble, the answers come below. */
export function Screen({
  icon,
  title,
  sub,
  children,
}: {
  icon: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="cjk grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent text-2xl text-white shadow-lg md:h-14 md:w-14 md:text-3xl">
          {icon}
        </span>
        <div className="card relative min-w-0 flex-1 px-4 py-3">
          <span
            aria-hidden
            className="absolute -left-[7px] top-4 h-3 w-3 rotate-45 border-b border-l border-line bg-card"
          />
          <h1 className="text-lg font-semibold leading-snug md:text-xl">{title}</h1>
          <p className="mt-0.5 text-sm text-muted">{sub}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

export function Option({
  n,
  selected,
  onClick,
  icon,
  label,
  sub,
  multi,
}: {
  n: number;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  multi?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={
        "tile flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition md:p-3.5 " +
        (selected
          ? "border-accent bg-accent-soft/40"
          : "border-line bg-card hover:-translate-y-0.5 hover:border-accent/60")
      }
    >
      <span
        className={
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors " +
          (selected ? "bg-accent text-white" : "bg-accent-soft text-accent")
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{label}</span>
        {sub && <span className="block text-sm text-muted">{sub}</span>}
      </span>
      <Kbd className="max-md:!hidden">{n}</Kbd>
      <Check on={selected} square={multi} />
    </button>
  );
}

export function Check({ on, square }: { on: boolean; square?: boolean }) {
  return (
    <span
      className={
        (square ? "rounded-md" : "rounded-full") +
        " grid h-6 w-6 shrink-0 place-items-center border-2 text-xs font-bold transition-colors " +
        (on ? "zq-pop border-accent bg-accent text-white" : "border-line")
      }
    >
      {on ? "✓" : ""}
    </span>
  );
}

export function Bars({ n, on }: { n: number; on: boolean }) {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className="w-[5px] rounded-sm"
          style={{
            height: 5 + b * 4,
            background: b <= n ? (on ? "#fff" : "var(--accent)") : on ? "rgba(255,255,255,.35)" : "var(--line)",
          }}
        />
      ))}
    </span>
  );
}
