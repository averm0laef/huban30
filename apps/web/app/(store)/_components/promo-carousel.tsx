"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import styles from "./storefront.module.css";

export interface PromoSlide {
  href: string;
  src: string;
  title: string;
  text: string;
  cta: string;
}

/**
 * Promo banner carousel directly under the header. Scroll-snap drives the
 * actual navigation (native swipe on touch, arrow-key/Tab scrolling with a
 * keyboard) so it works with zero JS; the dot rail is a progressive
 * enhancement synced via IntersectionObserver. No autoplay — auto-advancing
 * content needs a pause control under WCAG 2.2.2, and it fights
 * prefers-reduced-motion, so the simplest correct choice is not to.
 */
export function PromoCarousel({ slides }: { slides: PromoSlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

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

  function goTo(index: number): void {
    const track = trackRef.current;
    const target = track?.children[index] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  if (slides.length === 0) return null;

  return (
    <section className={styles.promo} aria-label="Информация и акции магазина" aria-roledescription="карусель">
      <div className={styles.promoTrack} ref={trackRef}>
        {slides.map((slide, index) => (
          <Link className={styles.promoSlide} href={slide.href} key={slide.href}>
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
        <div className={styles.promoDots} role="tablist" aria-label="Слайды">
          {slides.map((slide, index) => (
            <button
              aria-current={index === active}
              aria-label={`Слайд ${index + 1} из ${slides.length}: ${slide.title}`}
              className={styles.promoDot}
              data-active={index === active}
              key={slide.href}
              onClick={() => goTo(index)}
              role="tab"
              type="button"
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
