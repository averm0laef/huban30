import { describe, expect, it } from "vitest";

import { formatMoney, ORDER_LABELS } from "./workspace-utils";

describe("staff workspace formatting", () => {
  it("formats integer kopeks as rubles", () => {
    expect(formatMoney(123_45)).toContain("123,45");
    expect(formatMoney(null)).toBe("Нет цены");
  });

  it("has a visible label for every order status", () => {
    expect(Object.keys(ORDER_LABELS)).toHaveLength(6);
    expect(ORDER_LABELS.awaiting_confirmation).toBe("Новая заявка");
  });
});
