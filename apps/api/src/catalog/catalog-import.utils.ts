import { createHash, timingSafeEqual } from "node:crypto";

import type { OneCCatalogRow } from "@an30/contracts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest();
}

/** A row the way the site keeps it: the 1С code only pairs a product with a loaded one and is not stored with it. */
export function storedCatalogRow(row: OneCCatalogRow): OneCCatalogRow {
  if (row.entityType !== "product" || row.oneCCode === undefined) return row;
  const stored = { ...row };
  delete stored.oneCCode;
  return stored;
}

export function rowIdentity(row: OneCCatalogRow): string {
  switch (row.entityType) {
    case "price":
      return `price:${row.productExternalId}:${row.currency}`;
    case "stock":
      return `stock:${row.productExternalId}:${row.warehouseExternalId}`;
    default:
      return `${row.entityType}:${row.externalId}`;
  }
}

export function rowExternalId(row: OneCCatalogRow): string {
  switch (row.entityType) {
    case "price":
      return `${row.productExternalId}:${row.currency}`;
    case "stock":
      return `${row.productExternalId}:${row.warehouseExternalId}`;
    default:
      return row.externalId;
  }
}

export function safeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function parseBasicAuthorization(header: string | undefined): {
  password: string;
  username: string;
} | null {
  if (!header?.startsWith("Basic ")) return null;
  const encoded = header.slice(6).trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return {
      password: decoded.slice(separator + 1),
      username: decoded.slice(0, separator),
    };
  } catch {
    return null;
  }
}
