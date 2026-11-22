const SUPPLIER_DISABLED_MESSAGE = "Поиск у поставщика отключён";

export type SupplierSearchFailure =
  | { action: "contact"; body: string; heading: string; kind: "disabled" }
  | { action: "retry"; body: string; heading: string; kind: "temporary" };

/** Keep a configured-off provider distinct from a recoverable search failure. */
export function supplierSearchFailure(message: string): SupplierSearchFailure {
  if (message.trim() === SUPPLIER_DISABLED_MESSAGE) {
    return {
      action: "contact",
      body: "Привезём деталь от поставщика. Напишите, что нужно, — специалист проверит наличие, цену и срок поставки и ответит вам.",
      heading: "Нужной детали нет в магазине?",
      kind: "disabled",
    };
  }

  return {
    action: "retry",
    body: message || "Попробуйте повторить запрос позже.",
    heading: "Не удалось проверить под заказ",
    kind: "temporary",
  };
}
