# Checkout, резервы и платежи АН-30

## Что уже работает

AN30-008 реализует один серверный checkout для клиента с активной сессией и
для гостя. Браузер передаёт только UUID товара и количество. API заново читает
активную цену, выбирает склад, блокирует строку остатка и в одной транзакции:

1. создаёт резерв с TTL;
2. увеличивает `quantity_reserved`;
3. фиксирует снимки SKU, названия и цены;
4. создаёт заказ `pending_payment`;
5. создаёт идемпотентный платёж товара.

Цена, итог заказа, склад и статус никогда не принимаются из браузера. Деньги
передаются и хранятся целыми копейками. Валюта текущего контракта — только RUB.

## HTTP-контракт

- `POST /api/v1/checkout` — checkout авторизованного клиента; требует cookie,
  точный `Origin` и CSRF.
- `POST /api/v1/checkout/guest` — гостевой checkout; требует точный `Origin`.
- `GET /api/v1/orders` и `GET /api/v1/orders/:id` — собственные заказы клиента
  или рабочая очередь персонала.
- `GET /api/v1/orders/guest/:id` — гостевой заказ; секрет передаётся только в
  `X-Guest-Order-Token`, не в URL. В БД хранится только HMAC токена.
- `PATCH /api/v1/orders/:id/status` — оптимистичное изменение состояния
  персоналом с обязательным `version`.
- `POST /api/v1/orders/:id/payments/delivery` — отдельный платёж доставки,
  создаваемый персоналом после согласования условий.
- `POST /api/v1/payments/:id/refunds` — частичный или полный возврат; требуется
  право `payments:refund`.
- `POST /api/v1/payments/webhooks/sandbox` — подписанный sandbox webhook.
- `POST /api/v1/payments/sandbox/:externalPaymentId/complete` — локальная
  страница подтверждения sandbox с одноразовым высокоэнтропийным токеном.

Повтор checkout, платежа доставки, webhook или возврата с тем же idempotency
key/event ID возвращает существующий результат. Повтор ключа с другим payload
даёт `409` и не меняет данные.

## Остатки и конкуренция

Checkout берёт shared advisory lock каталога, поэтому импорт 1С не может
одновременно заменить цену или остаток между проверкой и снимком заказа.
Строки `inventory_balances` блокируются в стабильном порядке. Если два клиента
покупают последнюю единицу, один создаёт резерв, второй получает `409`.

После успешного webhook резерв переводится в `consumed`, а `quantity_on_hand`
и `quantity_reserved` уменьшаются ровно один раз. Отказ и отмена освобождают
резерв. Worker каждые 30 секунд вызывает транзакционную функцию
`app.expire_stock_reservations(100)` и освобождает просроченные резервы с
append-only движениями остатков.

## Sandbox

Поле `sandboxScenario` доступно только при выбранном sandbox-провайдере:

- `success` — успешный webhook и списание резерва;
- `decline` — отказ и освобождение резерва;
- `timeout` — платёж остаётся pending до истечения TTL;
- `cancel` — отмена и немедленное освобождение резерва.

Webhook подписывается HMAC-SHA256 секретом из
`sandbox_payment_webhook_secret.txt`. Повторный event ID проверяется ещё и по
checksum payload. Другой success event для уже успешного платежа не списывает
товар повторно.

## Production gate

Конфигурация использует:

```text
DEPLOYMENT_ENVIRONMENT=development|staging|production
ENABLE_PUBLIC_CHECKOUT=true|false
PAYMENTS_PROVIDER=disabled|sandbox
RESERVATION_TTL_MINUTES=20
SANDBOX_PAYMENT_WEBHOOK_SECRET_FILE=/run/secrets/sandbox_payment_webhook_secret
```

API не запускается, если `DEPLOYMENT_ENVIRONMENT=production`, публичный
checkout включён и выбран `sandbox`. До выбора эквайринга production должен
оставаться с `ENABLE_PUBLIC_CHECKOUT=false` и `PAYMENTS_PROVIDER=disabled`.
Staging может использовать sandbox. Боевой адаптер позднее обязан сохранить
тот же контракт idempotency, webhook, отмены и возврата и добавить параметры
чеков.

При старте API также сравнивает `DEPLOYMENT_ENVIRONMENT` с неизменяемой меткой
самой PostgreSQL. Поэтому нельзя выдать production-БД за development ради
обхода sandbox gate: процесс завершится до открытия HTTP-порта.

## Локальная проверка

После запуска Compose очистите только локальные rate-limit ключи, если smoke
повторяется много раз, и выполните:

```bash
docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/checkout-smoke.js
```

Smoke проверяет 36 шагов, включая checkout из аккаунта и гостя, защиту гостевого
заказа, конфликт ключа, конкурентную покупку последней единицы, подпись и replay
webhook, все sandbox-исходы, TTL, отдельный платёж доставки и частичный/полный
возврат с replay.
