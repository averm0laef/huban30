"use client";

import { Image20Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandWheel } from "../../../_components/brand-mark";
import { CatalogPhoto } from "../../../_components/catalog-photo";
import buttons from "../../../_components/store-button.module.css";
import { WheelLoader } from "../../../_components/wheel-loader";
import { FinderError } from "../../../_lib/parts-finder";
import { umapiGet, umapiStatus, type UmapiPhotos } from "../../../_lib/umapi";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import styles from "./product-page.module.css";

type CataloguePhotos =
  | { status: "off" | "idle" | "loading" | "none" }
  | { message: string; retry: boolean; status: "error" }
  | { label: string; photos: string[]; status: "ready" };

/** «Показать фото детали»: the maker's photo from the catalogue, on a press, for a product without its own photo. */
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
        setState({ label: `${data.part.brand} ${data.part.article}`, photos: [...new Set(data.photos)], status: "ready" });
      } else if (data.status === "ambiguous" || data.status === "unknown_part") {
        setState({ message: "Не удалось точно определить деталь в каталоге", retry: false, status: "error" });
      } else {
        setState({ status: "none" });
      }
    } catch (error) {
      const limited = error instanceof FinderError && error.status === 429;
      setState({ message: limited ? error.message : "Каталог сейчас не отвечает", retry: true, status: "error" });
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

/**
 * The frame of a product without its own photo (Claude Design canvas «совместимость и аналоги», «Карточка v2»): the
 * button is inside the frame, where the customer looks for the picture, and every answer appears in the same place.
 * Never another part's picture.
 */
function MissingPhoto({ ask, load, state }: { ask: ReactNode; load: () => void; state: CataloguePhotos }) {
  if (state.status === "loading") {
    return <div className={styles.photoEmpty} data-state="loading"><WheelLoader label="Ищем фото…" /></div>;
  }
  if (state.status === "idle") {
    return (
      <div className={styles.photoEmpty}>
        <BrandWheel className={styles.photoGhost} />
        <p className={styles.photoTitle}>Своего фото у товара пока нет</p>
        <p className={styles.photoText}>Покажем фото этой детали от производителя — по артикулу, за пару секунд.</p>
        <button className={`${buttons.button} ${buttons.primary}`} onClick={load} type="button">
          <Image20Regular aria-hidden="true" />Показать фото детали
        </button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={styles.photoEmpty} role="alert">
        <p className={styles.photoTitle}>{state.message}</p>
        <p className={styles.photoText}>{state.retry ? "Так бывает на минуту-другую. Попробуйте ещё раз." : "Сфотографируем деталь на складе и пришлём в чат."}</p>
        {state.retry ? <button className={`${buttons.button} ${buttons.primary}`} onClick={load} type="button">Повторить</button> : null}
        {ask}
      </div>
    );
  }
  return (
    <div className={styles.photoEmpty} role={state.status === "none" ? "status" : undefined}>
      {state.status === "none" ? null : <BrandWheel className={styles.photoGhost} />}
      <p className={styles.photoTitle}>{state.status === "none" ? "У производителя фото нет" : "Своего фото у товара пока нет"}</p>
      <p className={styles.photoText}>Сфотографируем деталь на складе и пришлём в чат.</p>
      {ask}
    </div>
  );
}

export function ProductGallery({ catalogPhotos, images, productId, requestMessage }: {
  catalogPhotos: boolean;
  images: GalleryImage[];
  productId: string;
  requestMessage: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { load, state } = useCataloguePhotos(productId, catalogPhotos && images.length === 0);
  const fromCatalogue = state.status === "ready";
  const photos = fromCatalogue
    ? state.photos.map((url) => ({ alt: `Фото производителя: ${state.label}`, url }))
    : images.map(({ altText, url }) => ({ alt: altText, url }));
  const active = photos[activeIndex] ?? photos[0];
  const askShop = (soft: boolean) => (
    <ExpertHelpQueryLink className={`${buttons.button} ${soft ? buttons.soft : buttons.quiet}`} prefillMessage={requestMessage}>
      Попросить фото у магазина
    </ExpertHelpQueryLink>
  );

  return (
    <figure className={styles.gallery} data-multiple={photos.length > 1}>
      <div className={styles.galleryMain}>
        {active ? (
          <>
            <CatalogPhoto
              alt={active.alt}
              className={styles.galleryPhoto}
              noteInside
              preload={!fromCatalogue && activeIndex === 0}
              preview={{ images: photos, index: activeIndex }}
              sizes="(max-width: 690px) 100vw, (max-width: 1050px) 50vw, 460px"
              src={active.url}
              unoptimized={fromCatalogue}
            />
            {fromCatalogue ? <span className={styles.photoBadge}>Фото производителя · {state.label}</span> : null}
          </>
        ) : <MissingPhoto ask={askShop(state.status !== "error")} load={() => { setActiveIndex(0); void load(); }} state={state} />}
      </div>
      {photos.length > 1 ? (
        <div className={styles.thumbs} role="group" aria-label={fromCatalogue ? "Фото производителя" : "Фотографии товара"}>
          {photos.map((photo, index) => (
            <button aria-label={`Фото ${index + 1} из ${photos.length}`} aria-pressed={index === activeIndex}
              className={styles.thumb} key={fromCatalogue ? photo.url : images[index]?.id} onClick={() => setActiveIndex(index)} type="button">
              <Image alt="" fill referrerPolicy="no-referrer" sizes="64px" src={photo.url} unoptimized={fromCatalogue} />
            </button>
          ))}
        </div>
      ) : null}
      {fromCatalogue ? (
        <figcaption className={styles.photoActions}>
          <p className={styles.catalogueNote} role="status">Внешний вид детали на складе может отличаться.</p>
          {askShop(false)}
        </figcaption>
      ) : state.status === "idle" ? <figcaption className={styles.photoActions}>{askShop(false)}</figcaption> : null}
    </figure>
  );
}
