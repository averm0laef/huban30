-- What kind of vehicle a product is for, and how often customers choose it.
--
-- 1. products.vehicle_kind: 'passenger', 'truck' or 'tractor' (tractors and other machinery), NULL when nothing
--    says it. The exchange and the re-sorting fill it from the product's 1С groups — the owner's top groups are
--    «Легковая», «Грузовики», «Камаз», «МТЗ» — and, when the groups say nothing, from the make the name calls
--    (apps/api/src/catalog/catalog-vehicle-kind.ts). Products already loaded are filled here from their names
--    with the same words: a base loaded without groups has nothing else. Nothing is deleted or moved.
--
-- 2. app.product_popularity: one number per product from the shop's own data — what was ordered in the last
--    180 days, what customers keep in favourites and what signed-in customers opened. The catalogue's «По
--    популярности» order reads it; the API refreshes it (app.refresh_product_popularity) a few times an hour.

ALTER TABLE app.products ADD COLUMN vehicle_kind text
  CONSTRAINT products_vehicle_kind_check CHECK (vehicle_kind IN ('passenger', 'truck', 'tractor'));

UPDATE app.products AS product SET vehicle_kind = CASE
    WHEN lower(product.name_folded) ~ '(^|[^a-zа-я0-9])(мтз|юмз|лтз|т-16|т-25|т-40|т-150|дт-75|к-700|к-701|к-744|кировец|беларус|трактор|трактора|тракторный|тракторная|комбайн|комбайна|экскаватор|экскаватора|погрузчик|погрузчика|бульдозер|бульдозера|xcmg|sdlg|lonking|zl-30|zl-50)($|[^a-zа-я])' THEN 'tractor'
    WHEN lower(product.name_folded) ~ '(^|[^a-zа-я0-9])(камаз|kamaz|маз|краз|урал|зил|газон|газель|валдай|газ-53|газ-3307|газ-3309|howo|shacman|shaanxi|sitrak|faw|dongfeng|foton|scania|daf|iveco|hino|isuzu|fuso)($|[^a-zа-я])' THEN 'truck'
    WHEN lower(product.name_folded) ~ '(^|[^a-zа-я0-9])(ваз|лада|lada|нива|уаз|москвич|волга|toyota|nissan|honda|mazda|mitsubishi|subaru|suzuki|daihatsu|lexus|infiniti|hyundai|kia|daewoo|chevrolet|ford|volkswagen|vw|audi|bmw|mercedes|renault|skoda|opel|peugeot|geely|chery|haval)($|[^a-zа-я])' THEN 'passenger'
  END
WHERE product.deleted_at IS NULL;

CREATE INDEX products_vehicle_kind_idx ON app.products (vehicle_kind, category_id)
  WHERE vehicle_kind IS NOT NULL AND is_active AND deleted_at IS NULL;

CREATE MATERIALIZED VIEW app.product_popularity AS
SELECT signal.product_id, sum(signal.score)::bigint AS score
FROM (
  SELECT item.product_id, sum(item.quantity)::bigint * 5 AS score
  FROM app.order_items AS item
  JOIN app.orders AS placed ON placed.id = item.order_id
  WHERE item.product_id IS NOT NULL AND placed.status <> 'cancelled'
    AND placed.created_at > clock_timestamp() - interval '180 days'
  GROUP BY item.product_id
  UNION ALL
  SELECT wish.product_id, count(*)::bigint * 2 FROM app.wishlist_items AS wish GROUP BY wish.product_id
  UNION ALL
  SELECT viewed.product_id, count(*)::bigint FROM app.product_views AS viewed
  WHERE viewed.last_viewed_at > clock_timestamp() - interval '180 days'
  GROUP BY viewed.product_id
) AS signal
GROUP BY signal.product_id;

CREATE UNIQUE INDEX product_popularity_product_uidx ON app.product_popularity (product_id);

CREATE FUNCTION app.refresh_product_popularity() RETURNS void
LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY app.product_popularity;
$$;
