"use client";

import Link from "next/link";

import styles from "../_components/catalog-showcase.module.css";
import { CATALOG_SEARCH_FORM_ID } from "./catalog-search-form";

export function CatalogStartPanel() {
  function focusSearch() {
    document.querySelector<HTMLInputElement>(`#${CATALOG_SEARCH_FORM_ID} input[name="q"]`)?.focus();
  }

  return (
    <section aria-labelledby="catalog-start-title" className={styles.utility}>
      <h2 id="catalog-start-title">С чего начнём?</h2>
      <div className={styles.serviceLinks}>
        <a href="#catalog-query" onClick={focusSearch}>Знаю название или артикул</a>
        <Link href="/chat">Спросить о запчасти в чате</Link>
      </div>
    </section>
  );
}
