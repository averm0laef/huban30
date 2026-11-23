"use client";

import { Image20Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useEffect, useState } from "react";

import { CatalogPhoto } from "../../../_components/catalog-photo";
import buttons from "../../../_components/store-button.module.css";
import { WheelLoader } from "../../../_components/wheel-loader";
import { FinderError } from "../../../_lib/parts-finder";
import { umapiGet, umapiStatus, type UmapiPhotos } from "../../../_lib/umapi";
import styles from "./product-page.module.css";

type CataloguePhotos =
  | { status: "off" | "idle" | "loading" | "none" }
  | { message: string; status: "error" }
  | { index: number; note: string; photos: string[]; status: "ready" };

/**
 * «Показать фото из каталога» (Claude Design canvas «совместимость и аналоги», «Фото из каталога»): a product without
 * a photo of its own may show the catalogue's photo of the part, on a button — one UMAPI request, never on opening the
 * page. While it loads, the logo's wheel turns, as on the 404 page.
 */
function useCataloguePhotos(productId: string, wanted: boolean) {
  const [state, setState] = useState<CataloguePhotos>({ status: "off" });
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    void umapiStatus().then((status) => { if (live && status.photos) setState({ status: "idle" }); });
    return () => { live = false; };
  }, [wanted]);
  function load() {
    setState({ status: "loading" });
    umapiGet<UmapiPhotos>(`product/${encodeURIComponent(productId)}/photos`)
      .then((data) => {
        if (data.status === "ok" && "photos" in data && data.photos.length > 0) {
          const via = data.part.via === "own" ? "" : " — номер-аналог из названия";
          setState({ index: 0, note: `Фото из каталога: ${data.part.brand} ${data.part.article}${via}. Внешний вид товара на складе может отличаться.`, photos: data.photos, status: "ready" });
        } else setState({ status: "none" });
      })
      .catch((caught: unknown) => setState({ message: caught instanceof FinderError ? caught.message : "Фото сейчас не загрузить.", status: "error" }));
  }
  return { load, setState, state };
}

export interface GalleryImage {
  altText: string;
  id: string;
  url: string;
}

/**
 * Main photo plus thumbnails. With one photo (or none) it is just the photo;
 * thumbnails appear only when there is something to switch between.
 */
export function ProductGallery({ catalogPhotos = false, categoryImage, images, productId }: {
  /** The product may be looked up in the parts catalogue (umapiCatalogueApplies). */
  catalogPhotos?: boolean;
  categoryImage: string | null;
  images: GalleryImage[];
  productId?: string;
}) {
  const [activeId, setActiveId] = useState(images[0]?.id ?? "");
  const active = images.find((image) => image.id === activeId) ?? images[0];
  const catalogue = useCataloguePhotos(productId ?? "", Boolean(productId) && catalogPhotos && images.length === 0);
  const shown = catalogue.state.status === "ready" ? catalogue.state : null;

  return (
    <figure className={styles.gallery} data-multiple={images.length > 1 || (shown !== null && shown.photos.length > 1)}>
      <div className={styles.galleryMain}>
        {shown ? (
          <div className={styles.cataloguePhoto}>
            {/* An address on the catalogue's media host: shown as it is, not through the site's image optimiser. */}
            <img alt="Фото детали из каталога" src={shown.photos[shown.index]} />
          </div>
        ) : catalogue.state.status === "loading" ? (
          <div className={styles.cataloguePhoto}><WheelLoader label="Ищем фото в каталоге…" /></div>
        ) : (
        <CatalogPhoto
          alt={active?.altText}
          categoryImage={categoryImage}
          className={styles.galleryPhoto}
          noteInside
          preload
          sizes="(max-width: 690px) 100vw, (max-width: 1050px) 50vw, 460px"
          src={active?.url}
        />
        )}
        {catalogue.state.status === "idle" ? (
          <button className={`${buttons.button} ${buttons.soft} ${styles.catalogueButton}`} onClick={catalogue.load} type="button">
            <Image20Regular aria-hidden="true" /> Показать фото из каталога
          </button>
        ) : null}
      </div>
      {shown ? <figcaption className={styles.catalogueNote}>{shown.note}</figcaption> : null}
      {catalogue.state.status === "none" ? <figcaption className={styles.catalogueNote}>В каталоге фото нет. <a href="/chat">Попросить фото со склада в чате</a></figcaption> : null}
      {catalogue.state.status === "error" ? <figcaption className={styles.catalogueNote} role="alert">{catalogue.state.message}</figcaption> : null}
      {shown && shown.photos.length > 1 ? (
        <div className={styles.thumbs} role="group" aria-label="Фото из каталога">
          {shown.photos.map((photo, index) => (
            <button aria-label={`Фото ${index + 1} из ${shown.photos.length}`} aria-pressed={index === shown.index} className={styles.thumb} key={photo}
              onClick={() => catalogue.setState({ ...shown, index })} type="button">
              <img alt="" src={photo} />
            </button>
          ))}
        </div>
      ) : null}
      {images.length > 1 ? (
        <div className={styles.thumbs} role="group" aria-label="Фотографии товара">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={styles.thumb}
              aria-pressed={image.id === active?.id}
              aria-label={`Фото ${index + 1} из ${images.length}`}
              onClick={() => setActiveId(image.id)}
            >
              <Image alt="" fill sizes="64px" src={image.url} />
            </button>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
