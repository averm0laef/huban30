import { describe, expect, it } from "vitest";

import { supplierSearchFailure } from "./supplier-search-state";

describe("supplierSearchFailure", () => {
  it("routes a disabled supplier to a specialist without offering a futile retry", () => {
    expect(supplierSearchFailure("Поиск у поставщика отключён")).toEqual({
      action: "contact",
      body: "Привезём деталь от поставщика. Напишите, что нужно, — специалист проверит наличие, цену и срок поставки и ответит вам.",
      heading: "Нужной детали нет в магазине?",
      kind: "disabled",
    });
  });

  it("keeps retry available for a temporary supplier failure", () => {
    expect(supplierSearchFailure("Сервис временно недоступен")).toEqual({
      action: "retry",
      body: "Сервис временно недоступен",
      heading: "Не удалось проверить под заказ",
      kind: "temporary",
    });
  });
});
