import type { Metadata } from "next";

import { ProfileClient } from "../_components/profile-client";
import { privatePageMetadata } from "../_lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Личный кабинет",
  "Профиль, адреса, заказы, избранное и история просмотра клиента АН-30.",
);

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab, social } = await searchParams;
  return <ProfileClient initialTab={tab === "security" || tab === "addresses" || tab === "wishlist" || tab === "garage" ? tab : "orders"}
    socialStatus={social === "linked" || social === "link-conflict" || social === "link-failed" ? social : undefined} />;
}
