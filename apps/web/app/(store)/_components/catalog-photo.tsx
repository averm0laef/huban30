"use client";

import { Image24Regular, ZoomIn16Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useRef, useState } from "react";

import styles from "./catalog-photo.module.css";
import { PhotoViewer, type PreviewPhoto } from "./photo-viewer";

interface CatalogPhotoProps {
  alt?: string;
  categoryImage?: string | null;
  className?: string;
  noteClassName?: string;
  /** Paint the "no photo yet" note as a small label over the picture instead of a line under it. */
  noteInside?: boolean;
  preload?: boolean;
  preview?: true | { images: readonly PreviewPhoto[]; index: number };
  showNote?: boolean;
  sizes: string;
  src?: string | null;
  unoptimized?: boolean;
}

export function CatalogPhoto({
  alt = "", categoryImage, className, noteClassName, noteInside = false, preload, preview, showNote = true, sizes, src, unoptimized,
}: CatalogPhotoProps) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [viewer, setViewer] = useState<{ images: readonly PreviewPhoto[]; index: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const original = src && !failed.has(src) ? src : null;
  const image = original ?? (categoryImage && !failed.has(categoryImage) ? categoryImage : null);
  const frameClass = [styles.frame, className].filter(Boolean).join(" ");
  const previewImages = preview === true && original ? [{ alt, url: original }] : typeof preview === "object" ? preview.images : [];
  const content = (
    <>
      {image ? (
        <Image alt={original ? alt : ""} fill key={image} onError={() => setFailed((urls) => new Set([...urls, image]))}
          preload={preload} referrerPolicy="no-referrer" sizes={sizes} src={image} unoptimized={original ? unoptimized : undefined} />
      ) : <Image24Regular aria-hidden="true" className={styles.emptyIcon} />}
      {!original && showNote && noteInside ? (
        <small className={[styles.noteInside, noteClassName].filter(Boolean).join(" ")}>Фото товара пока нет</small>
      ) : null}
    </>
  );
  return (
    <>
      {original && preview ? (
        <button aria-haspopup="dialog" aria-label={alt ? `Увеличить фото: ${alt}` : "Увеличить фото товара"}
          className={`${frameClass} ${styles.preview}`} onClick={() => setViewer({ images: previewImages, index: preview === true ? 0 : preview.index })} ref={trigger} type="button">
          {content}
          <span className={styles.zoom}><ZoomIn16Regular aria-hidden="true" /></span>
        </button>
      ) : <span className={frameClass} data-photo-missing={original ? undefined : ""}>{content}</span>}
      {!original && showNote && !noteInside ? <small className={[styles.note, noteClassName].filter(Boolean).join(" ")}>Фото товара пока нет</small> : null}
      {viewer ? (
        <PhotoViewer images={viewer.images} initialIndex={viewer.index}
          onClose={() => {
            setViewer(null);
            trigger.current?.focus();
          }} />
      ) : null}
    </>
  );
}
