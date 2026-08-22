"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  CONTACT_CONSENT_POLICY_VERSION,
  CONTACT_PERSONAL_DATA_CONSENT_TEXT,
} from "@an30/contracts";

import { clearIdempotencyKey, stableIdempotencyKey } from "../_lib/idempotency";
import { apiRequest, errorText } from "../_lib/storefront-api";
import styles from "./storefront.module.css";

interface ContactResponse {
  createdAt: string;
  id: string;
  message: string;
  replayed: boolean;
  status: string;
}

interface ContactRequestFormProps {
  description: string;
  enabled?: boolean;
  messagePlaceholder?: string;
  source: "contacts" | "expert_help" | "vin_request";
  title: string;
}

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function ContactRequestForm({
  description,
  enabled = true,
  messagePlaceholder,
  source,
  title,
}: ContactRequestFormProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<ContactResponse | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const request = {
      consent: form.get("consent") === "on",
      email: optional(form.get("email")),
      message: String(form.get("message") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      phone: optional(form.get("phone")),
      policyVersion: CONTACT_CONSENT_POLICY_VERSION,
      source,
    };
    setPending(true); setError(""); setSuccess(null);
    try {
      if (!request.email && !request.phone) throw new Error("Укажите email или телефон для ответа");
      const idempotencyKey = await stableIdempotencyKey(window.sessionStorage, `contact:${source}`, request);
      const response = await apiRequest<ContactResponse>("/contact-requests", {
        method: "POST", body: { ...request, idempotencyKey },
      });
      clearIdempotencyKey(window.sessionStorage, `contact:${source}`);
      setSuccess(response);
      element.reset();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.formPanel} aria-labelledby={`contact-form-${source}`}>
      <h2 id={`contact-form-${source}`}>{title}</h2><p>{description}</p>
      {!enabled ? (
        <div className={styles.offlineNotice} role="status">
          Онлайн-форма откроется после публикации утверждённой политики обработки данных.
          Пока свяжитесь с магазином по телефону, указанному на странице.
        </div>
      ) : null}
      {!enabled ? null : <>
      {!online ? <div className={styles.offlineNotice} role="status">Нет подключения к сети. Заполненные данные останутся в форме.</div> : null}
      {error ? <div className={styles.formError} role="alert"><strong>Обращение не отправлено</strong><p>{error}</p><p>После восстановления связи нажмите кнопку ещё раз. Ключ повтора сохранён.</p></div> : null}
      {success ? <div className={styles.formSuccess} role="status"><strong>Обращение принято</strong><p>{success.message}</p><p>Номер: {success.id}</p></div> : null}
      <form className={styles.stackForm} onSubmit={submit}>
        <label className={styles.field}>Имя<input name="name" required minLength={2} maxLength={160} autoComplete="name" /></label>
        <div className={styles.splitFields}>
          <label className={styles.field}>Email<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
          <label className={styles.field}>Телефон<input name="phone" type="tel" pattern="\+[1-9][0-9]{6,14}" placeholder="+79240000000" autoComplete="tel" /></label>
        </div>
        <p className={styles.fieldNote}>Укажите хотя бы один способ связи.</p>
        <label className={styles.field}>Сообщение<textarea name="message" required minLength={10} maxLength={4000} placeholder={messagePlaceholder ?? "Опишите ваш вопрос"} /></label>
        <label className={styles.checkboxField}><input name="consent" type="checkbox" required /> {CONTACT_PERSONAL_DATA_CONSENT_TEXT} <Link href="/contact-personal-data-consent" target="_blank">Открыть документ</Link>.</label>
        <button className={styles.submitButton} type="submit" disabled={pending || !online}>{pending ? "Отправляем..." : "Отправить обращение"}</button>
      </form>
      </>}
    </section>
  );
}
