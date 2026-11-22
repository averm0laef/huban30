"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Progressive enhancement: server-rendered content is always visible.
 * Only below-the-fold sections are prepared for a one-time entrance. */
export function HomeMotion({ children, className }: { children: ReactNode; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;

    const show = (element: HTMLElement) => {
      element.dataset.revealState = "visible";
      observer?.unobserve(element);
    };
    const revealAll = () => {
      observer?.disconnect();
      sections.forEach(show);
    };

    if (!preference.matches) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) show(entry.target as HTMLElement);
        }
      }, { threshold: 0, rootMargin: "0px 0px -24px 0px" });

      for (const section of sections) {
        if (section.getBoundingClientRect().top >= window.innerHeight) {
          section.dataset.revealState = "pending";
          observer.observe(section);
        }
      }
    }

    const onPreferenceChange = () => { if (preference.matches) revealAll(); };
    const onFocus = (event: FocusEvent) => {
      const section = (event.target as HTMLElement).closest<HTMLElement>("[data-reveal]");
      if (section) show(section);
    };
    preference.addEventListener("change", onPreferenceChange);
    root.addEventListener("focusin", onFocus);
    return () => {
      revealAll();
      preference.removeEventListener("change", onPreferenceChange);
      root.removeEventListener("focusin", onFocus);
    };
  }, []);

  return <div className={className} ref={rootRef}>{children}</div>;
}
