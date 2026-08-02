import { describe, expect, it } from "vitest";

import { formatMoney, ORDER_LABELS, parseRublesToKopeks } from "./workspace-utils";

describe("staff workspace formatting", () => {
  it("formats integer kopeks as rubles", () => {
    expect(formatMoney(123_45)).toContain("123,45");
    expect(formatMoney(null)).toBe("Нет цены");
  });

  it("has a visible label for every order status", () => {
    expect(Object.keys(ORDER_LABELS)).toHaveLength(8);
    expect(ORDER_LABELS.pending_payment).toBe("Ожидает оплаты");
  });

  it("parses a refund amount without floating-point kopek loss", () => {
    expect(parseRublesToKopeks("123,45")).toBe(12_345);
    expect(parseRublesToKopeks("0.01")).toBe(1);
    expect(parseRublesToKopeks("1e3")).toBeNull();
    expect(parseRublesToKopeks("1.234")).toBeNull();
  });
});
