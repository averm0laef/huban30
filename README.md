# АН-30

Автономная версия интернет-магазина автозапчастей АН-30. Проект поэтапно переносится с legacy Supabase/Vite на самохостящийся стек Next.js, NestJS, PostgreSQL и Redis.

## Требования

- Node.js 24 LTS
- pnpm 11
- Docker с Compose v2 для полного автономного стека
- Google Chrome для локального Playwright smoke-теста

Версии закреплены в `.nvmrc`, `.node-version`, `package.json` и `pnpm-lock.yaml`.

## Быстрый старт автономного стека

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Полный стек с PostgreSQL, Redis и Caddy запускается так:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Подробности и production-вариант с Compose secrets описаны в `docs/LOCAL_DEVELOPMENT.md`.

Legacy-витрина временно запускается отдельной командой `pnpm dev:legacy` и требует
локальные Supabase-переменные. Она будет удалена после последовательного переноса
функций; `.env` запрещено добавлять в Git.

## Проверки

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
pnpm test:e2e
pnpm audit:prod
```

`pnpm verify` выполняет быстрые локальные проверки. `pnpm verify:full` дополнительно запускает Playwright и аудит production-зависимостей.

## Журнал проекта

- Текущий статус: `docs/PROJECT_STATUS.md`
- Архитектурные решения: `docs/DECISIONS.md`
- Исходный аудит: `docs/AUDIT_BASELINE.md`
- Политика безопасности: `SECURITY.md`
- Ротация секретов: `docs/SECRET_ROTATION.md`

Старый Supabase-проект не удаляется и не отключается без отдельного подтверждения владельца.
