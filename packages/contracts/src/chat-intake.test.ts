import { describe, expect, it } from "vitest";

import { formatChatIntakeMessage, parseChatIntakeMessage } from "./index.js";

describe("chat intake opening message", () => {
  it("round-trips the questionnaire through the message text", () => {
    const intake = { articleNumber: "04152-40060", comment: "Нужно к пятнице", intent: "part" as const, vehicle: "Toyota Probox 2015" };
    const body = formatChatIntakeMessage(intake);
    expect(body).toBe("Что нужно: Нужна деталь по артикулу\nАвтомобиль/VIN: Toyota Probox 2015\nНомер детали: 04152-40060\nКомментарий: Нужно к пятнице");
    expect(parseChatIntakeMessage(body)).toEqual({ article: "04152-40060", comment: "Нужно к пятнице", intent: "Нужна деталь по артикулу", vehicle: "Toyota Probox 2015" });
  });

  it("reads unanswered fields as null and keeps a multi-line comment", () => {
    const body = formatChatIntakeMessage({ articleNumber: null, comment: "строка 1\nстрока 2", intent: "advice", vehicle: null });
    expect(parseChatIntakeMessage(body)).toEqual({ article: null, comment: "строка 1\nстрока 2", intent: "Помочь подобрать деталь", vehicle: null });
  });

  it("leaves an ordinary message alone", () => {
    expect(parseChatIntakeMessage("Что нужно: просто вопрос")).toBeNull();
    expect(parseChatIntakeMessage("Здравствуйте, есть фильтр?")).toBeNull();
    expect(parseChatIntakeMessage(null)).toBeNull();
  });
});
