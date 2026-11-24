"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { normalizeVin } from "../_lib/input-masks";
import { submitCatalogVin } from "../catalog/catalog-vin-submit";
import styles from "./catalog-showcase.module.css";

export function VinSelectionForm() {
  const router = useRouter();
  const inputId = useId();
  const [error, setError] = useState(false);
  const [length, setLength] = useState(0);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.querySelector<HTMLInputElement>("input");
    if (!input) return;

    const handled = submitCatalogVin(input.value, {
      navigate: (path) => router.push(path),
      saveVin: (key, value) => window.sessionStorage.setItem(key, value),
    });
    if (!handled) {
      setError(true);
      input.focus();
    }
  }

  return (
    <form className={styles.vinForm} action="/expert-help" onSubmit={submit}>
      <input
        aria-label="VIN автомобиля"
        aria-describedby={error ? `${inputId}-error` : `${inputId}-count`}
        aria-invalid={error || undefined}
        autoCapitalize="characters"
        autoComplete="off"
        className={styles.vinInput}
        maxLength={25}
        onChange={(event) => {
          // Capitals, no spaces; I, O, Q — never in a VIN — become 1 and 0 (board «Маски полей…»).
          const next = normalizeVin(event.target.value);
          if (next !== event.target.value) event.target.value = next;
          setLength(next.length);
          setError(false);
        }}
        placeholder="VIN из 17 символов"
        spellCheck={false}
        type="text"
      />
      {error
        ? <p id={`${inputId}-error`} className={styles.vinError}>Проверьте VIN. В нём 17 символов, без букв I, O и Q.</p>
        : <p id={`${inputId}-count`} className={styles.vinCount} data-done={length === 17 || undefined}>{length} / 17</p>}
      <button className={styles.vinSubmit} type="submit">Передать VIN специалисту</button>
    </form>
  );
}
