export interface SmokeStorageObject {
  id: string;
  status: "available" | "deleted" | "pending" | "quarantined";
  storage_key: string;
}

// Every current non-chat foreign-key consumer of app.storage_objects. The
// smoke cleanup interpolates these guards into the UPDATE that precedes a
// physical file removal. A shared hash must never let a chat smoke test erase
// a catalog image, import payload, banner, invoice, or generated report.
export const CHAT_SMOKE_STORAGE_CONSUMER_GUARDS = `
  AND NOT EXISTS (
    SELECT 1 FROM app.product_images
    WHERE product_images.storage_object_id=storage.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM app.catalog_import_batches
    WHERE catalog_import_batches.uploaded_object_id=storage.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM app.banners
    WHERE banners.image_object_id=storage.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM app.invoices
    WHERE invoices.document_object_id=storage.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM app.report_runs
    WHERE report_runs.result_object_id=storage.id
  )`;

export function newlyCreatedSmokeStorage(
  before: SmokeStorageObject | null,
  after: SmokeStorageObject | null,
): SmokeStorageObject | null {
  if (after === null) return null;
  if (before === null) return after;
  return before.id === after.id
    && before.status === "deleted"
    && after.status === "available"
    && before.storage_key !== after.storage_key
    ? after
    : null;
}

export function sameSmokeStorageSnapshot(
  before: SmokeStorageObject | null,
  after: SmokeStorageObject | null,
): boolean {
  if (before === null || after === null) return before === after;
  return before.id === after.id
    && before.status === after.status
    && before.storage_key === after.storage_key;
}
