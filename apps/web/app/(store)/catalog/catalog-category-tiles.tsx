"use client";

import { Apps24Regular } from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";

import type { CatalogSectionTile } from "../_lib/store-categories";
import styles from "./catalog-layout.module.css";

/** How many tiles a phone or a tablet shows before «Все разделы» (the CSS hides the rest on those widths). */
const COLLAPSED_COUNT = 8;

export function CatalogCategoryTiles({ tiles }: { tiles: CatalogSectionTile[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  return (
    <nav aria-label="Разделы каталога" className={styles.categoryNav}>
      <div className={styles.categoryTiles} data-expanded={expanded ? "" : undefined} id={listId}>
        {tiles.map(({ href, image, key, label }) => (
          <Link className={styles.categoryTile} href={href} key={key}>
            {image
              ? <Image alt="" height={60} sizes="90px" src={image} width={90} />
              : <Apps24Regular aria-hidden="true" className={styles.categoryTileIcon} />}
            <span>{label}</span>
          </Link>
        ))}
      </div>
      {tiles.length > COLLAPSED_COUNT && (
        <button aria-controls={listId} aria-expanded={expanded} className={styles.categoryTilesMore} type="button"
          onClick={() => setExpanded(value => !value)}>
          {expanded ? "Свернуть разделы" : `Все разделы (${tiles.length})`}
        </button>
      )}
    </nav>
  );
}
