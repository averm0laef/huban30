"use client";

import { Camera20Regular } from "@fluentui/react-icons";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CatalogPhoto } from "../../../_components/catalog-photo";
import buttons from "../../../_components/store-button.module.css";
import { WheelLoader } from "../../../_components/wheel-loader";
import { FinderError } from "../../../_lib/parts-finder";
import { umapiGet, umapiStatus, type UmapiPhotos, type UmapiSpec } from "../../../_lib/umapi";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import styles from "./product-page.module.css";

/** The maker's photos and characteristics kept for the product after a customer asked for them (migration 0062). */
export interface KeptCatalogueCard { article: string; brand: string; photos: string[]; specs: UmapiSpec[]; title: string | null }

type CataloguePhotos =
  | { status: "off" | "idle" | "loading" }
  | { specs: UmapiSpec[]; status: "none" }
  | { message: string; retry: boolean; status: "error" }
  | { label: string; photos: string[]; specs: UmapiSpec[]; status: "ready" };

function keptState(card: KeptCatalogueCard | null): CataloguePhotos | null {
  if (!card) return null;
  if (card.photos.length > 0) return { label: `Фото производителя · ${card.brand} ${card.article}`, photos: card.photos, specs: card.specs, status: "ready" };
  return card.specs.length > 0 ? { specs: card.specs, status: "none" } : null;
}

/**
 * «Показать фото и характеристики»: the maker's photo and characteristics, on a press (docs/UMAPI_INTEGRATION.md).
 * Once a customer asked, they are kept for the product and come with the page.
 */
function useCataloguePhotos(productId: string, wanted: boolean, kept: KeptCatalogueCard | null) {
  const [state, setState] = useState<CataloguePhotos>(() => keptState(kept) ?? { status: "off" });
  const loading = useRef(false);

  useEffect(() => {
    if (!wanted || keptState(kept)) return undefined;
    let live = true;
    void umapiStatus().then((status) => {
      if (live && status.photos) setState({ status: "idle" });
    });
    return () => { live = false; };
  }, [kept, wanted]);

  async function load() {
    if (loading.current) return;
    loading.current = true;
    setState({ status: "loading" });
    try {
      const data = await umapiGet<UmapiPhotos>(`product/${encodeURIComponent(productId)}/photos`);
      if (data.status === "ok" && "photos" in data && data.photos.length > 0) {
        // An analogue standing in for a number without a card is named as such: the photo is of that analogue.
        const kind = data.part.through ? "Фото аналога" : "Фото производителя";
        setState({ label: `${kind} · ${data.part.brand} ${data.part.article}`, photos: [...new Set(data.photos)], specs: data.specs ?? [], status: "ready" });
      } else if (data.status === "ambiguous" || data.status === "unknown_part") {
        setState({ message: "Покажем эту деталь вживую", retry: false, status: "error" });
      } else {
        setState({ specs: "specs" in data ? data.specs ?? [] : [], status: "none" });
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

const SPECS_SHOWN = 6;

/** The maker's characteristics under the photo: the first few, the rest one tap away. */
function MakerSpecs({ specs }: { specs: UmapiSpec[] }) {
  if (specs.length === 0) return null;
  const rows = (list: UmapiSpec[]) => list.map((spec) => <div className={styles.makerSpec} key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>);
  return (
    <section aria-label="Характеристики производителя" className={styles.makerSpecs}>
      <h2>Характеристики производителя</h2>
      <dl>{rows(specs.slice(0, SPECS_SHOWN))}</dl>
      {specs.length > SPECS_SHOWN ? (
        <details>
          <summary>Все характеристики ({specs.length})</summary>
          <dl>{rows(specs.slice(SPECS_SHOWN))}</dl>
        </details>
      ) : null}
    </section>
  );
}

/**
 * The frame of a product without its own photo (Claude Design canvas «совместимость и аналоги», boards «Карточка v2»
 * and «Фото по запросу»): an invitation to look, not «no photo»; the button and every answer stay inside the frame.
 * Never another part's picture.
 */
function MissingPhoto({ article, ask, load, state }: { article: string; ask: ReactNode; load: () => void; state: CataloguePhotos }) {
  if (state.status === "loading") {
    return <div className={styles.photoEmpty} data-state="loading"><WheelLoader label="Ищем фото и характеристики…" /></div>;
  }
  if (state.status === "idle") {
    return (
      <div className={styles.photoEmpty}>
        <Camera20Regular aria-hidden="true" className={styles.photoInvite} />
        <p className={styles.photoTitle}>Посмотрите деталь вблизи</p>
        <p className={styles.photoText}>Покажем фото и характеристики от производителя по артикулу {article} — бесплатно, за пару секунд.</p>
        <button className={`${buttons.button} ${buttons.primary}`} onClick={load} type="button">
          <Camera20Regular aria-hidden="true" />Показать фото и характеристики
        </button>
      </div>
    );
  }
  if (state.status === "error" && state.retry) {
    return (
      <div className={styles.photoEmpty} role="alert">
        <p className={styles.photoTitle}>{state.message}</p>
        <p className={styles.photoText}>Так бывает на минуту-другую. Попробуйте ещё раз — или пришлём фото со склада.</p>
        <button className={`${buttons.button} ${buttons.primary}`} onClick={load} type="button">Повторить</button>
        {ask}
      </div>
    );
  }
  // Nothing in the catalogue, a part it cannot name, or no catalogue at all: the shop photographs it for the customer.
  return (
    <div className={styles.photoEmpty} role={state.status === "none" || state.status === "error" ? "status" : undefined}>
      <Camera20Regular aria-hidden="true" className={styles.photoInvite} />
      <p className={styles.photoTitle}>{state.status === "error" ? state.message : "Сфотографируем её для вас"}</p>
      <p className={styles.photoText}>Сделаем фото на складе и пришлём в чат — увидите деталь до покупки.</p>
      {ask}
    </div>
  );
}

export function ProductGallery({ article, catalogPhotos, images, kept = null, productId, requestMessage }: {
  article: string;
  catalogPhotos: boolean;
  images: GalleryImage[];
  kept?: KeptCatalogueCard | null;
  productId: string;
  requestMessage: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { load, state } = useCataloguePhotos(productId, catalogPhotos && images.length === 0, images.length === 0 ? kept : null);
  const fromCatalogue = state.status === "ready" && images.length === 0;
  const photos = fromCatalogue
    ? state.photos.map((url) => ({ alt: state.label, url }))
    : images.map(({ altText, url }) => ({ alt: altText, url }));
  const active = photos[activeIndex] ?? photos[0];
  const specs = state.status === "ready" || state.status === "none" ? state.specs : [];
  const askShop = (soft: boolean) => (
    <ExpertHelpQueryLink className={`${buttons.button} ${soft ? buttons.soft : buttons.quiet}`} prefillMessage={requestMessage}>
      {soft ? "Получить фото в чат" : "Попросить фото у магазина"}
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
              showNote={false}
              sizes="(max-width: 690px) 100vw, (max-width: 1050px) 50vw, 460px"
              src={active.url}
              unoptimized={fromCatalogue}
            />
            {fromCatalogue ? <span className={styles.photoBadge}>{state.label}</span> : null}
          </>
        ) : <MissingPhoto article={article} ask={askShop(state.status !== "error" || !state.retry)} load={() => { setActiveIndex(0); void load(); }} state={state} />}
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
      {fromCatalogue || state.status === "idle" || specs.length > 0 ? (
        <figcaption className={styles.photoActions}>
          {fromCatalogue ? <p className={styles.catalogueNote} role="status">Фото от производителя — нажмите, чтобы увеличить. Внешний вид детали на складе может отличаться.</p> : null}
          <MakerSpecs specs={specs} />
          {fromCatalogue || state.status === "idle" ? askShop(false) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
