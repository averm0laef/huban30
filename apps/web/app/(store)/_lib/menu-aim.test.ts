import { describe, expect, it } from "vitest";

import { aimVerdict, headsForPane } from "./menu-aim";

describe("a pointer on its way from a list to the pane on its right", () => {
  // The catalogue menu: sections on the left, the subsections of the one in hand on the right. The subsections
  // sit at the top of the pane and the section may be far down the list, so the pointer travels diagonally across
  // other sections; they must not take over while it is plainly heading for the pane.
  const pane = { bottom: 700, left: 400, top: 100 };

  it("is on its way when it moves straight to the right", () => {
    expect(headsForPane({ x: 200, y: 386 }, { x: 215, y: 386 }, pane)).toBe(true);
  });

  it("is on its way when it moves up and to the right, towards a link at the top of the pane", () => {
    expect(headsForPane({ x: 200, y: 386 }, { x: 213, y: 379 }, pane)).toBe(true);
  });

  it("is on its way when it moves down and to the right, towards a link low in the pane", () => {
    expect(headsForPane({ x: 200, y: 200 }, { x: 212, y: 215 }, pane)).toBe(true);
  });

  it("is not when it moves down the list", () => {
    expect(headsForPane({ x: 200, y: 386 }, { x: 200, y: 400 }, pane)).toBe(false);
    expect(headsForPane({ x: 200, y: 386 }, { x: 202, y: 420 }, pane)).toBe(false);
  });

  it("is not when it moves to the left", () => {
    expect(headsForPane({ x: 200, y: 386 }, { x: 190, y: 380 }, pane)).toBe(false);
  });

  it("is not when it stands still", () => {
    expect(headsForPane({ x: 200, y: 386 }, { x: 200, y: 386 }, pane)).toBe(false);
  });

  it("is not when its line passes above or below the pane", () => {
    // From (200, 650) the bottom corner of the pane is 200 to the right and 50 down: 30 down for 10 right misses it.
    expect(headsForPane({ x: 200, y: 650 }, { x: 210, y: 680 }, pane)).toBe(false);
    expect(headsForPane({ x: 200, y: 150 }, { x: 210, y: 120 }, pane)).toBe(false);
  });
});

describe("a section the pointer is on while another section is in hand", () => {
  const pane = { bottom: 700, left: 400, top: 100 };
  // The pointer's last positions, oldest first: up and to the right, towards the subsections.
  const towardsThePane = [{ x: 284, y: 379 }, { x: 292, y: 372 }, { x: 300, y: 366 }];
  const downTheList = [{ x: 200, y: 380 }, { x: 201, y: 395 }, { x: 201, y: 410 }];

  it("waits when the pointer has just come onto it on its way to the subsections", () => {
    expect(aimVerdict(towardsThePane, pane, null)).toBe("wait");
  });

  it("takes over at once when the pointer came onto it going down the list", () => {
    expect(aimVerdict(downTheList, pane, null)).toBe("pick");
  });

  it("takes over at once when nothing is known of where the pointer came from", () => {
    expect(aimVerdict([], pane, null)).toBe("pick");
    expect(aimVerdict([{ x: 300, y: 366 }], pane, null)).toBe("pick");
  });

  it("waits again when, after a wait, the pointer has moved on towards the subsections", () => {
    expect(aimVerdict(towardsThePane, pane, { x: 270, y: 392 })).toBe("wait");
  });

  it("takes over when the pointer has stood on it for the whole wait", () => {
    expect(aimVerdict(towardsThePane, pane, { x: 300, y: 366 })).toBe("pick");
  });

  it("takes over when, after a wait, the pointer has turned away from the subsections", () => {
    expect(aimVerdict(downTheList, pane, { x: 200, y: 380 })).toBe("pick");
  });
});
