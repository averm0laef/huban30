"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./product-page.module.css";

interface ProductDetailPanel {
  id: string;
  label: string;
  content: ReactNode;
}

export function ProductDetails({ panels }: { panels: ProductDetailPanel[] }) {
  const prefix = useId();
  const [selected, setSelected] = useState(panels[0]?.id ?? "");
  const active = panels.find(panel => panel.id === selected);
  if (!active) return null;

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = panels.length - 1;
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? last
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : -1;
    const next = panels[nextIndex];
    if (!next) return;
    event.preventDefault();
    setSelected(next.id);
    document.getElementById(`${prefix}-tab-${next.id}`)?.focus();
  }

  return (
    <section className={styles.details} aria-label="Информация о товаре">
      <div className={styles.tabs} role="tablist" aria-label="Информация о товаре">
        {panels.map((panel, index) => (
          <button
            aria-controls={`${prefix}-panel-${panel.id}`}
            aria-selected={panel.id === selected}
            id={`${prefix}-tab-${panel.id}`}
            key={panel.id}
            onClick={() => setSelected(panel.id)}
            onKeyDown={event => handleKeys(event, index)}
            role="tab"
            tabIndex={panel.id === selected ? 0 : -1}
            type="button"
          >
            {panel.label}
          </button>
        ))}
      </div>
      {panels.map(panel => (
        <div aria-labelledby={`${prefix}-tab-${panel.id}`} key={panel.id} hidden={panel.id !== active.id}
          id={`${prefix}-panel-${panel.id}`} role="tabpanel" tabIndex={0} className={styles.detailPanel}>
          {panel.content}
        </div>
      ))}
    </section>
  );
}
