"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { AUTOPLAY_INTERVAL_MS, isAutoplayActive } from "./carousel-autoplay";
import styles from "./storefront.module.css";

export interface PromoSlide {
  href: string;
  src: string;
  title: string;
  text: string;
  cta: string;
}

function ChevronLeftIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 5 8 12 15 19" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 5 16 12 9 19" />
    </svg>
  );
}

/**
 * Hero banner carousel directly under the header. Scroll-snap drives the
 * actual navigation (native swipe on touch, `scrollIntoView` for every
 * other trigger) so slide content is reachable with zero JS; everything
 * else — the dot rail, the prev/next controls, the autoplay timer and the
 * live-region announcement — is a progressive enhancement layered on top,
 * synced from the currently-most-visible slide via `IntersectionObserver`.
 *
 * Autoplay rules (see `carousel-autoplay.ts` for the pure decision logic
 * and its unit tests): advances every `AUTOPLAY_INTERVAL_MS`, paused while
 * the pointer is over the banner, while focus is within it, or while the
 * tab is hidden; stopped for good the first time the visitor uses a
 * control; and never started at all under `prefers-reduced-motion`.
 */
export function PromoCarousel({ slides }: { slides: PromoSlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setTabHidden(document.hidden);
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const slideElements = Array.from(track.children) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (mostVisible) setActive(slideElements.indexOf(mostVisible.target as HTMLElement));
      },
      { root: track, threshold: 0.6 },
    );
    slideElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [slides.length]);

  const autoplayActive = isAutoplayActive({
    focusWithin,
    hovered,
    interacted,
    reducedMotion,
    slideCount: slides.length,
    tabHidden,
  });

  useEffect(() => {
    if (!autoplayActive) return;
    const timer = window.setInterval(() => {
      goTo((active + 1) % slides.length);
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // goTo and reducedMotion are read from the latest render's closure, not
    // captured as dependencies — including them would just restart the same
    // timer on every render for no behavioural difference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayActive, active, slides.length]);

  function goTo(index: number): void {
    const track = trackRef.current;
    const target = track?.children[index] as HTMLElement | undefined;
    if (!track || !target) return;
    // Scroll the track itself rather than calling scrollIntoView on the slide.
    // Even with block: "nearest", scrollIntoView walks up to the page and
    // scrolls it vertically whenever the carousel is off screen — so a visitor
    // reading further down the page was yanked back up every six seconds when
    // autoplay advanced. Setting scrollLeft only ever moves the track.
    track.scrollTo({
      behavior: reducedMotion ? "auto" : "smooth",
      left: target.offsetLeft - track.offsetLeft,
    });
  }

  function registerInteraction(): void {
    setInteracted(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      registerInteraction();
      goTo((active - 1 + slides.length) % slides.length);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      registerInteraction();
      goTo((active + 1) % slides.length);
    }
  }

  const firstSlide = slides[0];
  if (!firstSlide) return null;
  const current = slides[active] ?? firstSlide;

  return (
    <section
      aria-label="Информация и акции магазина"
      aria-roledescription="карусель"
      className={styles.promo}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onFocus={() => setFocusWithin(true)}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.promoViewport}>
        <div
          className={styles.promoTrack}
          onPointerDown={(event) => { if (event.pointerType === "touch") registerInteraction(); }}
          ref={trackRef}
        >
          {slides.map((slide, index) => (
            <Link className={styles.promoSlide} href={slide.href} key={slide.src}>
              <Image
                alt=""
                fill
                priority={index === 0}
                sizes="(max-width: 767px) 100vw, 1180px"
                src={slide.src}
              />
              <span className={styles.promoSlideScrim} aria-hidden="true" />
              <span className={styles.promoSlideBody}>
                <h2>{slide.title}</h2>
                <p>{slide.text}</p>
                <span className={styles.promoSlideCta}>{slide.cta}</span>
              </span>
            </Link>
          ))}
        </div>
        {slides.length > 1 ? (
          <>
            <button
              aria-label="Предыдущий слайд"
              className={`${styles.promoControl} ${styles.promoControlPrev}`}
              onClick={() => { registerInteraction(); goTo((active - 1 + slides.length) % slides.length); }}
              type="button"
            >
              <ChevronLeftIcon />
            </button>
            <button
              aria-label="Следующий слайд"
              className={`${styles.promoControl} ${styles.promoControlNext}`}
              onClick={() => { registerInteraction(); goTo((active + 1) % slides.length); }}
              type="button"
            >
              <ChevronRightIcon />
            </button>
          </>
        ) : null}
      </div>
      {slides.length > 1 ? (
        <div className={styles.promoDots} aria-label="Слайды">
          {slides.map((slide, index) => (
            <button
              aria-current={index === active}
              aria-label={`Слайд ${index + 1} из ${slides.length}: ${slide.title}`}
              className={styles.promoDot}
              data-active={index === active}
              key={slide.src}
              onClick={() => { registerInteraction(); goTo(index); }}
              type="button"
            />
          ))}
        </div>
      ) : null}
      <p className={styles.visuallyHidden} aria-live="polite" role="status">
        {`Слайд ${active + 1} из ${slides.length}: ${current.title}`}
      </p>
    </section>
  );
}
