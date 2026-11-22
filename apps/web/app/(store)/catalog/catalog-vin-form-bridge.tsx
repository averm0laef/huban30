"use client";

import { useEffect } from "react";

import { CATALOG_SEARCH_FORM_ID } from "./catalog-search-form";
import { submitCatalogVin } from "./catalog-vin-submit";

/** Enhances the progressive GET form without moving its fields into a client boundary. */
export function CatalogVinFormBridge() {
  useEffect(() => {
    const form = document.getElementById(CATALOG_SEARCH_FORM_ID);
    if (!(form instanceof HTMLFormElement)) return;

    const handleSubmit = (event: SubmitEvent) => {
      const input = form.elements.namedItem("q");
      if (!(input instanceof HTMLInputElement)) return;

      const handled = submitCatalogVin(input.value, {
        navigate: (path) => window.location.assign(path),
        saveVin: (key, value) => window.sessionStorage.setItem(key, value),
      });
      if (handled) event.preventDefault();
    };

    form.addEventListener("submit", handleSubmit);
    return () => form.removeEventListener("submit", handleSubmit);
  }, []);

  return null;
}
