import { describe, expect, it } from "vitest";

import { readableFailure } from "./parts-finder";

describe("the customer's text of a failed answer", () => {
  it("takes our Russian error, and Nest's Russian message over its English reason phrase", () => {
    expect(readableFailure({ error: "Проверка по каталогу сейчас недоступна." }, "общий")).toBe("Проверка по каталогу сейчас недоступна.");
    expect(readableFailure({ error: "Forbidden", message: "Недопустимый Origin", statusCode: 403 }, "общий")).toBe("Недопустимый Origin");
  });

  it("never shows English or empty text", () => {
    expect(readableFailure({ error: "Forbidden", message: "Forbidden resource" }, "общий")).toBe("общий");
    expect(readableFailure(null, "общий")).toBe("общий");
  });
});
