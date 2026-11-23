import { describe, expect, it } from "vitest";

import { formatMoney, formatSchedule, ORDER_LABELS } from "./workspace-utils";

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

describe("the exchange schedule in words", () => {
  it("names a daily exchange a day, not 1440 minutes", () => {
    expect(formatSchedule(1440)).toBe("раз в сутки");
    expect(formatSchedule(2880)).toBe("раз в 2 сут.");
  });

  it("keeps shorter intervals in hours and minutes", () => {
    expect(formatSchedule(120)).toBe("каждые 2 ч");
    expect(formatSchedule(30)).toBe("каждые 30 мин.");
    expect(formatSchedule(0)).toBe("по расписанию 1С");
  });
});
