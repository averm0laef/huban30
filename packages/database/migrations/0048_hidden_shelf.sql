-- The hidden shelf: one section that is never public (is_active = false).
--
-- The owner's 1С base keeps services, the workshop's price list, grain and
-- fixed assets in the same list as parts. Staff point such a 1С group, a
-- sorting rule or a single product at this section; the product is stored
-- (its prices and stock apply without refusals), and the storefront's
-- existing rule «a product is visible only in a visible section» hides it.
-- Slug and name must match HIDDEN_CATEGORY_SLUG / HIDDEN_CATEGORY_LABEL in
-- apps/api/src/catalog/catalog-known-categories.ts.

INSERT INTO app.categories (external_id, parent_id, name, slug, description, sort_order, is_active)
VALUES (NULL, NULL, 'Не показывать на сайте', 'ne-pokazyvat', NULL, 10000, false)
ON CONFLICT (slug) DO NOTHING;
