import { ServiceUnavailableException } from "@nestjs/common";

const MAX_CONCURRENT_PUBLIC_MEDIA_READS = 8;
const MAX_CONCURRENT_PUBLIC_CATALOG_QUERIES = 6;
let activePublicMediaReads = 0;
let activePublicCatalogQueries = 0;

export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//u, "");
    return normalized === "*" || normalized === etag;
  });
}

export async function withPublicMediaRead<T>(work: () => Promise<T>): Promise<T> {
  if (activePublicMediaReads >= MAX_CONCURRENT_PUBLIC_MEDIA_READS) {
    throw new ServiceUnavailableException("Сервис изображений временно занят");
  }
  activePublicMediaReads += 1;
  try {
    return await work();
  } finally {
    activePublicMediaReads -= 1;
  }
}

export async function withPublicCatalogQuery<T>(work: () => Promise<T>): Promise<T> {
  if (activePublicCatalogQueries >= MAX_CONCURRENT_PUBLIC_CATALOG_QUERIES) {
    throw new ServiceUnavailableException("Каталог временно занят");
  }
  activePublicCatalogQueries += 1;
  try {
    return await work();
  } finally {
    activePublicCatalogQueries -= 1;
  }
}
