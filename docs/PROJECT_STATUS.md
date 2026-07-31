# Статус проекта АН-30

Этот файл является основным журналом работ. Время указывается в часовом поясе Asia/Chita.

## Общий статус

- Цель: автономный production-продукт без runtime-зависимости от Supabase и Lovable.
- Текущий этап: AN30-005.
- Production: не готов.
- Публичный checkout: должен оставаться закрыт до подключения боевого эквайринга.
- Удаление старого Supabase: запрещено без отдельного подтверждения владельца.

## Очередь задач

| Задача | Статус | Результат |
| --- | --- | --- |
| AN30-001 | Готово | Безопасная Git-база, журналы и фиксация исходного состояния |
| AN30-002 | Готово в исходниках | Закрытие критических рисков legacy-системы |
| AN30-003 | Готово | Воспроизводимая pnpm-сборка на Node.js 24 LTS |
| AN30-004 | Готово | Каркас web, api, worker, PostgreSQL, Redis и Caddy |
| AN30-005 | Ожидает | Чистая схема PostgreSQL и dev seed |
| AN30-006 | Ожидает | Авторизация, TOTP, сессии и RBAC |
| AN30-007 | Ожидает | Надёжный staging-импорт и обмен с 1С |
| AN30-008 | Ожидает | Заказы, резервы и sandbox-платежи |
| AN30-009 | Ожидает | Чат и отключаемые внешние адаптеры |
| AN30-010 | Ожидает | Рабочие интерфейсы персонала |
| AN30-011 | Ожидает | Обновлённый клиентский интерфейс |
| AN30-012 | Ожидает | SSR, SEO, юридические страницы и производительность |
| AN30-013 | Ожидает | Тестирование и hardening |
| AN30-014 | Ожидает | Закрытый staging, резервные копии и эксплуатация |
| AN30-015 | Заблокирована внешними данными | VPS, DNS, SMTP, 1С и боевой эквайринг ещё не предоставлены |

## AN30-001: исходное состояние

- Дата начала: 2026-07-31 23:19:43 +09.
- Дата завершения: 2026-07-31 23:21:54 +09.
- Статус: готово.
- Изменённые файлы: `.gitignore`, `.env.example`, `CHANGELOG.md`, `SECURITY.md`, `docs/PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/AUDIT_BASELINE.md`, legacy-файлы с ранее жёстко заданными секретами.
- Решение: ни один известный секрет не должен попасть даже в baseline-коммит.
- Проверки: `git check-ignore -v .env`, поиск известных секретов, проверка состава индекса, проверка Git-тега.
- Результат: `.env` исключён; известные hardcoded-секреты удалены до первого коммита; документация и журнал созданы.
- Риски: legacy-приложение ещё обращается к Supabase напрямую; старые Edge Functions требуют отдельного hardening в AN30-002.
- Следующий шаг: AN30-002, отключить публичный bootstrap администратора и ограничить legacy Edge Functions.

## Формат записи для каждой задачи

Каждая завершённая задача добавляет дату и время, статус, изменённые файлы, решения, команды тестов, результаты, риски и следующий шаг. Одна задача соответствует одному атомарному Git-коммиту `AN30-NNN`.

## AN30-002: hardening legacy

- Дата начала: 2026-07-31 23:22:00 +09.
- Дата завершения исходников: 2026-07-31 23:30:46 +09.
- Статус: готово в исходниках; remote Supabase не изменён.
- Изменённые файлы: 15 отключённых Edge Functions, shared CORS/security helpers, конфигурация JWT, legacy 1С endpoints, admin-настройки, новая RLS-миграция, `.env.example`, `SECURITY.md`, `docs/SECRET_ROTATION.md` и журналы.
- Решения: отключить необязательные публичные функции вместо сохранения небезопасных fallback; оставить только закрытые 1С endpoints и авторизованный экспорт.
- Команды проверок: `git diff --check`; поиск wildcard CORS; поиск известных hardcoded-секретов; поиск чтения `exchange_password` в UI; проверка списка изменённых файлов.
- Результат: wildcard CORS не найден; public admin bootstrap отсутствует; пароль 1С не читается UI; 1С fail-closed без `ONE_C_ALLOWED_IPS`; гостевой chat IDOR закрыт миграцией.
- Риски: Deno CLI отсутствует, поэтому remote Edge Functions и миграция не развёрнуты и должны считаться всё ещё уязвимыми до контролируемого deploy. Ротация внешних ключей требует действий владельца. Полная сборка legacy отложена до восстановления зависимостей в AN30-003.
- Следующий шаг: AN30-003, удалить лишние lock-файлы, закрепить Node.js 24 и создать воспроизводимую pnpm-сборку.

## AN30-003: воспроизводимая сборка

- Дата начала: 2026-07-31 23:31:00 +09.
- Дата завершения: 2026-08-01 00:05:20 +09.
- Статус: готово.
- Изменённые файлы: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `.node-version`, toolchain configs, README, smoke-тесты и небольшие TypeScript/lint-исправления legacy-кода.
- Решения: один package manager `pnpm@11.9.0`; Node.js `24.12.0`; install scripts разрешены только для `@swc/core` и `esbuild`; Playwright локально использует установленный Chrome.
- Команды проверок: `pnpm install --frozen-lockfile`; `pnpm verify`; `pnpm test:e2e`; `pnpm audit:prod`; повтор этих команд в чистом временном каталоге без `.env` и `node_modules`.
- Результат: чистая offline-установка из lock-файла прошла; lint не содержит ошибок; typecheck, unit, build и E2E прошли; production audit содержит 0 critical, 0 high и 3 moderate.
- Риски: legacy ESLint оставляет 29 предупреждений по hook dependencies и Fast Refresh; production bundle 1.64 MB до gzip требует code splitting; React Router 6 имеет 3 moderate advisory, а доступная major-версия 7 на дату проверки имеет отдельную high advisory. React Router будет удалён при переносе на Next.js.
- Следующий шаг: AN30-004, создать приложения `web`, `api`, `worker`, общие контракты и Docker Compose с PostgreSQL, Redis и Caddy.

## AN30-004: автономный инфраструктурный каркас

- Дата начала: 2026-08-01 00:06:00 +09.
- Дата завершения: 2026-08-01 01:13:15 +09.
- Статус: готово.
- Изменённые файлы: новые `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `compose.yaml`, `compose.dev.yaml`, Dockerfile каждого сервиса, образ и конфигурация Caddy, root-only генератор секретов, настройки workspace/toolchain, E2E и `docs/LOCAL_DEVELOPMENT.md`.
- Решения: новый стек работает рядом с legacy до последовательного переноса функций; production использует внешние Compose secrets, а локальный override содержит только публичные тестовые пароли; REST имеет префикс `/api/v1`, OpenAPI публикуется как JSON без уязвимого Swagger UI; runtime-образы содержат только production-зависимости выбранного приложения.
- Команды проверок: `pnpm verify`; `pnpm test:e2e`; `pnpm peers check`; `pnpm audit:prod`; `docker compose config --quiet`; `docker compose -f compose.yaml -f compose.dev.yaml config --quiet`; `docker compose -f compose.yaml -f compose.dev.yaml build`; полный `up --force-recreate`; HTTP smoke для `/`, `/health/live`, `/health/ready`, `/api/v1/health/*`, `/api/health/ready`, `/api/v1/openapi.json`; проверка runtime-образов на отсутствие Supabase.
- Результат: PostgreSQL 18.4, Redis 8, NestJS API, BullMQ worker, Next.js web и Caddy одновременно healthy; readiness подтверждает реальные подключения к PostgreSQL и Redis; OpenAPI и reverse proxy доступны; API/worker runtime не содержат Supabase; production audit содержит 0 critical, 0 high и 3 moderate; peer-конфликтов нет.
- Исправленные при smoke ошибки: путь тома PostgreSQL 18; отсутствующие runtime-пакеты ValidationPipe; приоритет API-маршрута Caddy; нежелательная локальная ACME-попытка; устаревшая E2E-конфигурация; установка всего legacy workspace в runtime-образы; пять high advisory в транзитивных зависимостях.
- Риски: чистая бизнес-схема и миграции ещё не созданы; storefront и admin пока являются честными каркасами без каталога и операций; 3 moderate advisory и 29 lint-предупреждений остаются только в legacy; production secrets и автоматический HTTPS будут проверены на Linux/VPS, потому что Docker Desktop macOS блокирует bind-mount секретов из защищённой папки Downloads; домен пока не направлен на сервер.
- Следующий шаг: AN30-005, создать чистую PostgreSQL-схему, миграционный runner и dev-only seed без переноса production-данных Supabase.
