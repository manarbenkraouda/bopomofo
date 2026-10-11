"use client";
// Phone keyboards and the fixed-height app shell.
// iOS does not shrink the page when its keyboard opens: it scrolls the whole page up instead, so the top bar slides away and
// the screen jumps. While mounted, this hook sizes the shell to the visible area above the keyboard and keeps the page at the top.
// Android Chrome resizes the page by itself (viewport interactive-widget=resizes-content in app/layout.tsx), so there it does nothing.
import { useEffect } from "react";

export function useShellAboveKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    const shell = document.querySelector<HTMLElement>(".shell");
    if (!vv || !shell) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (vv.scale > 1.01) return; // pinch zoom: the learner moves the view, leave it alone
        const covered = window.innerHeight - vv.height > 80; // a keyboard takes the bottom of the screen
        shell.style.height = covered ? Math.round(vv.height) + "px" : "";
        if (window.scrollY) window.scrollTo(0, 0);
        const a = document.activeElement;
        if (covered && a instanceof HTMLElement) a.scrollIntoView({ block: "nearest" });
      });
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    fit();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      shell.style.height = "";
    };
  }, []);
}

