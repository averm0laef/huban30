import { cookies } from "next/headers";

import { NotFoundView } from "./(store)/_components/not-found-view";
import { StoreShell } from "./(store)/_components/store-shell";
import { getCategoryTree } from "./(store)/_lib/catalog-api";
import { catalogMenuSections } from "./(store)/_lib/store-categories";

/** URLs outside every route (e.g. /a/b/c) get the same shop page as the storefront 404. */
export default async function NotFound() {
  const cookieStore = await cookies();
  const catalogMenu = catalogMenuSections(await getCategoryTree().catch(() => []));
  return (
    <StoreShell catalogMenu={catalogMenu} initialSessionPresent={cookieStore.has("an30_session")}>
      <NotFoundView />
    </StoreShell>
  );
}
