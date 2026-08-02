import type { Metadata } from "next";

import { ProfileClient } from "../_components/profile-client";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Профиль, адреса, заказы, избранное и история просмотра клиента АН-30.",
};

export default function ProfilePage() {
  return <ProfileClient />;
}
