"use client";

import { useEffect, useRef, useState } from "react";

import {
  MANAGER_ASSIGNED_HEADLINE,
  MANAGER_ELAPSED_BODY,
  MANAGER_ELAPSED_HEADLINE,
  MANAGER_OUT_OF_HOURS_HEADLINE,
  MANAGER_WAITING_TEXT,
  formatCountdown,
  managerAssignedNote,
  managerJoinState,
  managerOutOfHoursBody,
  type ChatMessage,
  type ChatThread,
  type ManagerJoinState,
} from "./chat-state";
import styles from "./manager-join-notice.module.css";

export interface ManagerJoinNoticeProps {
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  managerWaitSince?: string | null;
  messages: ChatMessage[];
  status: ChatThread["status"];
}

/** Text for the screen-reader-only live region — updated only when the
 * *kind* of state changes, never on every countdown tick. */
function announcementFor(state: ManagerJoinState): string {
  switch (state.kind) {
    case "assigned":
      return state.staffName ? `Менеджер ${state.staffName} подключился к чату` : MANAGER_ASSIGNED_HEADLINE;
    case "elapsed":
      return `${MANAGER_ELAPSED_HEADLINE}. ${MANAGER_ELAPSED_BODY}`;
    case "outOfHours":
      return `${MANAGER_OUT_OF_HOURS_HEADLINE}. ${managerOutOfHoursBody(state.openDetail)}`;
    case "waiting":
      return MANAGER_WAITING_TEXT;
    default:
      return "";
  }
}

/**
 * "Manager is joining" banner shown above the composer on both chat
 * surfaces once a thread has an unanswered customer message (see
 * `managerJoinState` in chat-state.ts). Ticks its own visible countdown
 * every second while waiting, but the screen-reader announcement only
 * fires when the *state* changes — nobody needs "9:58, 9:57, 9:56..."
 * read aloud.
 */
export function ManagerJoinNotice({ assignedStaffId, assignedStaffName, managerWaitSince, messages, status }: ManagerJoinNoticeProps) {
  const [now, setNow] = useState(() => Date.now());
  const state = managerJoinState({ assignedStaffId, assignedStaffName, managerWaitSince, messages, now, status });

  const [announcement, setAnnouncement] = useState("");
  const lastKindRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.kind !== "waiting" && state.kind !== "outOfHours") return;
    const updateClock = () => setNow(Date.now());
    const timer = window.setInterval(updateClock, state.kind === "waiting" ? 1_000 : 30_000);
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateClock);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateClock); document.removeEventListener("visibilitychange", updateClock); };
    // Re-armed whenever the *kind* changes (e.g. staff replies mid-count),
    // not on every tick — `now` itself is deliberately not a dependency.
  }, [state.kind]);

  useEffect(() => {
    if (lastKindRef.current === state.kind) return;
    lastKindRef.current = state.kind;
    setAnnouncement(announcementFor(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  if (state.kind === "none" || state.kind === "closed") return null;

  const headline = state.kind === "waiting" ? MANAGER_WAITING_TEXT
    : state.kind === "elapsed" ? MANAGER_ELAPSED_HEADLINE
      : state.kind === "outOfHours" ? MANAGER_OUT_OF_HOURS_HEADLINE
        : assignedStaffName ? `${assignedStaffName} на связи` : MANAGER_ASSIGNED_HEADLINE;
  const body = state.kind === "elapsed" ? MANAGER_ELAPSED_BODY
    : state.kind === "outOfHours" ? managerOutOfHoursBody(state.openDetail)
      : state.kind === "assigned" ? managerAssignedNote(assignedStaffName)
        : null;

  return (
    <div className={styles.notice} data-state={state.kind}>
      <div aria-live="polite" className={styles.visuallyHidden} role="status">{announcement}</div>
      <div className={styles.headline}>
        <strong>{headline}</strong>
        {state.kind === "waiting" ? (
          <span aria-hidden="true" className={styles.countdown}>{formatCountdown(state.remainingMs)}</span>
        ) : null}
      </div>
      {body ? <p>{body}</p> : null}
    </div>
  );
}
