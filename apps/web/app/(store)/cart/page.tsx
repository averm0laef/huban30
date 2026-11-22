import type { Metadata } from "next";

import { CartClient } from "../_components/cart-client";
import { privatePageMetadata } from "../_lib/seo";

export const metadata: Metadata = privatePageMetadata("Корзина", "Сохранённые позиции корзины АН-30.");

export default function CartPage() {
  return <CartClient />;
}
