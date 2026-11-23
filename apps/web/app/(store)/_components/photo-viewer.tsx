"use client";

import { ChevronLeft24Regular, ChevronRight24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import styles from "./photo-viewer.module.css";

export interface PreviewPhoto {
  alt: string;
  url: string;
}

export function PhotoViewer({ images, initialIndex, onClose }: {
  images: readonly PreviewPhoto[];
  initialIndex: number;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const active = images[index];
  const multiple = images.length > 1;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  function step(direction: 1 | -1) {
    setIndex((current) => (current + direction + images.length) % images.length);
  }

  function navigate(event: KeyboardEvent<HTMLDialogElement>) {
    if (!multiple || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  }

  return (
    <dialog aria-label="Просмотр фотографий" className={styles.dialog} onClose={onClose} onKeyDown={navigate} ref={dialog}>
      <div className={styles.controls}>
        {multiple ? <span aria-live="polite">{index + 1} из {images.length}</span> : <span>Фото товара</span>}
        <button aria-label="Закрыть фото" onClick={() => dialog.current?.close()} type="button">
          <Dismiss24Regular aria-hidden="true" />
        </button>
      </div>
      <div className={styles.stage}>
        {active && !failed.has(active.url) ? (
          <Image alt={active.alt} fill key={active.url}
            onError={() => setFailed((urls) => new Set([...urls, active.url]))}
            referrerPolicy="no-referrer" sizes="(max-width: 900px) 100vw, 880px" src={active.url} unoptimized />
        ) : <p role="status">Не удалось загрузить фото.</p>}
      </div>
      {multiple ? (
        <div className={styles.navigation}>
          <button aria-label="Предыдущее фото" onClick={() => step(-1)} type="button"><ChevronLeft24Regular aria-hidden="true" /></button>
          <button aria-label="Следующее фото" onClick={() => step(1)} type="button"><ChevronRight24Regular aria-hidden="true" /></button>
        </div>
      ) : null}
    </dialog>
  );
}
