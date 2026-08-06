import { describe, expect, it } from "vitest";

import { stockIndicator } from "./stock-indicator";

describe("stockIndicator", () => {
  it("0 has no meter and reads под заказ", () => {
    expect(stockIndicator(0)).toEqual({ label: "под заказ", segments: 0, tone: "order" });
  });

  it("1 is the bottom of the red band", () => {
    expect(stockIndicator(1)).toEqual({ label: "скоро закончится", segments: 1, tone: "danger" });
  });

  it("2 is the top of the red band", () => {
    expect(stockIndicator(2)).toEqual({ label: "скоро закончится", segments: 1, tone: "danger" });
  });

  it("3 crosses into the amber band", () => {
    expect(stockIndicator(3)).toEqual({ label: "мало", segments: 2, tone: "warning" });
  });

  it("9 is the top of the amber band", () => {
    expect(stockIndicator(9)).toEqual({ label: "мало", segments: 2, tone: "warning" });
  });

  it("10 crosses into the green band", () => {
    expect(stockIndicator(10)).toEqual({ label: "в наличии", segments: 3, tone: "success" });
  });

  it("stays green well above the boundary", () => {
    expect(stockIndicator(238)).toEqual({ label: "в наличии", segments: 3, tone: "success" });
  });

  it("treats a negative quantity defensively as the zero/order state", () => {
    expect(stockIndicator(-5)).toEqual({ label: "под заказ", segments: 0, tone: "order" });
  });
});
