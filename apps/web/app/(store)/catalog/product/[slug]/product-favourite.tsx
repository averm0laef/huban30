"use client";

import { Heart24Filled, Heart24Regular } from "@fluentui/react-icons";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiRequest, errorText, readSession } from "../../../_lib/storefront-api";
import styles from "./product-page.module.css";

export function ProductFavourite({ productId }: { productId: string }) {
  const router = useRouter();
  const [viewer, setViewer] = useState<"guest" | "customer" | "staff" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const itemPath = `/account/wishlist/${encodeURIComponent(productId)}`;

  useEffect(() => {
    let active = true;
    const request = new AbortController();
    void (async () => {
      try {
        const session = await readSession();
        if (!session || session.role !== "customer") {
          if (active) setViewer(session ? "staff" : "guest");
          return;
        }
        const item = await apiRequest<{ saved: boolean }>(itemPath, { signal: request.signal });
        if (active) {
          setSaved(item.saved);
          setViewer("customer");
        }
      } catch (failure) {
        if (active) setError(errorText(failure));
      }
    })();
    return () => { active = false; request.abort(); };
  }, [itemPath]);

  async function update() {
    if (viewer === "guest") {
      router.push("/auth?mode=login");
      return;
    }
    if (viewer !== "customer") return;
    setPending(true);
    setError("");
    try {
      if (saved) await apiRequest(itemPath, { method: "DELETE" });
      else await apiRequest("/account/wishlist", { method: "POST", body: { productId } });
      setSaved(!saved);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  }

  const Icon = saved ? Heart24Filled : Heart24Regular;
  return (
    <>
      <button aria-label={saved ? "Убрать из избранного" : "В избранное"} aria-pressed={saved}
        className={styles.favourite} disabled={!viewer || viewer === "staff" || pending} type="button" onClick={() => void update()}>
        <Icon aria-hidden="true" />
      </button>
      {error ? <p className={styles.purchaseError} role="status">{error}</p> : null}
    </>
  );
}
