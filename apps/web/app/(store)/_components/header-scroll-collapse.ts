/**
 * Pure collapse-decision logic for the mobile header's scroll-collapse rows
 * (see `store-shell.tsx`), kept free of DOM/event concerns so the threshold
 * and safety rules can be unit-tested without mounting a component.
 *
 * The mobile header stacks five rows in one blue panel (links, brand,
 * location, search, the expert CTA) — tall enough that the owner asked for
 * it to get out of the way once a visitor starts reading the page. Doing
 * that with pure CSS `position: sticky` would need the search row to be the
 * *last* row in the stack for every row above and below it to hide behind
 * a single sticky offset — but the search row sits in the middle (row 4 of
 * 5) by the owner's own reference layout, and reordering it purely for the
 * scrolled state would desync visual order from DOM/reading order, which
 * is its own WCAG 2.4.3 problem. So this is the one place in the header
 * that genuinely needs a scroll listener instead.
 *
 * `isHeaderCollapsed` is a plain AND of every condition that must hold
 * before the non-search rows are allowed to hide:
 *  - scrolled past `HEADER_COLLAPSE_SCROLL_THRESHOLD_PX` (a small cushion
 *    so an overscroll bounce at the very top doesn't flicker the header);
 *  - `prefers-reduced-motion` is off — collapsing means real content
 *    moves, not just a transition easing, so (like the carousel's
 *    autoplay) reduced-motion visitors get the full static header instead
 *    of a softer animation;
 *  - focus is not inside the header — a visitor tabbing into "О компании"
 *    or the expert CTA while scrolled must never have the very control
 *    they are on hide out from under them, which both breaks keyboard use
 *    and reads as a focus trap.
 */

export const HEADER_COLLAPSE_SCROLL_THRESHOLD_PX = 24;

export interface HeaderCollapseFlags {
  /** `window.scrollY` at the moment of the check. */
  scrollY: number;
  /** Focus is currently inside the header panel (any row). */
  focusWithin: boolean;
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches`. */
  reducedMotion: boolean;
}

export function isHeaderCollapsed(flags: HeaderCollapseFlags): boolean {
  if (flags.reducedMotion) return false;
  if (flags.focusWithin) return false;
  return flags.scrollY >= HEADER_COLLAPSE_SCROLL_THRESHOLD_PX;
}
