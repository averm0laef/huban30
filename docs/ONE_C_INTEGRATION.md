# Интеграция каталога с 1С

## Границы и безопасность

1С остаётся единственным production-источником каталога, цен и фактических
остатков. Endpoint выключен по умолчанию. Admin включает его только после
сохранения username, нового пароля длиной не менее 16 символов и непустого CIDR
allowlist.

- Машинный endpoint: `POST /api/v1/integrations/1c/imports`.
- Авторизация: HTTP Basic поверх обязательного HTTPS.
- Доступ: только адреса из `allowedNetworks`; Caddy является единственной
  публичной точкой входа, API-порт наружу не публикуется.
- Ограничения: 60 запросов/минуту на HMAC-маскированный IP, 10 MiB на request и
  максимум 5 000 строк в batch.
- Пароль шифруется AES-256-GCM с purpose binding и никогда не возвращается API.
  GET сообщает только `hasPassword`.
- Каждая принятая и отклонённая операция попадает в append-only
  `integration_request_log` без Authorization header и тела запроса.

Настройки доступны только admin с `settings:manage`:

- `GET /api/v1/catalog/1c/settings`;
- `PUT /api/v1/catalog/1c/settings`;
- `GET /api/v1/catalog/1c/requests` — журнал с пагинацией и фильтром `succeeded`.

## Контракт выгрузки

JSON envelope имеет фиксированную версию. Деньги передаются целыми копейками,
остатки — целыми неотрицательными числами. Каждая сущность содержит монотонно
растущую положительную `version` из 1С.

```json
{
  "schemaVersion": 1,
  "externalBatchId": "catalog-2026-08-01T03:00:00+09:00",
  "exportedAt": "2026-08-01T03:00:00+09:00",
  "rows": [
    {
      "entityType": "brand",
      "externalId": "brand-1c-guid",
      "name": "Производитель",
      "slug": "manufacturer",
      "isActive": true,
      "version": 12
    },
    {
      "entityType": "product",
      "externalId": "product-1c-guid",
      "sku": "AN30-0001",
      "name": "Наименование товара",
      "slug": "an30-0001",
      "brandExternalId": "brand-1c-guid",
      "categoryExternalId": null,
      "description": null,
      "attributes": {},
      "searchText": "AN30-0001 Наименование товара",
      "isActive": true,
      "version": 25
    },
    {
      "entityType": "price",
      "productExternalId": "product-1c-guid",
      "amountKopeks": 159900,
      "currency": "RUB",
      "version": 31
    },
    {
      "entityType": "stock",
      "productExternalId": "product-1c-guid",
      "warehouseExternalId": "warehouse-1c-guid",
      "quantityOnHand": 8,
      "version": 42
    }
  ]
}
```

Поддерживаемые `entityType`:

- `brand`: `externalId`, `name`, `slug`, `isActive`, `version`;
- `category`: те же поля, `parentExternalId`, `description`, `sortOrder`;
- `warehouse`: `externalId`, `code`, `name`, `isActive`, `version`;
- `product`: `externalId`, `sku`, `name`, `slug`, ссылки на brand/category,
  `description`, JSON object `attributes`, `searchText`, `isActive`, `version`;
- `price`: товар, `amountKopeks`, только `RUB`, `version`;
- `stock`: товар, склад, `quantityOnHand`, `version`.

Неизвестные поля запрещены. Slug содержит только lowercase ASCII, цифры и
дефисы. Отключение сущности передаётся `isActive: false`; физическое удаление из
выгрузки не означает удаление на сайте.

## Двухфазное применение

Upload не изменяет production-каталог. Он создаёт staging batch, нормализует
каждую строку и формирует preview:

1. `uploaded/validating` — технические промежуточные состояния одной транзакции;
2. `validated` — доступны counts, conflict report и строки `valid`, `invalid`,
   `skipped`;
3. `POST /api/v1/catalog/imports/{batchId}/apply` — только сотрудник с
   `catalog:import`, только если `invalidRows = 0`;
4. `applied` — создана неизменяемая revision с ordered before/after;
5. `POST /api/v1/catalog/imports/{batchId}/rollback` — компенсирует последнюю
   активную revision и переводит batch в `rolled_back`.

Preview: `GET /api/v1/catalog/imports/{batchId}?limit=100&offset=0&status=invalid`.
Список: `GET /api/v1/catalog/imports?status=validated&limit=50&offset=0`.

Apply сериализован PostgreSQL advisory lock. Между preview и apply повторно
проверяется ожидаемая `source_version`; конкурентное изменение даёт 409 вместо
тихого перезаписывания. Новая цена закрывает предыдущий период и создаёт новую
immutable версию. Остаток обновляется под row lock и не может стать меньше
текущего резерва.

Rollback допускается только для последней активной revision. Он прерывается с
409, если товар/цена/остаток изменены после apply либо новый резерв не помещается
в восстанавливаемый остаток. Inventory history не удаляется: создаётся
компенсирующее `import_rollback` событие. Вставленные catalog rows становятся
soft-deleted tombstones с version 0, чтобы история сохранилась, а следующая
корректная выгрузка могла безопасно их оживить.

## Идемпотентность и конфликты

Payload получает canonical SHA-256. Повтор того же `externalBatchId` и payload
возвращает существующий batch с `idempotentReplay: true`. Тот же batch ID с иным
checksum получает 409. Повторный apply/rollback также идемпотентен.

Preview блокирует apply, в частности, при кодах:

- `schema.*` — повреждённая строка, при этом остальные строки сохраняются;
- `duplicate_entity`, `duplicate_unique_value`, `unique_value_owned`;
- `stale_version`, `version_reused_with_different_payload`;
- `missing_brand`, `missing_category`, `missing_parent_category`,
  `missing_product`, `missing_warehouse`;
- `category_cycle`, `invalid_parent_category`;
- `stock_below_reserved`.

Строка с той же version и теми же данными получает `skipped/noop`, а не создаёт
лишнюю историю.

## Локальная проверка

Smoke создаёт одноразового owner, настраивает TOTP и write-only пароль 1С,
проверяет allowlist, повреждённый batch, preview, idempotency, две ревизии и два
rollback. Catalog rows после проверки не активны, пароль интеграции очищается,
а append-only audit/revision/request journal остаётся как доказательство.

```bash
printf '%s' 'Owner 1C smoke password phrase 2026' | \
  docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/create-owner.js --email owner-one-c-smoke@example.invalid \
  --display-name 'Owner 1C Smoke' --password-file /dev/stdin

docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/one-c-import-smoke.js
```
