import type { Metadata } from "next";
import { notFound } from "next/navigation";

import styles from "../_components/storefront.module.css";
import { storeContentPages } from "../_lib/legacy-pages";

interface LegacyPageProps {
  params: Promise<{ page: string }>;
}

export function generateStaticParams() {
  return Object.keys(storeContentPages).map((page) => ({ page }));
}

export async function generateMetadata({ params }: LegacyPageProps): Promise<Metadata> {
  const { page } = await params;
  const content = storeContentPages[page];
  return content ? { title: content.title, description: content.intro } : { title: "Страница не найдена" };
}

export default async function LegacyPage({ params }: LegacyPageProps) {
  const { page } = await params;
  const content = storeContentPages[page];
  if (!content) notFound();

  return (
    <article className={`${styles.page} ${styles.contentPage}`}>
      <header className={styles.pageTitle}>
        <h1>{content.title}</h1>
        <p>{content.intro}</p>
      </header>
      {content.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.body}</p>
          {section.links?.map((link) => <p key={link.href}><a href={link.href}>{link.label}</a></p>)}
        </section>
      ))}
    </article>
  );
}
