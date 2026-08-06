import { describe, expect, it } from "vitest";

import { chitaMinutesSinceMidnight, computeShopStatus } from "./shop-status";

const JUST_BEFORE_OPEN = 8 * 60 + 59; // 08:59
const JUST_AFTER_OPEN = 9 * 60; // 09:00
const JUST_BEFORE_CLOSE = 18 * 60 + 59; // 18:59
const JUST_AFTER_CLOSE = 19 * 60; // 19:00

describe("computeShopStatus", () => {
  it("is closed one minute before opening, and opens later today", () => {
    const status = computeShopStatus(JUST_BEFORE_OPEN);
    expect(status.open).toBe(false);
    expect(status.label).toBe("Закрыто");
    expect(status.detail).toBe("откроется сегодня в 09:00");
  });

  it("is open the instant it turns 09:00", () => {
    const status = computeShopStatus(JUST_AFTER_OPEN);
    expect(status.open).toBe(true);
    expect(status.label).toBe("Сейчас открыто");
    expect(status.detail).toBe("закроется через 10 ч");
  });

  it("is still open one minute before closing", () => {
    const status = computeShopStatus(JUST_BEFORE_CLOSE);
    expect(status.open).toBe(true);
    expect(status.detail).toBe("закроется через 1 мин");
  });

  it("never claims open one minute after closing — 19:00 sharp is already closed", () => {
    const status = computeShopStatus(JUST_AFTER_CLOSE);
    expect(status.open).toBe(false);
    expect(status.label).toBe("Закрыто");
    expect(status.detail).toBe("откроется завтра в 09:00");
  });

  it("stays closed and says \"завтра\" for the rest of the night", () => {
    const lateNight = computeShopStatus(23 * 60 + 30); // 23:30
    expect(lateNight.open).toBe(false);
    expect(lateNight.detail).toBe("откроется завтра в 09:00");
  });

  it("says \"сегодня\" for the early hours before opening", () => {
    const earlyMorning = computeShopStatus(3 * 60); // 03:00
    expect(earlyMorning.open).toBe(false);
    expect(earlyMorning.detail).toBe("откроется сегодня в 09:00");
  });

  it("formats a mid-afternoon remaining time with both hours and minutes", () => {
    const midAfternoon = computeShopStatus(16 * 60 + 45); // 16:45 -> closes in 2h15m
    expect(midAfternoon.detail).toBe("закроется через 2 ч 15 мин");
  });
});

describe("chitaMinutesSinceMidnight", () => {
  it("reads the hour/minute in Asia/Chita (UTC+9), not the host's local time", () => {
    // 2026-01-15T00:30:00Z is 09:30 in Asia/Chita (fixed UTC+9, no DST).
    const utcMidnightThirty = new Date("2026-01-15T00:30:00Z");
    expect(chitaMinutesSinceMidnight(utcMidnightThirty)).toBe(9 * 60 + 30);
  });

  it("wraps correctly just before UTC midnight", () => {
    // 2026-01-14T23:59:00Z is 08:59 the next day in Asia/Chita.
    const utcLateNight = new Date("2026-01-14T23:59:00Z");
    expect(chitaMinutesSinceMidnight(utcLateNight)).toBe(8 * 60 + 59);
  });
});
