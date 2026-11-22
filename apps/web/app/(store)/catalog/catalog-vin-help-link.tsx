"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

import { submitCatalogVin } from "./catalog-vin-submit";

export function CatalogVinHelpLink({ vin }: { vin: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const handled = submitCatalogVin(vin, {
      navigate: (path) => window.location.assign(path),
      saveVin: (key, value) => window.sessionStorage.setItem(key, value),
    });
    if (handled) event.preventDefault();
  }

  return <Link href="/expert-help" onClick={handleClick}>Перейти к подбору по VIN</Link>;
}
