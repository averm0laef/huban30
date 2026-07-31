# АН-30

Автономная версия интернет-магазина автозапчастей АН-30. Проект поэтапно переносится с legacy Supabase/Vite на самохостящийся стек Next.js, NestJS, PostgreSQL и Redis.

## Требования

- Node.js 24 LTS
- pnpm 11
- Google Chrome для локального Playwright smoke-теста

Версии закреплены в `.nvmrc`, `.node-version`, `package.json` и `pnpm-lock.yaml`.

## Быстрый старт legacy-витрины

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Legacy-витрине временно нужны значения `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID` и `VITE_SUPABASE_PUBLISHABLE_KEY` в локальном `.env`. Они будут удалены вместе с прямыми Supabase-вызовами в следующих задачах. `.env` запрещено добавлять в Git.

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
