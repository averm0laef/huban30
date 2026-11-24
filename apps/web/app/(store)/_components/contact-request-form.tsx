"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  CONTACT_CONSENT_POLICY_VERSION,
  CONTACT_PERSONAL_DATA_CONSENT_TEXT,
} from "@an30/contracts";

import { clearIdempotencyKey, stableIdempotencyKey } from "../_lib/idempotency";
import { catalogQueryPrefillMessage, EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY, EXPERT_HELP_PRODUCT_STORAGE_KEY } from "../_lib/expert-help-prefill";
import { EXPERT_HELP_VIN_STORAGE_KEY, isValidVin } from "../_lib/vin";
import { apiRequest, errorText } from "../_lib/storefront-api";
import styles from "./storefront.module.css";
import { notify } from "../_lib/toast";
import { EmailField, PhoneField } from "./masked-fields";

interface ContactResponse {
  createdAt: string;
  id: string;
  message: string;
  replayed: boolean;
  status: string;
}

interface ContactRequestFormProps {
  className?: string;
  description: string;
  /** Shown instead of the generic notice while the form is switched off. */
  disabledFallback?: ReactNode;
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
  className,
  description,
  disabledFallback,
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

  useEffect(() => {
    if (!enabled || (source !== "vin_request" && source !== "expert_help")) return;
    const message = document.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
    if (!message || message.value) return;
    try {
      const vin = source === "vin_request" ? window.sessionStorage.getItem(EXPERT_HELP_VIN_STORAGE_KEY) : null;
      const query = window.sessionStorage.getItem(EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY);
      const productPrefill = window.sessionStorage.getItem(EXPERT_HELP_PRODUCT_STORAGE_KEY);
      if (!vin && !query && !productPrefill) return;
      if (vin) window.sessionStorage.removeItem(EXPERT_HELP_VIN_STORAGE_KEY);
      if (query) window.sessionStorage.removeItem(EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY);
      if (productPrefill) window.sessionStorage.removeItem(EXPERT_HELP_PRODUCT_STORAGE_KEY);
      const validVin = vin && isValidVin(vin) ? vin.toUpperCase() : null;
      if (!validVin && !query && !productPrefill) return;
      message.value = validVin ? `VIN: ${validVin}\nНужная деталь: ` : productPrefill ?? catalogQueryPrefillMessage(query ?? "");
      message.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
      // The form remains fully usable when browser storage is restricted.
    }
  }, [enabled, source]);

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
      notify({ kind: "success", text: "Менеджер свяжется с вами удобным способом.", title: `Обращение ${response.id.slice(0, 8).toUpperCase()} принято` });
      element.reset();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={className ? `${styles.formPanel} ${className}` : styles.formPanel} aria-labelledby={`contact-form-${source}`}>
      <h2 id={`contact-form-${source}`}>{title}</h2><p>{description}</p>
      {!enabled && disabledFallback ? disabledFallback : null}
      {!enabled && !disabledFallback ? (
        <div className={styles.offlineNotice} role="status">
          Онлайн-форма откроется после публикации утверждённой политики обработки данных.
          Пока свяжитесь с магазином по телефону, указанному на странице.
        </div>
      ) : null}
      {!enabled ? null : <>
      {!online ? <div className={styles.offlineNotice} role="status">Нет подключения к сети. Заполненные данные останутся в форме.</div> : null}
      {error ? <div className={styles.formError} role="alert"><strong>Обращение не отправлено</strong><p>{error}</p><p>После восстановления связи нажмите кнопку ещё раз. Ключ повтора сохранён.</p></div> : null}
      {success ? <div className={styles.formSuccess} role="status"><strong>Обращение принято</strong><p>{success.message}</p><p>Номер обращения: <strong>{success.id.slice(0, 8).toUpperCase()}</strong></p></div> : null}
      <form className={styles.stackForm} onSubmit={submit}>
        <label className={styles.field}>Имя<input name="name" required minLength={2} maxLength={160} autoComplete="name" /></label>
        <div className={styles.splitFields}>
          <label className={styles.field}>Email<EmailField name="email" maxLength={254} /></label>
          <label className={styles.field}>Телефон<PhoneField name="phone" /></label>
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
