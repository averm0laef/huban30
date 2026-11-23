# Автономный чат и внешние адаптеры

## Что работает без облака

- История, сообщения, квитанции доставки/прочтения и курсоры переподключения хранятся в PostgreSQL.
- `/ws` передаёт realtime-события через Redis Pub/Sub и поддерживает несколько экземпляров API.
- Клиент и сотрудник используют серверную session cookie; сотрудник допускается только после TOTP.
- Гость получает токен один раз. В PostgreSQL хранится только purpose-separated HMAC. Токен передаётся заголовком REST или первым сообщением WebSocket, но никогда в URL.
- `clientMessageId` делает повторную отправку идемпотентной. Повтор с изменённым телом получает `409`.
- Каталог ищется воспроизводимо по SKU, названию и PostgreSQL full-text индексу. При отключённом AI API возвращает явный fallback, а не имитирует AI-ответ.

## WebSocket protocol v1

Endpoint: `GET /ws`. Handshake обязан иметь точный `Origin`, равный `APP_ORIGIN`. Максимальный frame — 16 KiB, на подписку даётся 10 секунд, heartbeat выполняется каждые 30 секунд.

Очередь обработки ограничена восемью сообщениями и 64 КиБ вместе с текущим
сообщением. При переполнении или отказе rate limit соединение закрывается,
ожидающие сообщения удаляются. После закрытия очередь не продолжает работу.

Первое клиентское событие:

```json
{
  "type": "subscribe",
  "threadId": "uuid",
  "afterSequence": "0",
  "guestToken": "только-для-гостя"
}
```

Дальше доступны `message.send`, `receipt.read` и `ping`. Сервер отвечает `hello`, `subscribed`, `message`, `message.ack`, `receipt.read`, `pong` или безопасным `error`. Клиент хранит последний `sequence`, после reconnect снова выполняет `subscribe` с этим курсором и дедуплицирует события по `message.id`.

## REST

- Авторизованный чат: `/api/v1/chat/*`.
- Гостевой чат: `/api/v1/chat/guest/*` с `x-guest-chat-token`.
- Поиск: `GET /api/v1/catalog/search?q=...&limit=...`.
- Изменяющие session-запросы требуют точный Origin и CSRF; гостевые изменяющие запросы требуют точный Origin.

## Вложения

Файл хранится вне web-root в Docker volume `uploads_data`; перед каждой операцией проверяется доступ к родительскому чату. Разрешены только JPEG, PNG и WebP до 5 MiB. API сверяет заявленный MIME с бинарной сигнатурой, игнорирует исходное имя как путь, выдаёт непрогнозируемый storage key, записывает с правами `0600` и скачивает как `attachment` с `nosniff`/`no-store`. Дедупликация касается только байтов: пользовательское имя берётся из конкретного сообщения и не может раскрыть имя такого же файла из другого чата. Повторная загрузка ранее soft-deleted содержимого создаёт новый физический ключ.

PDF, SVG, HTML и документы сейчас намеренно запрещены: одной проверки MIME недостаточно против активного содержимого. Поддержку таких форматов можно открыть только после отдельного quarantine/antivirus/sanitizer pipeline.

## Адаптеры

- `StorageProvider`: рабочий локальный provider для вложений чата и баннеров. Фото товаров идут через `ProductPhotoStorage`: локальный диск или S3-совместимое хранилище (`docs/PRODUCT_PHOTOS_S3.md`).
- `NotificationProvider`: API-граница с безопасным disabled provider.
- Worker содержит реальные opt-in SMTP, Telegram Bot API и VK Messages providers. SMTP требует TLS; VK использует стабильный `random_id` из outbox id.
- `SocialAuthProvider` и `AiProvider`: fail-closed disabled providers. Они не влияют на каталог, checkout, заказы, кабинет и рабочее место.
- Поиск принципиально не меняет ranking при подключении AI. AI может отвечать в отдельном помощнике, но не подменяет источник каталога 1С.

Все уведомления идут через PostgreSQL outbox с `FOR UPDATE SKIP LOCKED`, восстановлением зависших locks и экспоненциальным retry. Auth email остаётся `failed` при выключенном SMTP; уведомление чата считается необязательным и успешно завершается при отсутствии Telegram/VK.

## Настройка opt-in уведомлений

По умолчанию всё выключено. Сначала заполнить root-only файлы `smtp_password.txt`, `telegram_bot_token.txt`, `vk_access_token.txt` в `AN30_SECRETS_DIR`, затем задать нужные параметры `.env` и включить только выбранный adapter:

```dotenv
SMTP_ENABLED=true
SMTP_HOST=smtp.example.ru
SMTP_PORT=587
SMTP_SECURE=false
SMTP_FROM=shop@an30.ru
SMTP_USER=shop@an30.ru

TELEGRAM_ENABLED=true
TELEGRAM_CHAT_ID=-1000000000000

VK_ENABLED=true
VK_PEER_ID=2000000001
```

Если обязательного поля/секрета нет, worker завершает запуск с ошибкой. Значения секретов не выводятся в лог.

## Проверка

```bash
pnpm verify:full
docker compose -f compose.yaml -f compose.dev.yaml exec -T api node dist/cli/chat-smoke.js
```

Smoke проверяет гостевой IDOR, идемпотентность, конфликт payload, cursor reconnect, WebSocket Origin, запрет записи в закрытый чат, сигнатуру файла, подмену MIME, защищённое скачивание и честный AI fallback.
