"use client";

import Image from "next/image";
import { useState } from "react";

import { CatalogPhoto } from "../../../_components/catalog-photo";
import styles from "./product-page.module.css";

export interface GalleryImage {
  altText: string;
  id: string;
  url: string;
}

/**
 * Main photo plus thumbnails. With one photo (or none) it is just the photo;
 * thumbnails appear only when there is something to switch between.
 */
export function ProductGallery({ images, categoryImage }: { images: GalleryImage[]; categoryImage: string | null }) {
  const [activeId, setActiveId] = useState(images[0]?.id ?? "");
  const active = images.find((image) => image.id === activeId) ?? images[0];

  return (
    <figure className={styles.gallery} data-multiple={images.length > 1}>
      <div className={styles.galleryMain}>
        <CatalogPhoto
          alt={active?.altText}
          categoryImage={categoryImage}
          className={styles.galleryPhoto}
          noteInside
          preload
          sizes="(max-width: 690px) 100vw, (max-width: 1050px) 50vw, 460px"
          src={active?.url}
        />
      </div>
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
