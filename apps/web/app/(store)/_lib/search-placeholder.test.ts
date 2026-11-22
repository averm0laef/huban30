import { describe, expect, it } from "vitest";

import { placeholderSequence, SEARCH_HINT, typingFrames } from "./search-placeholder";

describe("search placeholder", () => {
  it("shows the plain hint after every three examples, with 20–30 examples in all", () => {
    const sequence = placeholderSequence();
    const examples = sequence.filter((line) => line !== SEARCH_HINT);
    expect(examples.length).toBeGreaterThanOrEqual(20);
    expect(examples.length).toBeLessThanOrEqual(30);
    expect(sequence.slice(0, 4)).toEqual([examples[0], examples[1], examples[2], SEARCH_HINT]);
    expect(sequence.at(-1)).toBe(SEARCH_HINT);
  });

  it("types, holds and erases one line", () => {
    const frames = typingFrames("VIN", { erase: 1, hold: 9, type: 2 });
    expect(frames.map((frame) => frame.text)).toEqual(["V", "VI", "VIN", "VIN", "VI", "V", ""]);
    expect(frames[3]!.delay).toBe(9);
  });
});
