/**
 * Pure autoplay-decision logic for the home page hero carousel
 * (`promo-carousel.tsx`), kept free of DOM/timer/React concerns so the
 * pause/stop rules can be unit-tested without rendering the component.
 *
 * The carousel advances by itself roughly every `AUTOPLAY_INTERVAL_MS`,
 * but only while `isAutoplayActive` says so. That function is a plain AND
 * of every "don't run right now" condition:
 *  - fewer than two slides: nothing to advance to.
 *  - `prefers-reduced-motion`: autoplay must never run at all, regardless
 *    of any other flag — this is checked first and wins outright.
 *  - the visitor has used a control or stopped playback: autoplay stays
 *    stopped until they explicitly press the play button.
 *  - the pointer is over the carousel, focus is within it, or the browser
 *    tab is hidden, or the banner is offscreen: autoplay *pauses* — these flags clear
 *    on their own (mouseleave, blur, tab becomes visible again), at which
 *    point autoplay resumes as long as nothing else above says no.
 */

export const AUTOPLAY_INTERVAL_MS = 6000;

export interface AutoplayFlags {
  /** Total number of slides in the carousel. */
  slideCount: number;
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches`. */
  reducedMotion: boolean;
  /** The pointer is currently over the carousel. */
  hovered: boolean;
  /** Focus is currently inside the carousel (a slide link, a dot, a prev/next button). */
  focusWithin: boolean;
  /** `document.hidden` — the browser tab is not the active one. */
  tabHidden: boolean;
  /** Enough of the banner is visible to read the current slide. */
  inViewport: boolean;
  /** The visitor stopped playback or used a control; only explicit play clears this. */
  interacted: boolean;
}

export function isAutoplayActive(flags: AutoplayFlags): boolean {
  if (flags.slideCount <= 1) return false;
  if (flags.reducedMotion) return false;
  if (flags.interacted) return false;
  if (flags.hovered || flags.focusWithin || flags.tabHidden || !flags.inViewport) return false;
  return true;
}
