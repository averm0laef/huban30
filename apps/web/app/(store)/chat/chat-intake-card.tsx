import type { ParsedChatIntake } from "@an30/contracts";

import styles from "./chat-conversation.module.css";

/**
 * The thread's opening questionnaire drawn as a request card, not a bubble:
 * what is needed, the car and the part number at a glance, then the chat
 * continues with ordinary messages.
 */
export function ChatIntakeCard({ intake, time }: { intake: ParsedChatIntake; time: string }) {
  const rows: Array<[string, string | null]> = [
    ["Автомобиль", intake.vehicle],
    ["Номер детали", intake.article],
  ];
  return (
    <div className={styles.intake}>
      <p className={styles.intakeKicker}>Заявка</p>
      <p className={styles.intakeTitle}>{intake.intent}</p>
      <dl className={styles.intakeRows}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd data-empty={value === null || undefined}>{value ?? "не указан"}</dd>
          </div>
        ))}
      </dl>
      {intake.comment ? <p className={styles.intakeComment}>{intake.comment}</p> : null}
      <span className={styles.intakeTime}>{time}</span>
    </div>
  );
}
