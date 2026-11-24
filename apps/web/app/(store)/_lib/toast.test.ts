import { describe, expect, it } from "vitest";

import { TOAST_LIFETIME, toastRole, toToast } from "./toast";

describe("notifications (board «Уведомления», owner 24.11.2026)", () => {
  it("gives each kind its time: success 4 s, information 6 s, a warning and an error stay", () => {
    expect(TOAST_LIFETIME).toEqual({ error: null, info: 6_000, success: 4_000, warning: null });
    expect(toToast({ kind: "success", title: "Товар в корзине" })?.lifetime).toBe(4_000);
    expect(toToast({ kind: "error", title: "Сервер не отвечает" })?.lifetime).toBeNull();
  });

  it("interrupts a screen reader only for a warning or an error", () => {
    expect(toastRole("error")).toBe("alert");
    expect(toastRole("warning")).toBe("alert");
    expect(toastRole("success")).toBe("status");
    expect(toastRole("info")).toBe("status");
  });

  it("trims what it says, drops an empty notification, and numbers each one", () => {
    const first = toToast({ kind: "info", text: "  Ответим   с 09:00 ", title: "  Сейчас нерабочее время " });
    expect(first).toMatchObject({ text: "Ответим с 09:00", title: "Сейчас нерабочее время" });
    expect(toToast({ kind: "info", title: "   " })).toBeNull();
    expect(toToast({ kind: "info", title: "Ещё" })!.id).toBeGreaterThan(first!.id);
    expect(toToast({ kind: "success", text: "   ", title: "Вы вошли в кабинет" })?.text).toBeUndefined();
  });
});
