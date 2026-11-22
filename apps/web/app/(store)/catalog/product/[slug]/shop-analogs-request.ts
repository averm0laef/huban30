"use client";

import { useEffect, useState } from "react";

import { finderRequest, type ShopAnalogsResult } from "../../../_lib/parts-finder";

/** One request per product card, shared by the block of analogs and the line «есть замена в наличии». */
const kept = new Map<string, { at: number; answer: Promise<ShopAnalogsResult> }>();
/** Stock moves: a card opened again a minute later asks again. */
const KEPT_MS = 60_000;

function shopAnalogs(article: string, brand: string | null, productId: string): Promise<ShopAnalogsResult> {
  const now = Date.now();
  const entry = kept.get(productId);
  if (entry && now - entry.at < KEPT_MS) return entry.answer;
  // The card names its product: the API reads the product's own brand and section, and another
  // maker's product that only shares the number is not shown as an analog.
  const answer = finderRequest<ShopAnalogsResult>("shop-analogs", { article, productId, ...(brand ? { brand } : {}) });
  kept.set(productId, { answer, at: now });
  answer.catch(() => { if (kept.get(productId)?.answer === answer) kept.delete(productId); });
  return answer;
}

export type ShopAnalogsState = { status: "loading" } | { status: "error" } | { result: ShopAnalogsResult; status: "ready" };

export function useShopAnalogs(article: string, brand: string | null, productId: string): ShopAnalogsState {
  const [state, setState] = useState<ShopAnalogsState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    shopAnalogs(article, brand, productId)
      .then((result) => { if (alive) setState({ result, status: "ready" }); })
      .catch(() => { if (alive) setState({ status: "error" }); });
    return () => { alive = false; };
  }, [article, brand, productId]);
  return state;
}
