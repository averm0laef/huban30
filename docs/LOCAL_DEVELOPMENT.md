# Локальная разработка автономного стека

## Доверенные прокси

API по умолчанию игнорирует `X-Forwarded-*`. Для своего reverse proxy задайте
`TRUST_PROXY_CIDRS` со списком его IP/CIDR через запятую. Числовой
`TRUST_PROXY_HOPS` больше не поддерживается: количество переходов не проверяет
адрес отправителя.

Compose закрепляет адреса Caddy и web в отдельной сети и доверяет только этим
двум адресам. По умолчанию сеть — `172.30.30.0/24`, Caddy — `172.30.30.10`,
web — `172.30.30.11`. Если подсеть занята, согласованно измените
`AN30_BACKEND_SUBNET`, `AN30_CADDY_PROXY_IP` и `AN30_WEB_PROXY_IP`.
Порты API и web в production наружу не публикуются.

При обновлении уже созданной Compose-сети остановите стек без удаления томов,
затем создайте контейнеры с новой конфигурацией сети. Миграции 0027 и 0028
применяются до запуска нового API; старые сессии обмена 1С после обновления
потребуют повторного checkauth.

Приём HTTP-тела ограничен 35 секундами; получение вложения чата — 30 секундами.
При медленном соединении загрузку можно повторить. WebSocket ограничивает
ожидающую очередь восемью сообщениями и 64 КиБ и закрывает соединение при
превышении лимита.

## Требования

- Node.js 24.22.3
- pnpm 11.9.0
- Docker с Compose v2
- Google Chrome для локального Playwright smoke-теста

## Запуск приложений без Docker

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Команда запускает Next.js на `127.0.0.1:3000`, API на `127.0.0.1:4000` и worker health server на порту 4001. PostgreSQL, Redis и clamd должны быть доступны по адресам из окружения; `ffprobe` и `ffmpeg` — находиться в `PATH`. Без clamd readiness будет degraded, а загрузка вложений fail-closed вернёт 503.

### API локального стенда (порт 4000)

```bash
corepack pnpm --filter @an30/api build
sh scripts/dev/run-api-preview.sh
```

Скрипт читает настройки стенда из `secrets/local_stand.env` (база, Redis, ключ сессий и ключ шифрования данных), ключи подбора — из `secrets/parts_finder.env`. Папка `secrets/` в Git не попадает. Файл `secrets/local_stand.env` берегите: данные стенда зашифрованы ключом из него.

## Запуск полного стека Docker

Для локального запуска используется отдельный override с публичными тестовыми
паролями и портами Caddy, привязанными к `127.0.0.1`:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Перед запуском API одноразовый сервис `migrate` применяет checksum-защищённые
forward-only миграции. Его состояние `Exited (0)` после старта — ожидаемое.

Демонстрационный каталог включается только явной командой development-профиля:

```bash
docker compose -f compose.yaml -f compose.dev.yaml --profile dev-tools run --rm seed
```

Повторный запуск безопасен: остаются те же два demo-товара. В staging и
production команда блокируется меткой окружения внутри самой БД.

Проверка состояния:

```bash
docker compose -f compose.yaml -f compose.dev.yaml ps
curl -fsS http://localhost/api/v1/health/live
curl -fsS http://localhost/api/v1/health/ready
curl -fsS http://localhost/api/v1/openapi.json
curl -fsS http://localhost/health/ready
curl -fsS http://localhost/api/health/ready
```

Staging и production запускаются только с Compose secrets. Секреты находятся в
root-only каталоге вне репозитория; скрипт никогда не печатает их значения:

```bash
sudo install -d -m 700 /etc/an30/secrets
sudo env AN30_SECRETS_DIR=/etc/an30/secrets ./scripts/init-secrets.sh
AN30_SECRETS_DIR=/etc/an30/secrets docker compose up -d --build
```

Локальная игнорируемая директория `secrets/` остаётся допустимым fallback для
Linux-среды разработки. На macOS bind-mount файлов из защищённых каталогов может
потребовать разрешение Docker Desktop.

## Проверки

```bash
pnpm verify
pnpm test:e2e
pnpm audit:prod
docker compose config --quiet
docker compose -f compose.yaml -f compose.dev.yaml config --quiet
```

Устройство схемы, правила миграций и SQL smoke-тест описаны в `docs/DATABASE.md`.
Первичный владелец, auth endpoints, TOTP и RBAC описаны в
`docs/AUTHENTICATION.md`.
Безопасный обмен, preview/apply/rollback и smoke-сценарий 1С описаны в
`docs/ONE_C_INTEGRATION.md`.
Checkout, TTL-резервы, sandbox-сценарии и production gate описаны в
`docs/CHECKOUT_AND_PAYMENTS.md`. Полный локальный smoke запускается командой:

```bash
docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/checkout-smoke.js
```

Проверка фото/видео в чате и эксплуатация ClamAV описаны в
`docs/CHAT_MEDIA_SECURITY.md`.

## Вход через Яндекс ID и VK ID

В кабинете каждого провайдера зарегистрируйте веб-приложение и укажите точный
адрес возврата на публичном HTTPS-домене магазина.

| Сервис | Переменная API | Redirect URI для `https://an30.ru` |
| --- | --- | --- |
| Яндекс ID | `YANDEX_ID_CLIENT_ID` | `https://an30.ru/api/v1/auth/social/yandex/callback` |
| VK ID | `VK_ID_CLIENT_ID` | `https://an30.ru/api/v1/auth/social/vk/callback` |

У Яндекс ID для веб-приложения нужен доступ `login:info`. Запрашивать почту или
телефон у провайдеров для этого сценария не требуется. Адреса возврата
формируются из `APP_ORIGIN`. Примените миграцию `0032_customer_social_identities`
и перезапустите API с идентификаторами приложений. Кнопка появляется после
настройки провайдера и при `LEGAL_DOCUMENTS_APPROVED=true`.

Покупатель сначала входит в существующий аккаунт АН-30 по почте и подключает
ID в разделе «Безопасность», подтверждая текущий пароль. Связь применяется только
к этому аккаунту. Для нового покупателя доступна обычная регистрация с
подтверждением почты. Вход сотрудников по-прежнему использует пароль и TOTP.
