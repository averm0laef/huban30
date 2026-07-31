# Changelog

Все пользовательские изменения АН-30 фиксируются в этом файле. Формат основан на Keep a Changelog.

## [Unreleased]

### Added

- AN30-001: создан безопасный шаблон конфигурации `.env.example`.
- AN30-001: добавлены проектный журнал, журнал решений, базовый аудит и политика безопасности.
- AN30-003: добавлены unit и Playwright smoke-тесты, команды `typecheck`, `test`, `test:e2e`, `audit:prod`, `verify` и `verify:full`.
- AN30-004: добавлены автономные приложения Next.js, NestJS и BullMQ worker, общие Zod-контракты, PostgreSQL 18, Redis 8 и Caddy.
- AN30-004: добавлены live/ready healthcheck, OpenAPI JSON, Docker healthcheck, локальный Compose override и руководство запуска.
- AN30-005: добавлена чистая PostgreSQL-схема для пользователей, каталога, 1С, остатков, резервов, заказов, платежей, чата, контента, персонала, отчётов и аудита.
- AN30-005: добавлены checksum-защищённые forward-only миграции, Compose migration gate, SQL smoke-тест и идемпотентный dev-only seed.

### Changed

- AN30-001: файлы окружения, локальные секреты, runtime-данные и резервные копии исключены из Git.
- AN30-002: необязательные legacy AI, social auth, Telegram и admin-bootstrap функции заменены безопасным ответом об отключении.
- AN30-002: настройки 1С больше не загружают сохранённый пароль в браузер.
- AN30-003: проект закреплён на Node.js 24 и pnpm 11 с одним `pnpm-lock.yaml`.
- AN30-003: Vite, TypeScript, ESLint и test toolchain обновлены до совместимых актуальных версий.
- AN30-003: базовые canonical, Open Graph и Schema.org URL изменены с legacy-хостинга на `an30.ru`.
- AN30-004: Playwright smoke-тест переведён с legacy Vite/Supabase на автономный Next storefront.
- AN30-004: Docker-образы собираются из минимального workspace-графа и разворачивают только production-зависимости приложения.
- AN30-005: API запускается только после успешного применения схемы; production-каталог остаётся пустым до импорта из 1С.

### Security

- AN30-001: жёстко заданные данные первого администратора и fallback-секрет создания администратора удалены из исходников до первой фиксации Git.
- AN30-001: небезопасное значение пароля 1С по умолчанию удалено из legacy-миграции.
- AN30-002: wildcard CORS удалён из всех legacy Edge Functions.
- AN30-002: обмен с 1С закрыт IP allowlist, rate limit и обязательной проверкой секрета на каждом запросе.
- AN30-002: небезопасный анонимный доступ к чужим гостевым чатам и публичным вложениям закрыт миграцией.
- AN30-002: добавлен проверяемый список ротации ранее использованных ключей и паролей.
- AN30-003: удалён `lovable-tagger`; supply-chain policy разрешает install scripts только SWC и esbuild.
- AN30-003: production audit не содержит high или critical уязвимостей.
- AN30-004: production secrets вынесены в Compose secrets с поддержкой root-only каталога вне репозитория.
- AN30-004: CORS API ограничен origin сайта; Caddy добавляет базовые security headers и готов к автоматическому HTTPS.
- AN30-004: исправленные версии `sharp`, `postcss`, `find-my-way` и `js-yaml` закреплены overrides; production audit снова содержит 0 high/critical.
- AN30-005: environment-метка БД становится неизменяемой после инициализации; demo-товары отклоняются триггером вне development.
- AN30-005: движения остатков, история заказов, табель и аудит защищены append-only триггерами; деньги хранятся целыми копейками.
