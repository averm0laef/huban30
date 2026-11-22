import { describe, expect, it } from "vitest";

import { plainAddress, rejectionText, type RejectedRequest } from "./one-c-rejections";

function request(overrides: Partial<RejectedRequest>): RejectedRequest {
  return {
    createdAt: "2026-11-22T10:00:00.000Z", details: {}, id: "1", ipAddress: "203.0.113.9/32", operation: "exchange_checkauth", statusCode: 401,
    ...overrides,
  };
}

describe("an address as the journal gives it", () => {
  it("is shown without the mask of a single address", () => {
    expect(plainAddress("203.0.113.9/32")).toBe("203.0.113.9");
    expect(plainAddress("2001:db8::1/128")).toBe("2001:db8::1");
    expect(plainAddress("203.0.113.9")).toBe("203.0.113.9");
  });

  it("says so when the journal has none", () => {
    expect(plainAddress(null)).toBe("не записан");
  });
});

describe("what the owner is told about a request the site turned away", () => {
  // 1С shows only «ошибка авторизации» whatever happened; these lines are where the owner learns what to put right.
  it("names the address to add when 1С called from outside the allowed networks", () => {
    const text = rejectionText(request({ details: { outcome: "rejected", reason: "address_not_allowed" } }));
    expect(text.what).toBe("Адрес не входит в «Разрешённые сети»");
    expect(text.todo).toContain("203.0.113.9/32");
    expect(text.todo).toContain("«Разрешённые сети»");
  });

  it("gives an IPv6 address with its own mask", () => {
    const text = rejectionText(request({ details: { outcome: "rejected", reason: "address_not_allowed" }, ipAddress: "2001:db8::1/128" }));
    expect(text.todo).toContain("2001:db8::1/128");
  });

  it.each([
    ["wrong_credentials", "Неверное имя пользователя или пароль"],
    ["disabled", "Обмен с этой базой выключен"],
    ["not_configured", "На сайте не заданы имя пользователя и пароль обмена"],
    ["no_credentials", "Запрос без имени пользователя и пароля"],
  ])("explains «%s»", (reason, what) => {
    const text = rejectionText(request({ details: { outcome: "rejected", reason } }));
    expect(text.what).toBe(what);
    expect(text.todo.length).toBeGreaterThan(20);
  });

  it("explains a request the site stopped answering for a minute", () => {
    const text = rejectionText(request({ details: { outcome: "rate_limited" }, statusCode: 429 }));
    expect(text.what).toBe("Слишком много обращений подряд");
  });

  it("says at which step of the exchange a request was turned away after the login", () => {
    const text = rejectionText(request({
      details: { outcome: "rejected", reason: "address_not_allowed", session: "absent", step: "file" }, operation: "exchange_request",
    }));
    expect(text.what).toBe("Адрес не входит в «Разрешённые сети» — на шаге «передача файла»");
  });

  it("explains a session that was shown and not accepted", () => {
    const text = rejectionText(request({
      details: { outcome: "rejected", reason: "no_credentials", session: "not_accepted", step: "import" }, operation: "exchange_request",
    }));
    expect(text.what).toBe("Сеанс обмена не принят — на шаге «загрузка данных»");
    expect(text.todo).toContain("другого адреса");
  });

  it("does not call a request that was let in and then failed a refusal at the door", () => {
    // The journal lists every request that did not succeed, not only the refused ones.
    const text = rejectionText(request({ details: { errorType: "BadRequestException" }, operation: "catalog_import_upload", statusCode: 400 }));
    expect(text.what).toBe("Запрос принят, но не выполнен");
    expect(text.todo).toContain("400");
  });

  it("does not invent a cause for an entry written before causes were kept", () => {
    for (const details of [{ outcome: "rejected" }, { errorType: "UnauthorizedException" }, {}]) {
      const text = rejectionText(request({ details }));
      expect(text.what).toBe("Вход не принят");
      expect(text.todo).toContain("не сохранена");
    }
  });

  it("does not show a cause it does not know as if it knew it", () => {
    const text = rejectionText(request({ details: { outcome: "rejected", reason: "something_new" } }));
    expect(text.what).toBe("Вход не принят");
  });
});
