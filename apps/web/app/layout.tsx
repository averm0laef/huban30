import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: {
    default: "АН-30 Автозапчасти",
    template: "%s | АН-30",
  },
  description: "Автозапчасти в Чернышевске с подбором и поддержкой сотрудников магазина.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
