# Локальная разработка автономного стека

## Требования

- Node.js 24.12.0
- pnpm 11.9.0
- Docker с Compose v2
- Google Chrome для локального Playwright smoke-теста

## Запуск приложений без Docker

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Команда запускает Next.js на порту 3000, NestJS API на порту 4000 и worker health server на порту 4001. PostgreSQL и Redis должны быть доступны по адресам из окружения.

Legacy-витрина запускается отдельно:

```bash
pnpm dev:legacy
```

## Запуск полного стека Docker

Для обычного локального запуска используется отдельный override с публичными
тестовыми паролями. Он не подходит для staging или production:

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
