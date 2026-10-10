"use client";
import { useEffect, useRef } from "react";

export type Tone = "ok" | "close" | "bad" | null;

/**
 * The main buttons of a practice screen. Desktop: an inline row of buttons.
 * Phone: a bar fixed at the bottom of the screen that shows the result in green, yellow, or red, with a title and a detail line.
 * Give the main button the class "ab-primary": on a phone it gets its own full-width row.
 */
export function ActionBar({ tone = null, title, detail, children, mobileOnly }: {
  tone?: Tone; title?: React.ReactNode; detail?: React.ReactNode; children: React.ReactNode; mobileOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone the bar is fixed: the shell keeps its height free at the end of the page (CSS variable --ab-space).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const measure = () => root.setProperty("--ab-space", (window.matchMedia("(max-width: 767px)").matches ? el.offsetHeight : 0) + "px");
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); root.setProperty("--ab-space", "0px"); };
  }, []);
  return (
    <div ref={ref} data-tone={tone ?? undefined} className={"action-bar w-full " + (mobileOnly ? "md:hidden" : "")}>
      {(title || detail) && (
        <div key={String(tone)} className="ab-feedback md:hidden">
          {title && <div className="ab-title">{title}</div>}
          {detail && <div className="ab-detail cjk">{detail}</div>}
        </div>
      )}
      <div className="ab-buttons">{children}</div>
    </div>
  );
}
