"use client";

import { Image24Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useState } from "react";

import styles from "./catalog-photo.module.css";

interface CatalogPhotoProps {
  alt?: string;
  categoryImage?: string | null;
  className?: string;
  noteClassName?: string;
  /** Paint the "no photo yet" note as a small label over the picture instead of a line under it. */
  noteInside?: boolean;
  preload?: boolean;
  showNote?: boolean;
  sizes: string;
  src?: string | null;
}

export function CatalogPhoto({ alt = "", categoryImage, className, noteClassName, noteInside = false, preload, showNote = true, sizes, src }: CatalogPhotoProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const isOriginal = Boolean(src && failed !== src);
  const image = isOriginal ? src : categoryImage;
  return (
    <>
      <span className={[styles.frame, className].filter(Boolean).join(" ")} data-photo-missing={isOriginal ? undefined : ""}>
        {image ? <Image alt={isOriginal ? alt : ""} src={image} fill sizes={sizes} preload={preload}
          onError={isOriginal && src ? () => setFailed(src) : undefined} />
          : <Image24Regular aria-hidden="true" className={styles.emptyIcon} />}
        {!isOriginal && showNote && noteInside
          ? <small className={[styles.noteInside, noteClassName].filter(Boolean).join(" ")}>Фото товара пока нет</small>
          : null}
      </span>
      {!isOriginal && showNote && !noteInside ? <small className={[styles.note, noteClassName].filter(Boolean).join(" ")}>Фото товара пока нет</small> : null}
    </>
  );
}
