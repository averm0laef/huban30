import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ChatWidget } from "./_components/chat-widget";
import { StoreShell } from "./_components/store-shell";

type Theme = "dark" | "light" | "system";

export default async function StorefrontLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const savedTheme = cookieStore.get("an30_theme")?.value;
  const initialTheme: Theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : "system";
  const initialSessionPresent = cookieStore.has("an30_session");
  return (
    <StoreShell initialSessionPresent={initialSessionPresent} initialTheme={initialTheme}>
      {children}
      <ChatWidget />
    </StoreShell>
  );
}
