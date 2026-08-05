"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION } from "@an30/contracts";
import type { SupplierWaitlistCreated } from "@an30/contracts";

import { formatRubles } from "../_lib/catalog-format";
import { clearIdempotencyKey, stableIdempotencyKey } from "../_lib/idempotency";
import { apiRequest, errorText } from "../_lib/storefront-api";
import styles from "../_components/storefront.module.css";

/**
 * Everything the dialog needs to build a `/suppliers/waitlist` request for
 * one stock line — the server re-resolves price/delivery from its own
 * trusted supplier lookup (see `SupplierWaitlistService.create`), this is
 * only what the customer picked and what the dialog shows them while they
 * fill in the form.
 */
export interface SupplierWaitlistTarget {
  brand: string;
  deliveryTime: string | null;
  guid: string;
  name: string;
  partNumber: string;
  priceKopeks: number;
  query: string;
  quantityAvailable: number;
  stockId: string;
}

interface SupplierWaitlistDialogProps {
  onClose: () => void;
  target: SupplierWaitlistTarget | null;
}

function optional(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

/**
 * Single shared dialog for every "В ожидание" button in the supplier
 * results list — mirrors `CartPanel`'s native-`<dialog>` open/close pattern
 * in cart-actions.tsx. One instance is mounted once by `SupplierResults` and
 * driven entirely by `target`, so clicking a different stock's button just
 * swaps the dialog's content instead of mounting a dialog per row.
 */
export function SupplierWaitlistDialog({ onClose, target }: SupplierWaitlistDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SupplierWaitlistCreated | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      setError("");
      setSuccess(null);
      dialog.showModal();
    }
    if (!target && dialog.open) dialog.close();
  }, [target]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const request = {
      consent: form.get("consent") === "on",
      contact: {
        email: optional(form.get("email")),
        name: String(form.get("name") ?? "").trim(),
        phone: optional(form.get("phone")),
      },
      partGuid: target.guid,
      policyVersion: SUPPLIER_WAITLIST_CONSENT_POLICY_VERSION,
      quantity: Number(form.get("quantity") ?? 1),
      query: target.query,
      source: "rossko" as const,
      stockId: target.stockId,
    };
    setPending(true);
    setError("");
    try {
      if (!request.contact.email && !request.contact.phone) throw new Error("Укажите email или телефон для ответа");
      const namespace = `supplier-waitlist:${target.guid}:${target.stockId}`;
      const idempotencyKey = await stableIdempotencyKey(window.sessionStorage, namespace, request);
      const response = await apiRequest<SupplierWaitlistCreated>("/suppliers/waitlist", {
        body: { ...request, idempotencyKey },
        method: "POST",
      });
      clearIdempotencyKey(window.sessionStorage, namespace);
      setSuccess(response);
      element.reset();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  const quantityCap = Math.min(Math.max(target?.quantityAvailable ?? 1, 1), 100);

  return (
    <dialog
      aria-labelledby="supplier-waitlist-title"
      className={styles.supplierWaitlistDialog}
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      {target ? (
        <>
          <div className={styles.supplierWaitlistDialogHead}>
            <h2 id="supplier-waitlist-title">Встать в ожидание</h2>
            <button aria-label="Закрыть" onClick={onClose} type="button">Закрыть</button>
          </div>
          <p className={styles.supplierWaitlistDialogPart}>
            {target.brand} · Артикул {target.partNumber}<br />
            {target.name}
          </p>
          <p className={styles.supplierWaitlistDialogPrice}>
            {formatRubles(target.priceKopeks)} за шт. · под заказ у поставщика
            {target.deliveryTime ? `, срок ${target.deliveryTime}` : ""}
          </p>

          {error ? (
            <div className={styles.formError} role="alert">
              <strong>Заявка не отправлена</strong>
              <p>{error}</p>
            </div>
          ) : null}

          {success ? (
            <div className={styles.formSuccess} role="status">
              <strong>Заявка принята</strong>
              <p>{success.message}</p>
              <p>Номер: {success.id}</p>
            </div>
          ) : (
            <form className={styles.stackForm} onSubmit={submit}>
              <label className={styles.field}>Имя<input autoComplete="name" maxLength={160} minLength={2} name="name" required /></label>
              <div className={styles.splitFields}>
                <label className={styles.field}>Email<input autoComplete="email" maxLength={254} name="email" type="email" /></label>
                <label className={styles.field}>Телефон<input autoComplete="tel" name="phone" pattern="\+[1-9][0-9]{6,14}" placeholder="+79240000000" type="tel" /></label>
              </div>
              <p className={styles.fieldNote}>Укажите хотя бы один способ связи.</p>
              <label className={styles.field}>Количество<input defaultValue={1} max={quantityCap} min={1} name="quantity" type="number" /></label>
              <label className={styles.checkboxField}>
                <input name="consent" required type="checkbox" />
                Я даю согласие на обработку указанных данных для заявки на ожидание и ознакомился с <Link href="/privacy" target="_blank">политикой конфиденциальности</Link>.
              </label>
              <button className={styles.submitButton} disabled={pending} type="submit">{pending ? "Отправляем..." : "Встать в ожидание"}</button>
            </form>
          )}
        </>
      ) : null}
    </dialog>
  );
}
