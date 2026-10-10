"use client";
import { useEffect, useState } from "react";

/** The window size. Before the first measure (server render), a desktop size. */
export function useViewport() {
  const [v, setV] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const fit = () => setV({ w: window.innerWidth, h: window.innerHeight });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return v;
}

/** Phone layout: the same breakpoint as Tailwind "md". */
export const PHONE = 768;

/** A pixel size that follows the window (for writing pads): a share of its height and of its width, between min and max. */
export function useFit(min: number, max: number, vh: number, vw = 1) {
  const { w, h } = useViewport();
  return Math.round(Math.max(min, Math.min(max, h * vh, w * vw)));
}
