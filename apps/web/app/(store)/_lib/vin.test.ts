import { describe, expect, it } from "vitest";

import { isValidVin } from "./vin";

describe("isValidVin", () => {
  it("accepts exactly 17 valid VIN characters case-insensitively", () => {
    expect(isValidVin("1HGCM82633A004352")).toBe(true);
    expect(isValidVin("1hgcm82633a004352")).toBe(true);
  });

  it("rejects invalid length and excluded letters I, O, and Q", () => {
    expect(isValidVin("1HGCM82633A00435")).toBe(false);
    expect(isValidVin("1HGCM82633A0043520")).toBe(false);
    expect(isValidVin("1HGCM82633I004352")).toBe(false);
    expect(isValidVin("1HGCM82633O004352")).toBe(false);
    expect(isValidVin("1HGCM82633Q004352")).toBe(false);
  });
});
