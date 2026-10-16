"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, type RefObject } from "react";

/**
 * All scroll motion of the landing page. Each part returns its own cleanup, so a visit to another page
 * removes every observer, listener, and pinned section.
 */
export function useLandingMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.registerPlugin(ScrollTrigger);
    const stops = [reveals(el), headerInk(el), headerAway(el), fitGiant(el), autoplay(el, reduce)];
    const ctx = gsap.context(() => {
      stops.push(scrub(el, reduce));
      if (!reduce) stops.push(scenes(el));
    }, el);
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    document.fonts?.ready.then(refresh);
    return () => {
      window.removeEventListener("load", refresh);
      stops.forEach((stop) => stop());
      ctx.revert();
    };
  }, [root]);
}

// Reveal once when an element enters the viewport. A shutter starts fully clipped, and Chrome reports
// a fully clipped box as never visible, so the parent of a shutter is watched in its place.
function reveals(el: HTMLElement) {
  const targets = [...el.querySelectorAll<HTMLElement>("[data-reveal]")];
  const owners = new Map<Element, HTMLElement[]>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (owners.get(e.target) ?? [e.target as HTMLElement]).forEach((t) => t.classList.add("is-in"));
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
  );
  for (const t of targets) {
    const watch = t.classList.contains("shutter") && t.parentElement ? t.parentElement : t;
    if (watch !== t) {
      const own = owners.get(watch) ?? (watch.hasAttribute("data-reveal") ? [watch as HTMLElement] : []);
      owners.set(watch, [...own, t]);
    }
    io.observe(watch);
  }
  // If an observer event is lost (a fast jump to an anchor), show what is on screen after a moment.
  const late = setTimeout(() => {
    for (const t of targets) {
      const r = t.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) t.classList.add("is-in");
    }
  }, 2500);
  return () => {
    io.disconnect();
    clearTimeout(late);
  };
}

// The fixed header takes the ink of the chapter under it.
function headerInk(el: HTMLElement) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          const { ink, btn } = (e.target as HTMLElement).dataset;
          el.style.setProperty("--header-ink", ink ?? "#f2ece2");
          if (btn) {
            el.style.setProperty("--header-btn", btn);
            el.style.setProperty("--header-btn-ink", "#f2ece2");
          } else {
            el.style.removeProperty("--header-btn");
            el.style.removeProperty("--header-btn-ink");
          }
        }
    },
    { rootMargin: "0px 0px -92% 0px", threshold: 0 },
  );
  el.querySelectorAll("[data-ink]").forEach((c) => io.observe(c));
  return () => io.disconnect();
}

// The header leaves while you read down and comes back when you scroll up,
// so the corner items never sit on top of the big chapter titles.
function headerAway(el: HTMLElement) {
  const top = el.querySelector<HTMLElement>(".top");
  if (!top) return () => {};
  let last = scrollY;
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      const y = scrollY;
      const dy = y - last;
      if (y < innerHeight * 0.6 || dy < -6) top.classList.remove("is-away");
      else if (dy > 6) top.classList.add("is-away");
      last = y;
      frame = 0;
    });
  };
  const back = () => top.classList.remove("is-away");
  addEventListener("scroll", onScroll, { passive: true });
  top.addEventListener("focusin", back);
  return () => {
    removeEventListener("scroll", onScroll);
    top.removeEventListener("focusin", back);
    cancelAnimationFrame(frame);
  };
}

// The footer word is sized to the width of its box: a fixed vw size cuts the last letter on narrow screens.
function fitGiant(el: HTMLElement) {
  const box = el.querySelector<HTMLElement>(".giant");
  const word = box?.querySelector<HTMLElement>("span");
  if (!box || !word) return () => {};
  const fit = () => {
    word.style.fontSize = "100px";
    const size = (100 * box.clientWidth) / word.getBoundingClientRect().width;
    word.style.fontSize = size.toFixed(2) + "px";
    box.style.height = (size * 0.76).toFixed(0) + "px";
  };
  fit();
  addEventListener("resize", fit);
  document.fonts?.ready.then(fit);
  return () => removeEventListener("resize", fit);
}

// Muted screen recordings play only while on screen. With reduced motion they get controls and wait for a click.
function autoplay(el: HTMLElement, reduce: boolean) {
  const vids = [...el.querySelectorAll<HTMLVideoElement>("video[data-autoplay]")];
  if (reduce) {
    vids.forEach((v) => (v.controls = true));
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) {
          v.preload = "auto";
          v.play().catch(() => {});
        } else v.pause();
      }
    },
    { threshold: 0.25 },
  );
  vids.forEach((v) => io.observe(v));
  return () => io.disconnect();
}

// The Dictation recording: the scroll position sets the video time and the active line of the beat list.
// On a wide screen the chapter is pinned while the video plays.
function scrub(el: HTMLElement, reduce: boolean) {
  const sec = el.querySelector<HTMLElement>(".write");
  const video = sec?.querySelector<HTMLVideoElement>("video.scrub");
  if (!sec || !video) return () => {};
  const bar = sec.querySelector<HTMLElement>(".scrubbar");
  const beats = [...sec.querySelectorAll<HTMLElement>(".beats li")];
  const mark = (t: number, p: number) => {
    let on = 0;
    beats.forEach((b, k) => {
      if (t >= parseFloat(b.dataset.at ?? "0")) on = k;
    });
    beats.forEach((b, k) => b.classList.toggle("is-on", k === on));
    bar?.style.setProperty("--p", p.toFixed(4));
  };
  mark(0, 0);
  if (reduce) {
    video.controls = true;
    const onTime = () => mark(video.currentTime, video.currentTime / (video.duration || 13));
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }
  video.loop = false;
  video.pause();
  let want = 0;
  let seeking = false;
  const seek = () => {
    const d = video.duration;
    if (!d || seeking) return;
    const t = Math.min(d - 0.05, want * d);
    if (Math.abs(video.currentTime - t) < 0.02) return;
    seeking = true;
    video.currentTime = t;
  };
  const seeked = () => {
    seeking = false;
    seek();
  };
  video.addEventListener("seeked", seeked);
  video.addEventListener("loadedmetadata", seek);
  const update = (self: ScrollTrigger) => {
    want = self.progress;
    mark(want * (video.duration || 13), want);
    seek();
  };
  const mm = gsap.matchMedia();
  mm.add("(min-width: 64.01em)", () => {
    ScrollTrigger.create({ trigger: sec, start: "top top", end: "+=170%", pin: true, onUpdate: update });
  });
  mm.add("(max-width: 64em)", () => {
    ScrollTrigger.create({
      trigger: sec.querySelector("figure"),
      start: "top 80%",
      end: "bottom 20%",
      onUpdate: update,
    });
  });
  return () => {
    mm.revert();
    video.removeEventListener("seeked", seeked);
    video.removeEventListener("loadedmetadata", seek);
  };
}

// Parallax and entrances. Selectors are scoped to the landing root by gsap.context.
function scenes(el: HTMLElement) {
  const along = (trigger: string, start = "top top", end = "bottom top") => ({ trigger, start, end, scrub: true });
  gsap.to(".hero .l1", { yPercent: -28, ease: "none", scrollTrigger: along(".hero") });
  gsap.to(".hero .l2", { yPercent: -10, ease: "none", scrollTrigger: along(".hero") });
  gsap.to(".hero-bear", { yPercent: 8, ease: "none", scrollTrigger: along(".hero") });

  // Levels grow from the floor, then Bobo jumps on the last one.
  gsap
    .timeline({ scrollTrigger: { trigger: ".steps", start: "top 85%" } })
    .from(".steps li", { scaleY: 0, duration: 1, stagger: 0.09, ease: "power3.out" })
    .from(".steps li > *", { opacity: 0, y: 14, duration: 0.5, stagger: 0.03, ease: "power2.out" }, "-=0.6")
    .from(".steps .bear", { y: 60, opacity: 0, rotate: -8, duration: 0.7, ease: "back.out(2)" }, "-=0.4");

  // "How do we know?" slides: a pinned sideways reel. The run is shorter than the distance,
  // so the heading never stays on screen for more than two screens.
  const story = el.querySelector<HTMLElement>(".story");
  const reel = story?.querySelector<HTMLElement>(".reel");
  if (story && reel) {
    story.classList.add("is-pinned");
    const dist = () => Math.max(0, reel.scrollWidth - innerWidth);
    gsap.to(reel, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: story,
        start: "top top",
        end: () => "+=" + Math.round(dist() * 0.45),
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });
    gsap.from(reel.querySelectorAll("li"), {
      rotate: (k: number) => (k % 2 ? 3 : -3),
      y: 40,
      duration: 1,
      stagger: 0.05,
      ease: "power3.out",
      scrollTrigger: { trigger: story, start: "top 75%" },
    });
  }

  gsap.fromTo(
    ".blossom img",
    { rotate: -10, scale: 1.08 },
    { rotate: 6, scale: 1, ease: "none", scrollTrigger: along(".about", "top bottom") },
  );
  gsap.fromTo(
    ".faq-head .scooter",
    { x: "70vw" },
    {
      x: 0,
      ease: "power2.out",
      scrollTrigger: { trigger: ".faq-head", start: "top bottom", end: "bottom 70%", scrub: 0.8 },
    },
  );
  gsap.from(".giant span", {
    yPercent: 55,
    ease: "none",
    scrollTrigger: along(".foot", "top bottom", "bottom bottom"),
  });
  gsap.from(".coach-bear", {
    rotate: -12,
    y: 30,
    ease: "none",
    scrollTrigger: along(".coach", "top bottom", "center center"),
  });
  gsap.utils.toArray<HTMLElement>(".row .side img, .row .side .photo").forEach((t) => {
    gsap.fromTo(
      t,
      { y: 40 },
      { y: -40, ease: "none", scrollTrigger: { trigger: t, start: "top bottom", end: "bottom top", scrub: true } },
    );
  });
  return () => story?.classList.remove("is-pinned");
}
