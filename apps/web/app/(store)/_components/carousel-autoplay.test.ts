import { describe, expect, it } from "vitest";

import { isAutoplayActive } from "./carousel-autoplay";
import type { AutoplayFlags } from "./carousel-autoplay";

const baseFlags: AutoplayFlags = {
  slideCount: 4,
  reducedMotion: false,
  hovered: false,
  focusWithin: false,
  tabHidden: false,
  interacted: false,
};

describe("isAutoplayActive", () => {
  it("runs when nothing is blocking it and there is more than one slide", () => {
    expect(isAutoplayActive(baseFlags)).toBe(true);
  });

  it("never runs with zero or one slide, regardless of other flags", () => {
    expect(isAutoplayActive({ ...baseFlags, slideCount: 0 })).toBe(false);
    expect(isAutoplayActive({ ...baseFlags, slideCount: 1 })).toBe(false);
  });

  it("pauses while the pointer is over the carousel", () => {
    expect(isAutoplayActive({ ...baseFlags, hovered: true })).toBe(false);
  });

  it("pauses while focus is within the carousel", () => {
    expect(isAutoplayActive({ ...baseFlags, focusWithin: true })).toBe(false);
  });

  it("pauses while the browser tab is hidden", () => {
    expect(isAutoplayActive({ ...baseFlags, tabHidden: true })).toBe(false);
  });

  it("resumes once a pause condition clears and nothing else blocks it", () => {
    const hoveredThenNot: AutoplayFlags = { ...baseFlags, hovered: true };
    expect(isAutoplayActive(hoveredThenNot)).toBe(false);
    expect(isAutoplayActive({ ...hoveredThenNot, hovered: false })).toBe(true);
  });

  it("never starts under prefers-reduced-motion, even with every other flag clear", () => {
    expect(isAutoplayActive({ ...baseFlags, reducedMotion: true })).toBe(false);
  });

  it("reduced motion wins even if hover/focus/hidden would otherwise also allow it to run", () => {
    expect(isAutoplayActive({
      ...baseFlags,
      reducedMotion: true,
      hovered: false,
      focusWithin: false,
      tabHidden: false,
    })).toBe(false);
  });

  it("stops for good once the visitor has interacted with a control", () => {
    expect(isAutoplayActive({ ...baseFlags, interacted: true })).toBe(false);
  });

  it("stays stopped after an interaction even once hover, focus and tab-hidden all clear again", () => {
    const afterInteraction: AutoplayFlags = {
      ...baseFlags,
      interacted: true,
      hovered: false,
      focusWithin: false,
      tabHidden: false,
    };
    expect(isAutoplayActive(afterInteraction)).toBe(false);
  });
});
