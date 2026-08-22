/**
 * Direction-aware state machine for the sticky storefront header.
 *
 * The VIN/article search stays pinned at every viewport width. The rest of
 * the header hides only after a deliberate downward scroll and returns after
 * a shorter upward scroll. Separate hide/reveal distances provide hysteresis:
 * trackpad noise around a direction change cannot repeatedly flip the header.
 *
 * DOM events deliberately live in `store-shell.tsx`; keeping this reducer
 * pure makes the same behaviour testable for both the mobile and desktop CSS
 * layouts without mounting a browser.
 */

/** Keep the full header visible while the page is still close to the top. */
export const HEADER_COLLAPSE_START_PX = 160;

/** Downward travel required before the non-search header content hides. */
export const HEADER_HIDE_SCROLL_DELTA_PX = 32;

/** Upward travel required before the full header returns. */
export const HEADER_REVEAL_SCROLL_DELTA_PX = 12;

export interface HeaderCollapseState {
  /** Whether all header content except the VIN/article search is hidden. */
  collapsed: boolean;
  /** Direction anchor: a local minimum while open, a local maximum while hidden. */
  anchorScrollY: number;
}

export interface HeaderScrollSample {
  /** Current `window.scrollY`. Negative Safari overscroll is normalised to 0. */
  scrollY: number;
  /** Focus is inside content that would be hidden (not the pinned search). */
  focusWithinCollapsibleContent: boolean;
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches`. */
  reducedMotion: boolean;
}

function normaliseScrollY(scrollY: number): number {
  return Math.max(0, Number.isFinite(scrollY) ? scrollY : 0);
}

/**
 * Creates an expanded initial state at the actual restored scroll position.
 * This prevents a back/forward restoration deep in the page from rendering a
 * collapsed header before the visitor has made a new scroll gesture.
 */
export function createHeaderCollapseState(scrollY = 0): HeaderCollapseState {
  return { anchorScrollY: normaliseScrollY(scrollY), collapsed: false };
}

export function getNextHeaderCollapseState(
  state: HeaderCollapseState,
  sample: HeaderScrollSample,
): HeaderCollapseState {
  const scrollY = normaliseScrollY(sample.scrollY);

  // Reduced-motion users keep a stable header. Likewise, a focused control
  // must never move or disappear beneath the keyboard user. Resetting the
  // anchor prevents an immediate re-collapse as soon as either guard clears.
  if (
    sample.reducedMotion
    || sample.focusWithinCollapsibleContent
    || scrollY <= HEADER_COLLAPSE_START_PX
  ) {
    return { anchorScrollY: scrollY, collapsed: false };
  }

  if (state.collapsed) {
    const anchorScrollY = Math.max(state.anchorScrollY, scrollY);
    if (anchorScrollY - scrollY >= HEADER_REVEAL_SCROLL_DELTA_PX) {
      return { anchorScrollY: scrollY, collapsed: false };
    }
    return { anchorScrollY, collapsed: true };
  }

  const anchorScrollY = Math.min(state.anchorScrollY, scrollY);
  if (scrollY - anchorScrollY >= HEADER_HIDE_SCROLL_DELTA_PX) {
    return { anchorScrollY: scrollY, collapsed: true };
  }
  return { anchorScrollY, collapsed: false };
}
