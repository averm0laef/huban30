import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { StoreShell } from "./_components/store-shell";
import { getCategoryTree } from "./_lib/catalog-api";
import { catalogMenuSections } from "./_lib/store-categories";

export default async function StorefrontLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const initialSessionPresent = cookieStore.has("an30_session");
  // The catalogue menu of the header and of the phone drawer. When the catalogue does not answer the menu is
  // empty and «Каталог» stays a plain link.
  const catalogMenu = catalogMenuSections(await getCategoryTree().catch(() => []));
  return (
    <StoreShell catalogMenu={catalogMenu} initialSessionPresent={initialSessionPresent}>
      {children}
    </StoreShell>
  );
}
