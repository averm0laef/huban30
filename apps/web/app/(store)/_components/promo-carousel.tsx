"use client";

import { ChevronLeft24Regular, ChevronRight24Regular, Pause20Regular, Play20Regular } from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { AUTOPLAY_INTERVAL_MS, isAutoplayActive } from "./carousel-autoplay";
import motion from "./promo-carousel.module.css";
import styles from "./storefront.module.css";

export interface PromoSlide {
  href: string;
  src: string;
  title: string;
  text: string;
  cta: string;
}

/** Native scroll-snap keeps touch navigation working without animation code. */
export function PromoCarousel({ slides }: { slides: PromoSlide[] }) {
  const regionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  const navigationIndexRef = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const [interacted, setInteracted] = useState(false);
  // Start conservatively until the browser's preference is known.
  const [reducedMotion, setReducedMotion] = useState(true);

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
    const region = regionRef.current;
    if (!region) return;
    const observer = new IntersectionObserver(([entry]) => {
      setInViewport(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.35));
    }, { threshold: [0, 0.35] });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  const goTo = useCallback((index: number, focusSlide = false) => {
    const track = trackRef.current;
    const target = track?.children[index] as HTMLElement | undefined;
    const first = track?.firstElementChild as HTMLElement | null;
    if (!track || !target || !first) return;
    navigationIndexRef.current = index;
    // Focus must not scroll any ancestor. Only the horizontal track moves.
    if (focusSlide) target.focus({ preventScroll: true });
    track.scrollTo({
      behavior: reducedMotion ? "instant" : "smooth",
      left: target.offsetLeft - first.offsetLeft,
    });
  }, [reducedMotion]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const elements = Array.from(track.children) as HTMLElement[];
    let frame = 0;
    let settleTimer = 0;
    let previousWidth = track.clientWidth;

    const syncActive = () => {
      frame = 0;
      const first = elements[0];
      if (!first) return;
      let closest = 0;
      let distance = Infinity;
      elements.forEach((element, index) => {
        const nextDistance = Math.abs(element.offsetLeft - first.offsetLeft - track.scrollLeft);
        if (nextDistance < distance) {
          closest = index;
          distance = nextDistance;
        }
      });
      activeRef.current = closest;
      setActive(closest);
    };
    const onScrollEnd = () => {
      window.clearTimeout(settleTimer);
      navigationIndexRef.current = null;
      syncActive();
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(syncActive);
      // A fallback for browsers without scrollend support.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(onScrollEnd, 160);
    };
    const resizeObserver = new ResizeObserver(() => {
      if (track.clientWidth === previousWidth) return;
      previousWidth = track.clientWidth;
      const index = Math.min(navigationIndexRef.current ?? activeRef.current, elements.length - 1);
      const target = elements[index];
      const first = elements[0];
      if (!target || !first) return;
      track.scrollTo({ left: target.offsetLeft - first.offsetLeft, behavior: "instant" });
      navigationIndexRef.current = null;
      syncActive();
    });
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("scrollend", onScrollEnd);
    resizeObserver.observe(track);
    syncActive();
    return () => {
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("scrollend", onScrollEnd);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [slides.length]);

  const autoplayActive = isAutoplayActive({
    focusWithin,
    hovered,
    inViewport,
    interacted,
    reducedMotion,
    slideCount: slides.length,
    tabHidden,
  });

  useEffect(() => {
    if (!autoplayActive) return;
    const timer = window.setTimeout(() => {
      goTo((active + 1) % slides.length);
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [autoplayActive, active, slides.length, goTo]);

  function registerInteraction(): void {
    setInteracted(true);
  }

  function goRelative(direction: number, focusSlide = false): void {
    const current = navigationIndexRef.current ?? activeRef.current;
    goTo((current + direction + slides.length) % slides.length, focusSlide);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || slides.length < 2) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    registerInteraction();
    const focusSlide = Boolean(trackRef.current?.contains(event.target as Node));
    if (event.key === "Home") goTo(0, focusSlide);
    else if (event.key === "End") goTo(slides.length - 1, focusSlide);
    else goRelative(event.key === "ArrowLeft" ? -1 : 1, focusSlide);
  }

  const firstSlide = slides[0];
  if (!firstSlide) return null;
  const current = slides[active] ?? firstSlide;
  const playbackEnabled = !interacted && !reducedMotion;
  const playbackLabel = reducedMotion
    ? "Автопрокрутка отключена в настройках уменьшения движения"
    : playbackEnabled ? "Остановить автопрокрутку" : "Включить автопрокрутку";

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
      ref={regionRef}
    >
      <div className={styles.promoViewport}>
        <div
          className={styles.promoTrack}
          onPointerDown={() => {
            registerInteraction();
            navigationIndexRef.current = null;
          }}
          onWheel={(event) => {
            if (event.deltaX !== 0 || event.shiftKey) {
              registerInteraction();
              navigationIndexRef.current = null;
            }
          }}
          ref={trackRef}
        >
          {slides.map((slide, index) => (
            <Link
              className={`${styles.promoSlide} ${motion.slide}`}
              data-active={index === active}
              href={slide.href}
              key={slide.src}
              tabIndex={index === active ? 0 : -1}
            >
              <Image
                alt=""
                fill
                priority={index === 0}
                sizes="(max-width: 767px) 100vw, 1180px"
                src={slide.src}
              />
              <span className={styles.promoSlideScrim} aria-hidden="true" />
              <span className={`${styles.promoSlideBody} ${motion.body}`}>
                <h2>{slide.title}</h2>
                <p>{slide.text}</p>
                <span className={styles.promoSlideCta}>
                  {slide.cta}
                </span>
              </span>
            </Link>
          ))}
        </div>
        {slides.length > 1 ? (
          <>
            <button
              aria-label="Предыдущий слайд"
              className={`${styles.promoControl} ${styles.promoControlPrev}`}
              onClick={() => { registerInteraction(); goRelative(-1); }}
              type="button"
            >
              <ChevronLeft24Regular aria-hidden="true" />
            </button>
            <button
              aria-label="Следующий слайд"
              className={`${styles.promoControl} ${styles.promoControlNext}`}
              onClick={() => { registerInteraction(); goRelative(1); }}
              type="button"
            >
              <ChevronRight24Regular aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      {slides.length > 1 ? (
        <div className={motion.navigation}>
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
          <button
            aria-label={playbackLabel}
            className={motion.playback}
            disabled={reducedMotion}
            onClick={() => setInteracted((stopped) => !stopped)}
            title={playbackLabel}
            type="button"
          >
            {playbackEnabled ? <Pause20Regular aria-hidden="true" /> : <Play20Regular aria-hidden="true" />}
          </button>
        </div>
      ) : null}
      <p className={styles.visuallyHidden} aria-live={autoplayActive ? "off" : "polite"} aria-atomic="true" role="status">
        {`Слайд ${active + 1} из ${slides.length}: ${current.title}`}
      </p>
    </section>
  );
}
