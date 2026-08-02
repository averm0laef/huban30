import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "./storefront-api";

describe("apiErrorMessage", () => {
  it("extracts Nest validation messages", () => {
    expect(apiErrorMessage({ message: ["Email некорректен", "Пароль слишком короткий"] }, 400))
      .toBe("Email некорректен. Пароль слишком короткий");
  });

  it("extracts nested contract issues", () => {
    expect(apiErrorMessage({ message: { issues: [{ message: "Товар закончился" }] } }, 400))
      .toBe("Товар закончился");
  });

  it("uses safe status fallbacks without exposing server markup", () => {
    expect(apiErrorMessage("<html>failure</html>", 503)).toBe("Сервис временно недоступен");
  });
});
