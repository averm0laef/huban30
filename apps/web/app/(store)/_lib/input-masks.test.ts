import { describe, expect, it } from "vitest";

import { emailSuggestion, formatPhone, normalizeEmail, normalizeVin } from "./input-masks";

describe("phone mask", () => {
  it("shows every usual way of typing a Russian number alike and gives the server its old format", () => {
    for (const typed of ["89244742605", "9244742605", "+7 924 474-26-05", "7 (924) 474 26 05", "+79244742605"]) {
      expect(formatPhone(typed)).toEqual({ display: "+7 (924) 474-26-05", e164: "+79244742605" });
    }
  });

  it("builds the mask as the customer types and has no number until it is complete", () => {
    expect(formatPhone("8")).toEqual({ display: "+7", e164: null });
    expect(formatPhone("892")).toEqual({ display: "+7 (92", e164: null });
    expect(formatPhone("8924")).toEqual({ display: "+7 (924)", e164: null });
    expect(formatPhone("8924474")).toEqual({ display: "+7 (924) 474", e164: null });
    expect(formatPhone("892447426")).toEqual({ display: "+7 (924) 474-26", e164: null });
    expect(formatPhone("")).toEqual({ display: "", e164: null });
  });

  it("keeps another country's number with its code, and never more than ten digits after +7", () => {
    expect(formatPhone("+375 29 123-45-67")).toEqual({ display: "+375291234567", e164: "+375291234567" });
    expect(formatPhone("+7924474260512345").e164).toBe("+79244742605");
  });
});

describe("e-mail mask", () => {
  it("drops spaces and puts the domain in small letters", () => {
    expect(normalizeEmail(" Ivan.Petrov @ Mail.RU ")).toBe("Ivan.Petrov@mail.ru");
  });

  it("offers the right domain for the usual slips, and nothing for a good address", () => {
    expect(emailSuggestion("ivan@gmial.com")).toBe("ivan@gmail.com");
    expect(emailSuggestion("ivan@yandex.ry")).toBe("ivan@yandex.ru");
    expect(emailSuggestion("ivan@mail.ru")).toBeNull();
    expect(emailSuggestion("ivan")).toBeNull();
  });
});

describe("VIN mask", () => {
  it("writes a VIN in capitals without spaces, and I, O, Q — never in a VIN — as 1 and 0", () => {
    expect(normalizeVin("xtagfk330jy144213")).toBe("XTAGFK330JY144213");
    expect(normalizeVin("XTAGFK33OJY1442I3")).toBe("XTAGFK330JY144213");
    expect(normalizeVin("xta gfk 330 jy 144213")).toBe("XTAGFK330JY144213");
  });

  it("leaves a Japanese frame number and an unfinished VIN as typed", () => {
    expect(normalizeVin("nze141-6012345")).toBe("NZE141-6012345");
    expect(normalizeVin("XTAO")).toBe("XTAO");
  });
});
