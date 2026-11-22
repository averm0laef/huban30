"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import { EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY, EXPERT_HELP_PRODUCT_STORAGE_KEY } from "../_lib/expert-help-prefill";
import { EXPERT_HELP_VIN_STORAGE_KEY } from "../_lib/vin";

export function ExpertHelpQueryLink({ children, className, query, prefillMessage }: {
  children: ReactNode;
  className?: string;
  query?: string;
  prefillMessage?: string;
}) {
  function preserveQuery(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      if (prefillMessage) {
        window.sessionStorage.removeItem(EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY);
        window.sessionStorage.removeItem(EXPERT_HELP_VIN_STORAGE_KEY);
        window.sessionStorage.setItem(EXPERT_HELP_PRODUCT_STORAGE_KEY, prefillMessage);
      } else if (query) {
        window.sessionStorage.removeItem(EXPERT_HELP_PRODUCT_STORAGE_KEY);
        window.sessionStorage.removeItem(EXPERT_HELP_VIN_STORAGE_KEY);
        window.sessionStorage.setItem(EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY, query);
      }
    } catch {
      // Keep the regular expert-help link usable when storage is unavailable.
    }
  }

  return <Link className={className} href="/expert-help" onClick={preserveQuery}>{children}</Link>;
}
