import type { Metadata } from "next";

import { OrderDetailClient } from "../../../_components/order-detail-client";

export const metadata: Metadata = {
  title: "Заказ",
  robots: { index: false, follow: false },
};

interface OrderPageProps {
  params: Promise<{ orderId: string }>;
}

export default async function OrderPage({ params }: OrderPageProps) {
  const { orderId } = await params;
  return <OrderDetailClient orderId={orderId} />;
}
