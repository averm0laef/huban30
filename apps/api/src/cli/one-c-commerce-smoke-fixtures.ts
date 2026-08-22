export interface CommerceSmokeCatalogFixture {
  brand: string;
  category: string;
  product: string;
  sku: string;
}

/**
 * The normal CommerceML deletion path for the staging fixture. Categories
 * have their own deletion marker: deleting only the product leaves an active,
 * empty technical category in the public tree and in the 1C source state.
 */
export function buildCommerceSmokeDeletionXml(
  external: CommerceSmokeCatalogFixture,
  generatedAt = new Date().toISOString(),
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация xmlns="urn:1C.ru:commerceml_2" ВерсияСхемы="2.10" ДатаФормирования="${generatedAt}">
  <Классификатор><Ид>smoke-classifier</Ид><Группы><Группа>
    <Ид>${external.category}</Ид><Наименование>Smoke category</Наименование><ПометкаУдаления>true</ПометкаУдаления>
  </Группа></Группы></Классификатор>
  <Каталог СодержитТолькоИзменения="true"><Ид>smoke-catalog</Ид><Товары><Товар>
    <Ид>${external.product}</Ид><Наименование>CommerceML smoke product</Наименование>
    <Артикул>${external.sku}</Артикул><ПометкаУдаления>true</ПометкаУдаления>
  </Товар></Товары></Каталог>
</КоммерческаяИнформация>`;
}

type ExecuteQuery = (sql: string, values: string[]) => Promise<unknown>;

/**
 * Fail-safe cleanup for a network/parser failure before deletion.xml lands.
 * Only the exact stable fixture external ids are touched. The category and
 * brand are tombstoned only when no other active catalog row depends on them,
 * so the smoke command can never hide unrelated catalog data accidentally.
 */
export async function tombstoneCommerceSmokeCatalogFixture(
  execute: ExecuteQuery,
  external: Pick<CommerceSmokeCatalogFixture, "brand" | "category" | "product">,
): Promise<void> {
  await execute(
    `UPDATE app.products
     SET is_active=false,deleted_at=COALESCE(deleted_at,clock_timestamp())
     WHERE external_id=$1 AND (is_active OR deleted_at IS NULL)`,
    [external.product],
  );
  await execute(
    `UPDATE app.categories AS category
     SET is_active=false,deleted_at=COALESCE(category.deleted_at,clock_timestamp())
     WHERE category.external_id=$1
       AND (category.is_active OR category.deleted_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM app.products AS product
         WHERE product.category_id=category.id
           AND product.is_active AND product.deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM app.categories AS child
         WHERE child.parent_id=category.id
           AND child.is_active AND child.deleted_at IS NULL
       )`,
    [external.category],
  );
  await execute(
    `UPDATE app.brands AS brand
     SET is_active=false,deleted_at=COALESCE(brand.deleted_at,clock_timestamp())
     WHERE brand.external_id=$1
       AND (brand.is_active OR brand.deleted_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM app.products AS product
         WHERE product.brand_id=brand.id
           AND product.is_active AND product.deleted_at IS NULL
       )`,
    [external.brand],
  );
}
