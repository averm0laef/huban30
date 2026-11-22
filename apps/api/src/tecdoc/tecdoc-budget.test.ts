import { describe, expect, it } from "vitest";

import { allowanceFor, periodOf, storeDay, storeHour } from "./tecdoc-budget.js";

const settings = { dailyLimit: 0, hourlyLimit: 0, monthlyLimit: 150_000, periodStart: null };

describe("tecdoc request budget", () => {
  it("counts days and hours in the store's time zone", () => {
    const lateEveningUtc = new Date("2026-11-21T16:30:00Z"); // 01:30 on the 22nd in Chita (UTC+9)
    expect(storeDay(lateEveningUtc)).toBe("2026-11-22");
    expect(storeHour(lateEveningUtc)).toBe("2026-11-22T01");
  });

  it("uses the calendar month, or 30-day windows from the day the package was bought", () => {
    expect(periodOf("2026-11-21", null)).toEqual({ end: "2026-12-01", start: "2026-11-01" });
    expect(periodOf("2026-12-31", null)).toEqual({ end: "2027-01-01", start: "2026-12-01" });
    expect(periodOf("2026-11-21", "2026-11-21")).toEqual({ end: "2026-12-21", start: "2026-11-21" });
    expect(periodOf("2026-12-21", "2026-11-21")).toEqual({ end: "2027-01-20", start: "2026-12-21" });
    // A start date in the future is ignored until it comes.
    expect(periodOf("2026-11-20", "2026-11-21")).toEqual({ end: "2026-12-01", start: "2026-11-01" });
  });

  it("spreads what is left of the package evenly over the days left", () => {
    const first = allowanceFor("2026-11-21", 0, { ...settings, periodStart: "2026-11-21" });
    expect(first.daily).toBe(4_850); // 145 500 planned / 30 days
    expect(first.hourly).toBe(970); // a fifth of the day
    // A quiet first half leaves more for each remaining day; a busy one leaves less.
    expect(allowanceFor("2026-12-06", 20_000, { ...settings, periodStart: "2026-11-21" }).daily).toBe(8_366);
    expect(allowanceFor("2026-12-06", 130_000, { ...settings, periodStart: "2026-11-21" }).daily).toBe(1_033);
  });

  it("never plans beyond the package and honours fixed limits", () => {
    expect(allowanceFor("2026-11-30", 149_000, settings)).toMatchObject({ daily: 0, hourly: 0 });
    expect(allowanceFor("2026-11-30", 145_000, settings).daily).toBe(500);
    expect(allowanceFor("2026-11-21", 0, { ...settings, dailyLimit: 300, hourlyLimit: 50 })).toMatchObject({ daily: 300, hourly: 50 });
    expect(allowanceFor("2026-11-21", 0, { ...settings, dailyLimit: 30 })).toMatchObject({ daily: 30, hourly: 20 });
    // The test tariff: 500 a day whatever the month.
    expect(allowanceFor("2026-11-21", 145_400, { ...settings, dailyLimit: 500 }).daily).toBe(100);
  });
});
