"use client";

import { Image20Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { CatalogPhoto } from "../../../_components/catalog-photo";
import buttons from "../../../_components/store-button.module.css";
import { WheelLoader } from "../../../_components/wheel-loader";
import { FinderError } from "../../../_lib/parts-finder";
import { umapiGet, umapiStatus, type UmapiPhotos } from "../../../_lib/umapi";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import styles from "./product-page.module.css";

type CataloguePhotos =
  | { status: "off" | "idle" | "loading" | "none" }
  | { message: string; status: "error" }
  | { note: string; photos: string[]; status: "ready" };

function useCataloguePhotos(productId: string, wanted: boolean) {
  const [state, setState] = useState<CataloguePhotos>({ status: "off" });
  const loading = useRef(false);

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    void umapiStatus().then((status) => {
      if (live && status.photos) setState({ status: "idle" });
    });
    return () => { live = false; };
  }, [wanted]);

  async function load() {
    if (loading.current) return;
    loading.current = true;
    setState({ status: "loading" });
    try {
      const data = await umapiGet<UmapiPhotos>(`product/${encodeURIComponent(productId)}/photos`);
      if (data.status === "ok" && "photos" in data && data.photos.length > 0) {
        const via = data.part.via === "own" ? "" : " · номер-аналог из названия";
        const note = `Фото из каталога: ${data.part.brand} ${data.part.article}${via}. Внешний вид детали на складе может отличаться.`;
        setState({ note, photos: [...new Set(data.photos)], status: "ready" });
      } else if (data.status === "ambiguous" || data.status === "unknown_part") {
        setState({ message: "В каталоге не удалось однозначно определить деталь.", status: "error" });
      } else {
        setState({ status: "none" });
      }
    } catch (error) {
      setState({ message: error instanceof FinderError ? error.message : "Фото сейчас не загрузить.", status: "error" });
    } finally {
      loading.current = false;
    }
  }

  return { load, state };
}

export interface GalleryImage {
  altText: string;
  id: string;
  url: string;
}

export function ProductGallery({ catalogPhotos, categoryImage, images, productId, requestMessage }: {
  catalogPhotos: boolean;
  categoryImage: string | null;
  images: GalleryImage[];
  productId: string;
  requestMessage: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { load, state } = useCataloguePhotos(productId, catalogPhotos && images.length === 0);
  const fromCatalogue = state.status === "ready";
  const photos = fromCatalogue
    ? state.photos.map((url) => ({ alt: "Фото детали из каталога", url }))
    : images.map(({ altText, url }) => ({ alt: altText, url }));
  const active = photos[activeIndex] ?? photos[0];

  return (
    <figure className={styles.gallery} data-multiple={photos.length > 1}>
      <div className={styles.galleryMain}>
        <CatalogPhoto
          alt={active?.alt}
          categoryImage={categoryImage}
          className={styles.galleryPhoto}
          noteInside
          preload={Boolean(active) && !fromCatalogue && activeIndex === 0}
          preview={{ images: photos, index: activeIndex }}
          sizes="(max-width: 690px) 100vw, (max-width: 1050px) 50vw, 460px"
          src={active?.url}
          unoptimized={fromCatalogue}
        />
      </div>
      {photos.length > 1 ? (
        <div className={styles.thumbs} role="group" aria-label={fromCatalogue ? "Фото из каталога" : "Фотографии товара"}>
          {photos.map((photo, index) => (
            <button aria-label={`Фото ${index + 1} из ${photos.length}`} aria-pressed={index === activeIndex}
              className={styles.thumb} key={fromCatalogue ? photo.url : images[index]?.id} onClick={() => setActiveIndex(index)} type="button">
              <Image alt="" fill referrerPolicy="no-referrer" sizes="64px" src={photo.url} unoptimized={fromCatalogue} />
            </button>
          ))}
        </div>
      ) : null}
      <figcaption className={styles.photoActions}>
        {state.status === "loading" ? <WheelLoader label="Ищем фото в каталоге…" /> : null}
        {state.status === "ready" ? <p className={styles.catalogueNote} role="status">{state.note}</p> : null}
        {state.status === "none" ? <p className={styles.catalogueNote} role="status">В каталоге нет фото детали.</p> : null}
        {state.status === "error" ? <p className={styles.catalogueNote} role="alert">{state.message}</p> : null}
        {state.status === "idle" || state.status === "ready" || state.status === "none" || state.status === "error" ? (
          <button className={`${buttons.button} ${buttons.soft}`} onClick={() => { setActiveIndex(0); void load(); }} type="button">
            <Image20Regular aria-hidden="true" /> {state.status === "ready" ? "Обновить фото из каталога" : state.status === "idle" ? "Показать фото из каталога" : "Повторить поиск фото"}
          </button>
        ) : null}
        <ExpertHelpQueryLink className={`${buttons.button} ${buttons.quiet}`} prefillMessage={requestMessage}>
          Запросить фото со склада
        </ExpertHelpQueryLink>
      </figcaption>
    </figure>
  );
}
