"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { submitCatalogVin } from "../catalog/catalog-vin-submit";
import styles from "./catalog-showcase.module.css";

export function VinSelectionForm() {
  const router = useRouter();
  const inputId = useId();
  const [error, setError] = useState(false);

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
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error || undefined}
        autoCapitalize="characters"
        autoComplete="off"
        className={styles.vinInput}
        maxLength={25}
        onChange={() => setError(false)}
        placeholder="VIN из 17 символов"
        spellCheck={false}
        type="text"
      />
      {error && <p id={`${inputId}-error`} className={styles.vinError}>Проверьте VIN. В нём 17 символов, без букв I, O и Q.</p>}
      <button className={styles.vinSubmit} type="submit">Передать VIN специалисту</button>
    </form>
  );
}
