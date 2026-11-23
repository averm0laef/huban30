import type { Role } from "@an30/contracts";

export type ChatTakeAction = "take" | "take-over" | null;

/**
 * Whether the person at the staff workspace may put a chat on themselves.
 * Mirrors the API (StaffService.assertChatAssignment): a manager takes only a
 * chat nobody holds; the director and administrators may also take one over.
 */
export function chatTakeAction(
  viewer: { role: Role; userId: string },
  thread: { assignedStaffId: string | null; status: string },
): ChatTakeAction {
  if (thread.status === "closed" || thread.assignedStaffId === viewer.userId) return null;
  if (thread.assignedStaffId === null) return "take";
  return viewer.role === "director" || viewer.role === "admin" ? "take-over" : null;
}

/** What the reply box says while the viewer cannot write in the chat. */
export function chatComposerHint(
  viewer: { role: Role; userId: string },
  thread: { assignedStaffId: string | null; status: string },
): string {
  if (thread.status === "closed") return "Чат закрыт";
  if (thread.assignedStaffId === viewer.userId) return "Напишите ответ. Enter — отправить, Shift+Enter — новая строка";
  const action = chatTakeAction(viewer, thread);
  if (action === "take") return "Чтобы ответить, нажмите «Взять в работу»";
  if (action === "take-over") return "Чат ведёт другой сотрудник. Чтобы ответить, нажмите «Забрать себе»";
  return "Чат ведёт другой сотрудник";
}

/** Who holds the chat, in the words of the queue list and the chat's header. */
export function chatOwnerLabel(
  viewer: { userId: string },
  thread: { assignedName: string | null; assignedStaffId: string | null; status: string },
): string {
  if (thread.assignedStaffId === viewer.userId) return "Ваш чат";
  if (thread.assignedStaffId) return `Менеджер: ${thread.assignedName ?? "сотрудник АН-30"}`;
  return thread.status === "closed" ? "Без менеджера" : "В очереди";
}

/** The ten minutes the customer is promised: keep equal to `MANAGER_RESPONSE_WINDOW_MS` in the storefront chat. */
export const CHAT_ANSWER_PROMISE_MS = 10 * 60 * 1000;

/** «Ждёт ответа 12 мин»: how long the customer has had no answer. Null when nobody is waiting. */
export function chatWaitLabel(
  thread: { status: string; waitingSince?: string | null },
  now: number,
): { overdue: boolean; text: string } | null {
  if (thread.status !== "waiting_staff" || !thread.waitingSince) return null;
  const waitedMs = now - Date.parse(thread.waitingSince);
  if (!Number.isFinite(waitedMs)) return null;
  const minutes = Math.max(0, Math.floor(waitedMs / 60_000));
  const text = minutes < 1 ? "Ждёт ответа меньше минуты"
    : minutes < 60 ? `Ждёт ответа ${minutes} мин`
      : minutes < 24 * 60 ? `Ждёт ответа ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
        : `Ждёт ответа ${Math.floor(minutes / (24 * 60))} дн`;
  return { overdue: waitedMs >= CHAT_ANSWER_PROMISE_MS, text };
}
