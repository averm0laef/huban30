import { describe, expect, it } from "vitest";

import { HEADER_COLLAPSE_SCROLL_THRESHOLD_PX, isHeaderCollapsed } from "./header-scroll-collapse";
import type { HeaderCollapseFlags } from "./header-scroll-collapse";

const baseFlags: HeaderCollapseFlags = {
  scrollY: 0,
  focusWithin: false,
  reducedMotion: false,
};

describe("isHeaderCollapsed", () => {
  it("stays expanded at the top of the page", () => {
    expect(isHeaderCollapsed(baseFlags)).toBe(false);
  });

  it("collapses once scrolled past the threshold", () => {
    expect(isHeaderCollapsed({ ...baseFlags, scrollY: HEADER_COLLAPSE_SCROLL_THRESHOLD_PX })).toBe(true);
    expect(isHeaderCollapsed({ ...baseFlags, scrollY: HEADER_COLLAPSE_SCROLL_THRESHOLD_PX + 400 })).toBe(true);
  });

  it("does not collapse just below the threshold", () => {
    expect(isHeaderCollapsed({ ...baseFlags, scrollY: HEADER_COLLAPSE_SCROLL_THRESHOLD_PX - 1 })).toBe(false);
  });

  it("never collapses under prefers-reduced-motion, regardless of scroll position", () => {
    expect(isHeaderCollapsed({ ...baseFlags, scrollY: 5000, reducedMotion: true })).toBe(false);
  });

  it("expands again the moment focus lands inside the header, even while scrolled", () => {
    expect(isHeaderCollapsed({ ...baseFlags, scrollY: 5000, focusWithin: true })).toBe(false);
  });

  it("re-collapses once focus leaves and scroll is still past the threshold", () => {
    const focused: HeaderCollapseFlags = { ...baseFlags, scrollY: 5000, focusWithin: true };
    expect(isHeaderCollapsed(focused)).toBe(false);
    expect(isHeaderCollapsed({ ...focused, focusWithin: false })).toBe(true);
  });
});
