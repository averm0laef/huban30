import type { Metadata } from "next";

import { CheckoutClient } from "../_components/checkout-client";

export const metadata: Metadata = {
  title: "Оформление заказа",
  description: "Оформление заказа в АН-30: цену и наличие проверим перед подтверждением.",
  robots: { index: false, follow: false },
};

interface CheckoutPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const query = await searchParams;
  const order = Array.isArray(query.order) ? query.order[0] : query.order;
  return (
    <CheckoutClient
      checkoutEnabled={process.env.ENABLE_PUBLIC_CHECKOUT === "true"
        && process.env.LEGAL_DOCUMENTS_APPROVED === "true"}
      initialOrderId={order?.slice(0, 64) ?? ""}
    />
  );
}
