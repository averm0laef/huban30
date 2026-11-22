import Link from "next/link";
import type { ReactNode } from "react";

import { STORE_HOURS, STORE_PHONE, STORE_PHONE_DISPLAY } from "../../site-config";
import type { StoreContentSection } from "../_lib/legacy-pages";
import styles from "./content-page.module.css";

/**
 * Shared frame for every customer and legal page (/delivery, /returns,
 * /privacy…), from the «Шаблон» boards of the design canvas: breadcrumbs,
 * title and lead, optional key facts, a sticky contents list, the sections,
 * and one «Остались вопросы?» panel at the end. `variant="document"` sets the
 * sections as one numbered sheet (policies, offers, consents); `info` sets
 * each section as its own card.
 */
export function ContentPageFrame({ children, facts, intro, sections, title, trail, variant }: {
  children?: ReactNode;
  facts?: ReactNode;
  intro: string;
  sections: StoreContentSection[];
  title: string;
  trail: string;
  variant: "document" | "info";
}) {
  const anchors = sections.map((section, index) => ({ id: `section-${index + 1}`, ...section }));
  return (
    <article className={styles.page}>
      <nav aria-label="Хлебные крошки" className={styles.breadcrumbs}>
        <Link href="/">Главная</Link><span aria-hidden="true">›</span>
        <span>{trail}</span><span aria-hidden="true">›</span>
        <span aria-current="page">{title}</span>
      </nav>
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>
      {facts}
      {children}
      {anchors.length > 0 ? (
        <div className={anchors.length > 2 ? styles.withContents : styles.single}>
          {anchors.length > 2 ? (
            <nav aria-label={variant === "document" ? "Содержание" : "На странице"} className={styles.contents}>
              <strong>{variant === "document" ? "Содержание" : "На странице"}</strong>
              {anchors.map((section, index) => (
                <a href={`#${section.id}`} key={section.id}>{variant === "document" ? `${index + 1}. ` : ""}{section.heading}</a>
              ))}
            </nav>
          ) : null}
          {variant === "document" ? (
            <div className={styles.sheet}>
              {anchors.map((section, index) => (
                <section aria-labelledby={`${section.id}-title`} className={styles.sheetSection} id={section.id} key={section.id}>
                  <h2 id={`${section.id}-title`}><span>{index + 1}</span>{section.heading}</h2>
                  <p>{section.body}</p>
                  <SectionLinks links={section.links} />
                </section>
              ))}
            </div>
          ) : (
            <div className={styles.cards}>
              {anchors.map((section) => (
                <section aria-labelledby={`${section.id}-title`} className={styles.card} id={section.id} key={section.id}>
                  <h2 id={`${section.id}-title`}>{section.heading}</h2>
                  <p>{section.body}</p>
                  <SectionLinks links={section.links} />
                </section>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <HelpPanel />
    </article>
  );
}

function SectionLinks({ links }: { links?: StoreContentSection["links"] }) {
  if (!links?.length) return null;
  return (
    <p className={styles.links}>
      {links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
    </p>
  );
}

export function HelpPanel() {
  return (
    <aside aria-label="Помощь" className={styles.help}>
      <div>
        <strong>Остались вопросы?</strong>
        <span>Ответим {STORE_HOURS.replace("Ежедневно", "ежедневно")} — в чате, по телефону или в мессенджере.</span>
      </div>
      <div className={styles.helpActions}>
        <Link className={styles.helpPrimary} href="/chat">Написать в чат</Link>
        <a className={styles.helpSecondary} href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a>
      </div>
    </aside>
  );
}

/** Key facts row at the top of an info page; the first card is the highlighted one. */
export function FactCards({ items }: { items: Array<{ action?: { href: string; label: string; external?: boolean }; label: string; text: string; title: string }> }) {
  return (
    <section aria-label="Коротко" className={styles.facts}>
      {items.map((item, index) => (
        <div className={index === 0 ? `${styles.fact} ${styles.factPrimary}` : styles.fact} key={item.label}>
          <span className={styles.factLabel}>{item.label}</span>
          <strong>{item.title}</strong>
          <span className={styles.factText}>{item.text}</span>
          {item.action ? (
            item.action.external
              ? <a className={styles.factAction} href={item.action.href} rel="noreferrer" target="_blank">{item.action.label}</a>
              : <Link className={styles.factAction} href={item.action.href}>{item.action.label}</Link>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/** Numbered «как это работает» steps. */
export function StepRow({ steps, title }: { steps: Array<{ text: string; title: string }>; title: string }) {
  return (
    <section aria-labelledby="steps-title" className={styles.steps}>
      <h2 id="steps-title">{title}</h2>
      <ol>
        {steps.map((step, index) => (
          <li key={step.title}><span aria-hidden="true">{index + 1}</span><strong>{step.title}</strong><small>{step.text}</small></li>
        ))}
      </ol>
    </section>
  );
}
