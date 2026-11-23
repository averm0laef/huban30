import { describe, expect, it } from "vitest";

import { chatComposerHint, chatOwnerLabel, chatTakeAction, chatWaitLabel } from "./chat-assignment";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const manager = { role: "manager" as const, userId: ME };
const director = { role: "director" as const, userId: ME };

describe("taking a chat in the staff workspace", () => {
  it("lets any staff member take a chat nobody holds, whatever its status", () => {
    for (const status of ["open", "waiting_staff", "waiting_customer"]) {
      expect(chatTakeAction(manager, { assignedStaffId: null, status })).toBe("take");
    }
    expect(chatTakeAction(director, { assignedStaffId: null, status: "waiting_staff" })).toBe("take");
  });

  it("lets only the director and administrators take a chat over from a colleague", () => {
    const thread = { assignedStaffId: OTHER, status: "waiting_staff" };
    expect(chatTakeAction(manager, thread)).toBeNull();
    expect(chatTakeAction(director, thread)).toBe("take-over");
    expect(chatTakeAction({ role: "admin", userId: ME }, thread)).toBe("take-over");
  });

  it("offers nothing for the viewer's own chat or a closed one", () => {
    expect(chatTakeAction(manager, { assignedStaffId: ME, status: "waiting_staff" })).toBeNull();
    expect(chatTakeAction(director, { assignedStaffId: null, status: "closed" })).toBeNull();
    expect(chatTakeAction(director, { assignedStaffId: OTHER, status: "closed" })).toBeNull();
  });

  it("tells the viewer why the reply box is locked and how to unlock it", () => {
    expect(chatComposerHint(manager, { assignedStaffId: ME, status: "waiting_staff" })).toContain("Напишите ответ");
    expect(chatComposerHint(manager, { assignedStaffId: null, status: "waiting_customer" })).toContain("Взять в работу");
    expect(chatComposerHint(director, { assignedStaffId: OTHER, status: "waiting_staff" })).toContain("Забрать себе");
    expect(chatComposerHint(manager, { assignedStaffId: OTHER, status: "waiting_staff" })).toBe("Чат ведёт другой сотрудник");
    expect(chatComposerHint(manager, { assignedStaffId: null, status: "closed" })).toBe("Чат закрыт");
  });
});

describe("the queue list tells who answers and how long the customer waits", () => {
  const now = Date.parse("2026-11-23T03:00:00.000Z");
  const waiting = (minutesAgo: number) => ({
    status: "waiting_staff",
    waitingSince: new Date(now - minutesAgo * 60_000).toISOString(),
  });

  it("names the holder of the chat", () => {
    expect(chatOwnerLabel(manager, { assignedName: "Анна", assignedStaffId: ME, status: "waiting_staff" })).toBe("Ваш чат");
    expect(chatOwnerLabel(manager, { assignedName: "Анна", assignedStaffId: OTHER, status: "open" })).toBe("Менеджер: Анна");
    expect(chatOwnerLabel(manager, { assignedName: null, assignedStaffId: null, status: "waiting_staff" })).toBe("В очереди");
    // A closed chat is not waiting for anyone.
    expect(chatOwnerLabel(manager, { assignedName: null, assignedStaffId: null, status: "closed" })).toBe("Без менеджера");
  });

  it("counts the wait in minutes, hours and days", () => {
    expect(chatWaitLabel(waiting(0), now)).toEqual({ overdue: false, text: "Ждёт ответа меньше минуты" });
    expect(chatWaitLabel(waiting(7), now)).toEqual({ overdue: false, text: "Ждёт ответа 7 мин" });
    expect(chatWaitLabel(waiting(95), now)).toEqual({ overdue: true, text: "Ждёт ответа 1 ч 35 мин" });
    expect(chatWaitLabel(waiting(3 * 24 * 60), now)).toEqual({ overdue: true, text: "Ждёт ответа 3 дн" });
  });

  it("marks the wait overdue once the ten minutes promised to the customer pass", () => {
    expect(chatWaitLabel(waiting(9), now)?.overdue).toBe(false);
    expect(chatWaitLabel(waiting(10), now)?.overdue).toBe(true);
  });

  it("shows no wait for an answered or closed chat", () => {
    expect(chatWaitLabel({ status: "waiting_customer", waitingSince: new Date(now).toISOString() }, now)).toBeNull();
    expect(chatWaitLabel({ status: "closed", waitingSince: null }, now)).toBeNull();
    expect(chatWaitLabel({ status: "waiting_staff" }, now)).toBeNull();
  });
});
