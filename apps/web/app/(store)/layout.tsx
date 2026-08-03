import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ChatWidget } from "./_components/chat-widget";
import { StoreShell } from "./_components/store-shell";

export default async function StorefrontLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const initialSessionPresent = cookieStore.has("an30_session");
  return (
    <StoreShell initialSessionPresent={initialSessionPresent}>
      {children}
      <ChatWidget />
    </StoreShell>
  );
}
