import { describe, expect, it } from "vitest";

import { isRepeatClick } from "./cart-actions";

describe("isRepeatClick", () => {
  it("treats the second click of a double click as the same intent", () => {
    expect(isRepeatClick(1_000, 1_120)).toBe(true);
    expect(isRepeatClick(1_000, 1_499)).toBe(true);
  });

  it("lets a first click and a deliberate later click through", () => {
    expect(isRepeatClick(null, 1_000)).toBe(false);
    expect(isRepeatClick(1_000, 1_500)).toBe(false);
    expect(isRepeatClick(1_000, 4_000)).toBe(false);
  });
});
