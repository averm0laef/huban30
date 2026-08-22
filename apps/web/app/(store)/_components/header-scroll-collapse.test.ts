import { describe, expect, it } from "vitest";

import {
  HEADER_COLLAPSE_START_PX,
  HEADER_HIDE_SCROLL_DELTA_PX,
  HEADER_REVEAL_SCROLL_DELTA_PX,
  createHeaderCollapseState,
  getNextHeaderCollapseState,
} from "./header-scroll-collapse";
import type { HeaderCollapseState, HeaderScrollSample } from "./header-scroll-collapse";

const baseSample: HeaderScrollSample = {
  scrollY: 0,
  focusWithinCollapsibleContent: false,
  reducedMotion: false,
};

function sample(state: HeaderCollapseState, scrollY: number, overrides: Partial<HeaderScrollSample> = {}) {
  return getNextHeaderCollapseState(state, { ...baseSample, ...overrides, scrollY });
}

describe("getNextHeaderCollapseState", () => {
  it("starts expanded at both the page top and a restored scroll position", () => {
    expect(createHeaderCollapseState()).toEqual({ anchorScrollY: 0, collapsed: false });
    expect(createHeaderCollapseState(720)).toEqual({ anchorScrollY: 720, collapsed: false });
  });

  it("keeps the full header visible close to the top", () => {
    const state = createHeaderCollapseState(0);
    expect(sample(state, HEADER_COLLAPSE_START_PX)).toEqual({
      anchorScrollY: HEADER_COLLAPSE_START_PX,
      collapsed: false,
    });
  });

  it("ignores short downward movement, then hides after deliberate travel", () => {
    const startingScrollY = HEADER_COLLAPSE_START_PX + 40;
    const initial = createHeaderCollapseState(startingScrollY);
    const noise = sample(initial, startingScrollY + HEADER_HIDE_SCROLL_DELTA_PX - 1);
    expect(noise.collapsed).toBe(false);

    const hidden = sample(noise, startingScrollY + HEADER_HIDE_SCROLL_DELTA_PX);
    expect(hidden).toEqual({
      anchorScrollY: startingScrollY + HEADER_HIDE_SCROLL_DELTA_PX,
      collapsed: true,
    });
  });

  it("tracks the furthest downward position while hidden", () => {
    const hidden: HeaderCollapseState = { anchorScrollY: 300, collapsed: true };
    expect(sample(hidden, 520)).toEqual({ anchorScrollY: 520, collapsed: true });
  });

  it("returns on a meaningful upward scroll, not one-pixel trackpad noise", () => {
    const hidden: HeaderCollapseState = { anchorScrollY: 500, collapsed: true };
    const noise = sample(hidden, 500 - HEADER_REVEAL_SCROLL_DELTA_PX + 1);
    expect(noise.collapsed).toBe(true);

    const shown = sample(noise, 500 - HEADER_REVEAL_SCROLL_DELTA_PX);
    expect(shown).toEqual({
      anchorScrollY: 500 - HEADER_REVEAL_SCROLL_DELTA_PX,
      collapsed: false,
    });
  });

  it("does not immediately hide again after returning", () => {
    const shown: HeaderCollapseState = { anchorScrollY: 488, collapsed: false };
    const directionNoise = sample(shown, 488 + HEADER_HIDE_SCROLL_DELTA_PX - 1);
    expect(directionNoise.collapsed).toBe(false);

    expect(sample(directionNoise, 488 + HEADER_HIDE_SCROLL_DELTA_PX).collapsed).toBe(true);
  });

  it("always expands at the top, including Safari negative overscroll", () => {
    const hidden: HeaderCollapseState = { anchorScrollY: 240, collapsed: true };
    expect(sample(hidden, HEADER_COLLAPSE_START_PX).collapsed).toBe(false);
    expect(sample(hidden, -28)).toEqual({ anchorScrollY: 0, collapsed: false });
  });

  it("stays expanded for reduced-motion users", () => {
    const hidden: HeaderCollapseState = { anchorScrollY: 500, collapsed: true };
    expect(sample(hidden, 500, { reducedMotion: true })).toEqual({
      anchorScrollY: 500,
      collapsed: false,
    });
  });

  it("expands for focus in collapsible content and resets the direction anchor", () => {
    const hidden: HeaderCollapseState = { anchorScrollY: 500, collapsed: true };
    const focused = sample(hidden, 500, { focusWithinCollapsibleContent: true });
    expect(focused).toEqual({ anchorScrollY: 500, collapsed: false });

    // Clearing the focus guard at the same position must not make it jump
    // closed; another deliberate downward gesture is required.
    expect(sample(focused, 500).collapsed).toBe(false);
  });
});
