"use client";

import { useId, useState, type FormEvent } from "react";

import {
  CHAT_INTAKE_INTENTS,
  CHAT_INTAKE_INTENT_LABELS,
  type ChatIntake,
  type ChatIntakeIntent,
} from "@an30/contracts";

import styles from "./chat-intake-form.module.css";

// Mirrors ChatIntakeSchema's own limits in @an30/contracts — the UI honours
// those, it never invents its own.
const VEHICLE_MAX = 160;
const ARTICLE_MAX = 80;
const COMMENT_MAX = 1_000;

export interface ChatIntakeFormProps {
  /** Blocks submission without changing the button's label (e.g. offline) — distinct from `pending`, which is the in-flight state itself. */
  disabled?: boolean;
  error?: string;
  onSubmit: (intake: ChatIntake) => void;
  pending: boolean;
}

/**
 * The pre-chat intake questionnaire — the gate every new conversation goes
 * through before a thread exists (see ChatThreadCreateSchema's comment in
 * @an30/contracts). `intent` is the only required answer: someone who
 * doesn't know their VIN or article number yet must still be able to reach
 * a manager, so every other field stays optional and short.
 */
export function ChatIntakeForm({ disabled, error, onSubmit, pending }: ChatIntakeFormProps) {
  const formId = useId();
  const [intent, setIntent] = useState<ChatIntakeIntent | "">("");
  const [vehicle, setVehicle] = useState("");
  const [articleNumber, setArticleNumber] = useState("");
  const [comment, setComment] = useState("");
  const [showIntentError, setShowIntentError] = useState(false);
  const inputsDisabled = pending || disabled;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!intent) {
      setShowIntentError(true);
      return;
    }
    if (inputsDisabled) return;
    onSubmit({
      articleNumber: articleNumber.trim() || null,
      comment: comment.trim() || null,
      intent,
      vehicle: vehicle.trim() || null,
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <p className={styles.lead}>Пара вопросов — и подключим менеджера</p>

      <div className={styles.field}>
        <label htmlFor={`${formId}-intent`}>Что нужно?</label>
        <select
          disabled={inputsDisabled}
          id={`${formId}-intent`}
          onChange={(event) => {
            setIntent(event.target.value as ChatIntakeIntent);
            setShowIntentError(false);
          }}
          required
          value={intent}
        >
          <option disabled value="">Выберите тему обращения</option>
          {CHAT_INTAKE_INTENTS.map((value) => (
            <option key={value} value={value}>{CHAT_INTAKE_INTENT_LABELS[value]}</option>
          ))}
        </select>
        {showIntentError ? <p className={styles.fieldError} role="alert">Выберите тему обращения</p> : null}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-vehicle`}>Автомобиль — необязательно</label>
        <input
          disabled={inputsDisabled}
          id={`${formId}-vehicle`}
          maxLength={VEHICLE_MAX}
          onChange={(event) => setVehicle(event.target.value)}
          placeholder="Марка, модель, год или VIN"
          value={vehicle}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-article`}>Номер детали — необязательно</label>
        <input
          disabled={inputsDisabled}
          id={`${formId}-article`}
          maxLength={ARTICLE_MAX}
          onChange={(event) => setArticleNumber(event.target.value)}
          placeholder="Артикул, если уже знаете"
          value={articleNumber}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-comment`}>Комментарий — необязательно</label>
        <textarea
          disabled={inputsDisabled}
          id={`${formId}-comment`}
          maxLength={COMMENT_MAX}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Что ещё стоит знать менеджеру"
          rows={2}
          value={comment}
        />
      </div>

      <button disabled={inputsDisabled} type="submit">{pending ? "Отправляем…" : "Начать чат"}</button>
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
    </form>
  );
}
