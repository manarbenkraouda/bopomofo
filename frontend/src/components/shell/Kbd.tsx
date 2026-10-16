export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <kbd className={"kbd " + className}>{children}</kbd>;
}

/** Key caps in a row. A "/" cap shows as a plain separator ("1-4 / A S D F"). */
export function Caps({ caps, className = "" }: { caps: string[]; className?: string }) {
  return (
    <span className={"inline-flex items-center gap-0.5 " + className}>
      {caps.map((c, i) =>
        c === "/" ? (
          <span key={i} className="px-0.5 text-muted">
            /
          </span>
        ) : (
          <Kbd key={i}>{c}</Kbd>
        ),
      )}
    </span>
  );
}
