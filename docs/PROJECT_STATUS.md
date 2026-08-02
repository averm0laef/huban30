# Статус проекта АН-30

Этот файл является основным журналом работ. Время указывается в часовом поясе Asia/Chita.

## Общий статус

- Цель: автономный production-продукт без runtime-зависимости от Supabase и Lovable.
- Текущий этап: AN30-011.
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
| AN30-005 | Готово | Чистая схема PostgreSQL, миграции и защищённый dev seed |
| AN30-006 | Готово | Авторизация, TOTP, защищённые сессии и серверная RBAC |
| AN30-007 | Готово | Надёжный staging-импорт и обмен с 1С |
| AN30-008 | Готово | Заказы, резервы и sandbox-платежи |
| AN30-009 | Готово | Durable чат, защищённые вложения, поиск и отключаемые адаптеры |
| AN30-010 | Готово в исходниках | Единое защищённое рабочее место персонала |
| AN30-011 | Ожидает | Обновлённый клиентский интерфейс |
| AN30-012 | Ожидает | SSR, SEO, юридические страницы и производительность |
| AN30-013 | Ожидает | Тестирование и hardening |
| AN30-014 | Ожидает | Закрытый staging, резервные копии и эксплуатация |
| AN30-015 | Частично разблокирована | Домен `an30.ru` куплен; ожидаются VPS Selectel, SMTP, 1С и боевой эквайринг |

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

## AN30-005: чистая автономная база

- Дата начала: 2026-08-01 01:14:00 +09.
- Дата завершения: 2026-08-01 01:51:05 +09.
- Статус: готово.
- Изменённые файлы: новый пакет `packages/database` с 6 SQL-миграциями, runner, dev-seed, unit- и SQL smoke-тестами; `compose.yaml`, `compose.dev.yaml`, lock-файл, `.env.example`, `docs/DATABASE.md`, руководства, политика безопасности и журналы.
- Решения: 48 таблиц и 2 представления в отдельной схеме `app`; деньги только в `bigint`-копейках; order items содержат неизменяемый снимок цены; миграции forward-only с advisory lock, транзакцией и SHA-256; окружение БД инициализируется один раз; demo-каталог запрещён триггером вне development; production-данные Supabase не переносятся.
- Команды проверок: `pnpm verify:full`; `pnpm peers check`; frozen install; Compose config для production/dev/dev-tools; полный Docker build; миграция чистой временной production-БД из финального образа; повторная миграция; production seed rejection; `schema-smoke.sql`; полный HTTP/OpenAPI/health smoke.
- Результат: чистая PostgreSQL 18 получила 6 миграций и повторно показала `pending: 0`; схема содержит 50 объектов (48 таблиц + 2 view), 72 внешних ключа и 176 индексов; все внешние ключи покрыты индексами; append-only, oversell, enum, money, environment и demo-ограничения прошли; dev-seed идемпотентно оставляет 2 demo-товара; production-маркер отклоняет seed; весь стек healthy, migration service завершён с кодом 0.
- Качество: lint без ошибок; typecheck, 9 unit-тестов, обе production-сборки и Playwright прошли; 0 critical/high, 3 moderate только в legacy; peer-конфликтов нет.
- Удалённые тестовые данные: две временные БД и одноразовые verification-контейнеры удалены после smoke; они содержали только сгенерированную тестовую схему и не подлежат восстановлению. Рабочий local development volume и старый Supabase не удалялись.
- Риски: API ещё не реализует доменные репозитории и использует bootstrap-владельца PostgreSQL; отдельная least-privilege runtime-роль, авторизация, IDOR-защита и RBAC входят в AN30-006. Production-каталог намеренно пуст до AN30-007 и импорта 1С. Legacy остаётся рядом до последовательного переноса.
- Следующий шаг: AN30-006, реализовать Argon2id, opaque-сессии, email flows, приглашения, TOTP/recovery-коды, серверную RBAC и аудит безопасности.

## AN30-006: безопасность, авторизация и роли

- Дата начала: 2026-08-01 01:52:00 +09.
- Дата завершения: 2026-08-01 02:41:20 +09.
- Статус: готово.
- Изменённые файлы: migration `0007_auth_security`; auth/security/infrastructure модули NestJS; typed RBAC в `packages/contracts`; owner/customer/staff smoke CLI; Compose secrets и least-privilege DB provisioning; Dockerfile runtime-образов; Caddy headers; `docs/AUTHENTICATION.md`, база, локальный запуск, политика безопасности и журналы.
- Решения: Argon2id с 64 MiB/3 проходами; HMAC-хеши opaque-сессий, CSRF и одноразовых токенов; AES-256-GCM для TOTP/outbox; точный same-origin Origin + CSRF; Redis rate limit fail-closed и блокировка аккаунта после 5 попыток; обязательная ротация staff-сессии после TOTP; первый admin только контейнерной командой; API работает как `an30_app` без DDL и административных атрибутов PostgreSQL.
- Команды проверок: `pnpm install --frozen-lockfile`; `pnpm peers check`; `pnpm verify:full`; production/dev Compose config; полный Docker build/up; миграция чистой временной production-БД; SQL schema smoke под `an30_app`; проверка запрета DDL и production seed; HTTP security headers; customer auth smoke (18 проверок); owner/TOTP/staff/RBAC smoke (10 проверок); поиск `supabase|lovable` во всех финальных runtime-образах.
- Результат: 7 миграций, 50 объектов схемы `app`, 72 FK и 178 индексов; `an30_app` не имеет `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `BYPASSRLS` и DDL; API публикует 12 auth routes; регистрация, email verify, generic login, CSRF logout, reset с отзывом сессий, brute-force lock, одноразовые приглашения, TOTP anti-replay, recovery-коды и role denial прошли на реальных PostgreSQL/Redis/API. Runtime-образы не содержат Supabase/Lovable строк, lock-метаданных или пакетов. Весь Compose-стек healthy, migrate завершён с кодом 0.
- Качество: lint без ошибок; 20 unit-тестов по workspace, Playwright и все production-сборки прошли; `pnpm audit:prod` содержит 0 critical/high и 3 moderate только в legacy. API пишет структурированный JSON и маскирует credential-поля, email и IP. Caddy выдаёт CSP, HSTS, COOP/CORP, Permissions-Policy, Referrer-Policy, nosniff и DENY frame policy.
- Исправленные при smoke ошибки: ESM-режим API для общих контрактов; неоднозначный тип SQL-параметра owner audit; отсутствующий новый Compose secret; устаревший database image без migration 0007; накопленные локальные rate-limit ключи корректно вызвали 429 и были очищены перед воспроизводимым прогоном.
- Удалённые тестовые данные: одноразовые production PostgreSQL container/volume/network и диагностические файлы удалены; 25 локальных Redis rate-limit ключей удалены перед финальным smoke. Тестовые auth-аккаунты обезличены и soft-delete, их append-only audit events сохранены. Ни рабочий local volume, ни старый Supabase не удалялись.
- Риски: SMTP-адаптер пока не отправляет outbox-письма; UI регистрации/TOTP и ownership-проверки будущих заказов/чатов добавляются с соответствующими доменными endpoints; CSP временно допускает inline script/style для Next.js и будет ужесточена через nonce на интерфейсном/SEO этапах; 29 legacy lint warnings и 3 moderate advisory исчезнут при удалении legacy React Router.
- Следующий шаг: AN30-007, реализовать безопасный идемпотентный staging-импорт 1С с preview, apply, rollback, ревизиями и журналом конфликтов.

## AN30-007: каталог и безопасный обмен с 1С

- Дата начала: 2026-08-01 02:42:00 +09.
- Дата завершения: 2026-08-01 03:21:26 +09.
- Статус: готово.
- Изменённые файлы: миграции `0008_one_c_import_pipeline` и `0009_one_c_request_batch_index`; строгие контракты 1С в `packages/contracts`; модуль `apps/api/src/catalog`; CLI integration smoke; Caddy/Fastify body limits; `docs/ONE_C_INTEGRATION.md`, база, локальный запуск, безопасность, решения и журнал.
- Решения: загрузка и применение разделены; batch до 5 000 строк сначала проходит построчную валидацию и preview; повторные upload/apply/rollback идемпотентны; версии источника защищают от устаревшей и повторно использованной версии; apply и rollback сериализованы advisory lock и выполняются транзакционно; история цен, остатков, запросов и ревизий не удаляется.
- Защита endpoint 1С: Basic Auth с generic `401`, зашифрованный write-only пароль, CIDR allowlist через PostgreSQL `inet`, rate limit 60 запросов в минуту, лимит тела 10 MiB, журнал результата без credential/PII и серверная проверка каждой строки. Настройки нельзя включить без логина, пароля и allowlist.
- Команды проверок: `pnpm install --frozen-lockfile`; `pnpm peers check`; `pnpm verify:full`; полный Docker build/up; миграция чистой временной production-БД из финального образа; migration status; SQL schema smoke под `an30_app`; запрет DDL и production seed; 25-шаговый 1С integration smoke; OpenAPI route count; health/security headers; запрос 11 MiB; поиск runtime-зависимостей Supabase/Lovable.
- Результат: 9 миграций, 49 таблиц + 2 представления, 73 FK и 184 индекса; чистая БД показывает `applied: 9, pending: 0`; SQL smoke возвращает `schema_smoke=ok`; `an30_app` не имеет опасных атрибутов и не может создавать таблицы; production seed отклонён. API публикует 7 маршрутов импорта/настроек/журнала; payload 11 MiB получает `413`; live/ready подтверждают PostgreSQL и Redis.
- Проверенная бизнес-логика: частично повреждённый batch не загрязняет каталог; exact replay не создаёт второй batch; изменённый payload с тем же external batch ID отклоняется; неизменённые версии становятся `noop`; та же версия с другими данными конфликтует; новая версия атомарно меняет товар, цену и остаток; повторный apply безопасен; откат последней ревизии возвращает данные без удаления истории; резерв нельзя нарушить импортом или откатом.
- Качество: lint без ошибок; 25 unit-тестов, Playwright и все production-сборки прошли; `pnpm audit:prod` содержит 0 critical/high и 3 moderate только в legacy. Финальные API/web/worker runtime-образы не содержат Supabase/Lovable зависимостей, ключей или URL; database image содержит только исторический комментарий в первой автономной миграции, не runtime-интеграцию.
- Исправленные при smoke ошибки: отсутствующий индекс FK журнала запросов вынесен в отдельную forward-only миграцию `0009`; устранена неоднозначность OR-поиска idempotency key; checksum считается только после машинной аутентификации; canonical JSON больше не зависит от locale; `WWW-Authenticate` выдаётся только при `401`; конфликтные tombstone-зависимости и rollback inventory reference приведены к неизменяемой модели.
- Удалённые тестовые данные: временные `an30-an30007-postgres`, `an30_an30007_pgdata` и `an30-an30007-net` удалены без возможности восстановления; они содержали только чистую тестовую production-схему. Активный smoke-владелец, пароль 1С и smoke-товары удалены/обезличены; append-only локальные журналы и компенсирующие движения сохранены. Рабочий local volume и старый Supabase не удалялись.
- Риски: реальные реквизиты 1С и производственный allowlist ещё не предоставлены, поэтому связь с production 1С не проверена; интерфейс preview/apply появится в AN30-010; 29 legacy lint warnings остаются до удаления legacy; автоматический HTTPS проверяется на VPS в AN30-014/015.
- Следующий шаг: AN30-008, реализовать гостевой и пользовательский checkout, атомарные резервы с TTL и sandbox-платежи с idempotency, webhook и возвратами.

## AN30-008: заказы, резервы и sandbox-платежи

- Дата начала: 2026-08-01 03:24:00 +09.
- Дата завершения: 2026-08-01 03:57:09 +09.
- Статус: готово; production checkout намеренно закрыт до выбора боевого эквайринга и параметров чеков.
- Изменённые файлы: migration `0010_checkout_reservations`; checkout/payment/order модуль NestJS и 36-step CLI smoke; sandbox `PaymentProvider`; строгие контракты checkout/доставки/возврата; worker PostgreSQL TTL sweep; Compose secret/configuration gate; `docs/CHECKOUT_AND_PAYMENTS.md`, база, локальный запуск, безопасность, решения и журнал.
- Решения: клиент передаёт только товар и количество; API под shared catalog lock повторно читает цену, блокирует строку остатка и одной транзакцией создаёт резерв, immutable snapshots заказа и pending goods payment. Гостевой доступ защищён purpose-separated HMAC токена. Checkout, payment, webhook и refund имеют отдельные idempotency boundaries с проверкой payload.
- Резервы: строки остатков блокируются в стабильном порядке; последняя единица может быть зарезервирована только одним checkout. Успешный webhook уменьшает on-hand/reserved ровно один раз; отказ/отмена освобождает резерв. Worker с least-privilege ролью каждые 30 секунд вызывает `app.expire_stock_reservations(100)`, отменяя просроченные pending order/payment и создавая компенсирующие append-only inventory events.
- Платежи: sandbox поддерживает success, decline, timeout и cancel; webhook HMAC-подписан, external event ID и checksum защищают replay. Частичный/полный refund идемпотентен. Доставка согласуется отдельно, затем персонал создаёт отдельный payment. Для заказа существует не более одного live goods payment.
- Production gate: `production + ENABLE_PUBLIC_CHECKOUT=true + PAYMENTS_PROVIDER=sandbox` является ошибкой запуска; API до открытия порта сверяет конфигурацию с неизменяемой environment-меткой PostgreSQL. Production по умолчанию использует `PAYMENTS_PROVIDER=disabled` и закрытый checkout; staging может использовать sandbox. Секрет webhook добавлен только как Compose secret и локальное заведомо публичное значение в dev override.
- Команды проверок: `pnpm install --frozen-lockfile`; `pnpm peers check`; `pnpm verify:full`; production/dev Compose config; полный Docker build/up; schema smoke; миграция чистой production-БД из финального image; migration status; DDL denial и production seed rejection; 36-step checkout smoke; 25-step регрессия 1С; самостоятельный worker TTL smoke; OpenAPI/health/runtime scans; production sandbox startup guard.
- Результат БД: 10 миграций, 49 таблиц + 2 представления, 73 FK и 185 индексов; чистая БД показывает `applied: 10, pending: 0`, `schema_smoke=ok`; `an30_app` не может выполнять DDL, production seed отклонён. Currency RUB, immutable checkout items, unique live goods payment и TTL function проверены SQL smoke.
- Проверенная бизнес-логика: checkout из аккаунта требует cookie+CSRF, гостевой заказ не читается с чужим токеном; exact replay возвращает тот же заказ, а другой payload с тем же ключом получает `409`; два параллельных checkout последней единицы дают ровно `201 + 409`; неверная подпись webhook получает `401`; повтор того же и отдельный success event не списывают товар дважды; decline/cancel/timeout освобождают резерв; partial/full refund и их replay безопасны; отдельный delivery payment меняет total/paid ровно один раз.
- Worker smoke: специально созданный expired reservation автоматически перешёл в `expired`, reserved стал `0`, а worker записал `expiredCount: 1`; readiness worker подтверждает PostgreSQL, Redis и очередь.
- API/качество: OpenAPI публикует 10 checkout/order/payment путей; API и worker healthy. Lint без ошибок; 31 unit-тест, Playwright и production-сборки прошли; production audit содержит 0 critical/high и 3 moderate только в legacy. Финальные API/web/worker/Caddy runtime-образы не содержат Supabase/Lovable зависимостей, ключей или URL.
- Исправленные при smoke ошибки: параметры enum в SQL получили явные casts; TTL test сохраняет check `expires_at > created_at`; smoke-пользователи soft-delete вместо изменения append-only order history через FK; полный refund replay проверяется до проверки текущего payment status; webhook verification и provider idempotency key перенесены в границу `PaymentProvider`.
- Удалённые тестовые данные: временные `an30-an30008-postgres`, `an30_an30008_pgdata` и `an30-an30008-net` удалены без возможности восстановления; они содержали только чистую тестовую production-схему. Активные checkout-smoke пользователи, товары, склады и резервы удалены/soft-delete; неизменяемые локальные заказы, платежи, возвраты, audit и inventory history сохранены. Локальные rate-limit ключи очищались перед воспроизводимыми smoke. Рабочие volumes и старый Supabase не удалялись.
- Риски: боевой эквайринг, ключи, webhook-формат, параметры чеков и юридические реквизиты ещё не выбраны; поэтому production checkout остаётся технически закрыт. Checkout UI появится в AN30-011, staff queue/payment controls — в AN30-010. Реальные банковские timeout/reconciliation и receipt contract должны быть contract-tested после выбора провайдера.
- Следующий шаг: AN30-009, перенести WebSocket-чат, защищённые вложения и отключаемые notification/social/AI/storage адаптеры без обязательных облачных сервисов.

## AN30-009: автономный чат и адаптеры

- Дата начала: 2026-08-01 03:58:00 +09.
- Дата завершения: 2026-08-02 12:06:54 +09.
- Статус: готово.
- Изменённые файлы: migrations `0011_chat_realtime` и `0012_chat_message_edit_guard`; общие chat/search контракты; новые `chat`, `adapters` и catalog search модули API; outbox dispatcher и SMTP/Telegram/VK providers worker; local storage volume/init; 15-step CLI smoke; `.env.example`, Compose, security/migration tests, `docs/CHAT_AND_ADAPTERS.md`, решения и журналы.
- Решения: PostgreSQL является источником истории и монотонного cursor, Redis только fan-out; `clientMessageId` задаёт idempotency; guest token хранится как HMAC и передаётся только header/первым WS frame. Поиск не меняет ranking при подключении AI. Storage/notifications/social auth/AI имеют provider boundaries и disabled fallback; внешние уведомления идут только через outbox.
- Realtime: `/ws` требует точный `Origin`, session/TOTP либо guest token, frame не более 16 KiB, subscribe timeout 10 секунд, heartbeat 30 секунд и rate limit 60 событий/мин. Reconnect получает сообщения строго после `afterSequence`; Redis Pub/Sub позволяет масштабировать API горизонтально без потери durable history.
- Вложения: только JPEG/PNG/WebP до 5 MiB; declared MIME сверяется с magic bytes. Файл получает opaque key, права `0600`, хранится вне web-root и скачивается с `attachment`, `nosniff`, `no-store` только после проверки thread ownership. Пользовательское имя принадлежит сообщению, а не дедуплицированному storage object, поэтому не раскрывается другому чату. PDF/SVG/HTML закрыты до отдельного AV/sanitizer pipeline.
- Адаптеры: local `StorageProvider` работает автономно; SMTP требует TLS; Telegram Bot API и VK Messages включаются отдельно; VK retry использует стабильный `random_id`. Outbox использует `FOR UPDATE SKIP LOCKED`, recovery stale lock и exponential backoff. Отсутствующий обязательный секрет делает enabled provider ошибкой запуска; выключенные integrations не ломают магазин.
- Команды проверок: `pnpm verify:full`; production/dev Compose config; Docker build/up API/worker/database; `schema-smoke.sql`; 15-step `chat-smoke`; worker outbox poll; API/worker readiness; runtime scan `supabase|lovable`; проверка Nodemailer runtime version; `pnpm audit --prod --audit-level=high`.
- Результат: 12 миграций, 50 таблиц + 2 представления, 74 FK и 188 индексов; `schema_smoke=ok`. Chat smoke подтвердил guest IDOR denial, exact retry, changed-payload `409`, WS persist/ack, cursor reconnect, cross-origin denial, closed-thread `409`, signature check, forged MIME denial и attachment IDOR denial. Worker перевёл все три chat notification outbox events в `delivered` при выключенных необязательных каналах. Весь Compose-стек healthy.
- Качество: lint нового стека без ошибок; 34 unit-теста нового стека, legacy smoke и Playwright прошли; все production-сборки прошли. Найденный full-gate high advisory Nodemailer 7 устранён обновлением до исправленной `9.0.1`; финальный production audit содержит 0 critical/high и 3 moderate только в legacy. Финальные API/worker runtime-образы не содержат Supabase/Lovable строк, ключей или URL. Docker доверяет только frozen lock-файлу, уже проверенному до сборки, и больше не выполняет сотни повторных registry-запросов.
- Исправленные при smoke ошибки: volume вложений изначально принадлежал root — добавлен одноразовый `storage-init` и фиксированный непривилегированный API UID 10001; первая выбранная версия SMTP-библиотеки имела high advisory — обновлена до patched release; повторная загрузка содержимого ранее soft-deleted файла теперь восстанавливает storage object с новым ключом, а metadata исходного имени изолированы на уровне сообщения; cleanup не удаляет storage object, если на него ссылается другой активный чат; smoke всегда soft-delete тестовые threads/messages и удаляет только принадлежащие им физические файлы/outbox.
- Удалённые тестовые данные: 5 гостевых smoke-чатов и 8 сообщений soft-delete, 3 необязательных notification events и один тестовый PNG удалены; восстановление физического PNG не требуется. Append-only receipt/attachment links сохранены как история. Рабочие данные, volumes и старый Supabase не удалялись.
- Риски: реальные SMTP/Telegram/VK endpoints и credentials не предоставлены, поэтому внешняя доставка ещё не проверена; auth email в production будет retry/fail до подключения SMTP. Social auth и AI остаются безопасно отключёнными. Новый web ещё не использует chat API — клиентские и staff workflows входят в AN30-010/011.
- Следующий шаг: AN30-010, построить единое нативное рабочее место персонала поверх заказов, чатов, 1С, каталога, отчётов, настроек и аудита.

## AN30-010: рабочее место персонала

- Дата начала: 2026-08-02 12:07:00 +09.
- Дата завершения исходников: 2026-08-02 14:47:23 +09.
- Статус: готово в исходниках; browser/Compose smoke требуется повторить на staging из-за запрета сетевого bind и Docker socket в текущей песочнице.
- Изменённые файлы: migration `0013_staff_workspace`; строгие staff query/mutation контракты; новый `StaffModule`; расширенный 33-step auth/RBAC smoke; Next.js `/admin` и `/admin/[section]`; Fluent UI/TanStack workspace и 10 рабочих views; конфигурации Next/PostCSS/ESLint/Vitest; `docs/STAFF_WORKSPACE.md`, решения и журналы.
- Решения: UI не обращается к БД напрямую; фильтры, сортировка и пагинация выполняются сервером. Серверная RBAC остаётся источником доступа. Чат и накладные используют optimistic version. Менеджер назначает чат только себе, reopen доступен директору/admin. Аудитный список не возвращает чувствительные снимки и request metadata.
- Операции: реальная сводка; queue и массовые статусы заказов; карточка заказа со snapshot товаров/контактов/доставки/платежей; отмена pending reserve; частичные/полные sandbox-возвраты; realtime-чат; каталог; preview/apply/rollback 1С; атомарные накладные; команда/приглашения; 14-дневный отчёт; write-only настройки 1С; безопасный аудит.
- Интерфейс: Fluent UI и TanStack Table; сине-жёлтая идентичность АН-30 без декоративного AI-шаблона; светлая/тёмная тема; мобильное меню; клавиатурный skip-link; reduced motion; loading, empty, error, offline, conflict, confirmation и unsaved states. Ссылки сводки восстанавливают фильтры из URL. Blender не использовался, потому что 3D не улучшает административные операции.
- Команды проверок: `pnpm install --offline --frozen-lockfile --trust-lockfile`; `pnpm verify:full`; отдельные web/API/contracts/database test, typecheck, lint и build; production/dev Compose config; source scan на gradients, запрещённую пунктуацию и опасные frontend-паттерны; `git diff --check`.
- Результат: frozen install и обе Compose-конфигурации валидны; lint нового стека без ошибок; 43 unit-теста workspace + 1 legacy smoke прошли; API/contracts/database build и Next production build прошли. Web route graph содержит `/admin` и динамические staff-разделы. Два прохода независимого ревью после исправлений не нашли оставшихся P0–P2. `pnpm verify:full` дошёл до Playwright без ошибок кода, но webServer получил системный `listen EPERM 0.0.0.0:3000`; Docker socket также запрещён средой. `pnpm audit` повторно не получил npm advisory endpoint из-за `ENOTFOUND`; последний успешный audit перед новыми UI-пакетами содержал 0 critical/high и 3 moderate legacy.
- Исправленные при ревью ошибки: smoke ошибочно сохранял owner-cookie перед manager denial; денежный поток считался по дате заказа вместо успешных платежей/возвратов и не учитывал Asia/Chita; год накладной зависел от UTC; сообщение чата не меняло optimistic version; deep links сводки не применяли фильтр; импорт не показывал backend preview; фильтр аудита отправлял однобуквенный запрос; order queue не открывала состав/платежи и не позволяла освободить pending reserve; migrator ошибочно помечал staging-БД как production. Дополнительно устранены смешение UUID/boolean SQL-параметра назначения чата, захват менеджером чужого чата, выдача накладной для недопустимого заказа, смена idempotency key возврата при неопределённом ответе, гонки карточки заказа/preview 1С, потеря selection, обрыв большой истории чата и неполные accessibility/unsaved states.
- Риски: визуальная проверка реального браузера, SQL migration/schema smoke, 33-step HTTP smoke и повторный production audit обязательны на доступном Docker/staging окружении. Сгенерированный OpenAPI-клиент, axe/production E2E и нагрузочные проверки входят в AN30-013. Реальный refund/delivery provider остаётся закрыт до выбора эквайринга.
- Инфраструктура: владелец подтвердил домен `an30.ru` у Рег.ру и выбрал Timeweb Cloud: Ubuntu 24.04, Новосибирск, 4 vCPU, 8 ГБ RAM, 80 ГБ Premium NVMe, 100 Мбит/с, публичный IPv4 и provider backup. Диск нужно увеличить минимум до 120 ГБ перед production; дополнительно обязателен зашифрованный внешний backup. Создан отдельный временный Ed25519 deploy key вне репозитория и подтверждён вход по нему. Ранее раскрытый root-пароль не сохранён в проекте и должен быть заменён владельцем до отключения парольного/root SSH; отдельный `an30-deploy` ещё проверяется.
- Следующий шаг: AN30-011, заменить legacy storefront на полноценный клиентский Next.js-интерфейс с каталогом, карточкой товара, checkout, кабинетом, избранным и чатом, сохранив бренд и URL.
