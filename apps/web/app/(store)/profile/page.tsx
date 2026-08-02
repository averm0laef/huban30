import type { Metadata } from "next";

import { ProfileClient } from "../_components/profile-client";
import { privatePageMetadata } from "../_lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Личный кабинет",
  "Профиль, адреса, заказы, избранное и история просмотра клиента АН-30.",
);

export default function ProfilePage() {
  return <ProfileClient />;
}
