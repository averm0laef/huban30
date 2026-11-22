# АН-30 — заметки для агентов

Монорепозиторий: `apps/web` (Next.js 16, витрина и админка), `apps/api` (NestJS + Fastify), `apps/worker` (outbox: почта, Telegram/VK, поисковый индекс), `packages/contracts` (zod-контракты, общие функции), `packages/database` (миграции SQL), `packages/messaging`. Менеджер пакетов — `corepack pnpm`.

## Проверка

```bash
corepack pnpm lint
corepack pnpm typecheck        # сначала собирает contracts и messaging
corepack pnpm test
corepack pnpm --filter @an30/web build
```

Реальный регрессионный набор поиска (163 запроса) — на отдельной пустой БД:

```bash
createdb an30_search_scratch
DATABASE_URL=postgresql://localhost/an30_search_scratch DATABASE_ENVIRONMENT=development node packages/database/dist/migrate.js up
CATALOG_SEARCH_DATABASE_URL=postgresql://localhost/an30_search_scratch corepack pnpm --filter @an30/api exec vitest run src/catalog/catalog-search-regression.test.ts
dropdb an30_search_scratch
```

После правок в `packages/contracts` пересоберите его (`corepack pnpm --filter @an30/contracts build`): API и сайт читают `dist`.

Проверки витрины, которых не дают снимки экрана (меню «Каталог» движением мыши и клавиатурой; запросы сайта к API на одного посетителя) — `scripts/storefront-checks/README.md`. Запускайте после правок шапки, меню и чтения каталога на сайте.

Замеры поиска на ассортименте владельца (разговорные запросы; товары с сокращениями в названии) — `scripts/search-checks/README.md`. Запускайте после правок поиска и таблицы сокращений словаря деталей: регрессионный набор идёт на двух сотнях товаров-образцов и не видит того, что видно на 42 тысячах.

Сквозные тесты (`corepack pnpm test:e2e`) идут на сайте без API. На 22.11.2026 семь из девятнадцати не проходят (чат, поиск по VIN, подтверждение регистрации, настройка подключений) — они отстали от сайта и не разобраны; не принимайте их падение за последствие своей правки, не сверившись с этим списком.

## Локальный стенд

- Сайт: `corepack pnpm --filter @an30/web dev` → http://192.168.1.92:3000 (порт 3000).
- API: собрать `corepack pnpm --filter @an30/api build`, запуск — `sh scripts/dev/run-api-preview.sh` (он же `api-preview` в `.claude/launch.json`; порт 4000, `API_BIND_HOST=0.0.0.0`, настройки стенда из `secrets/local_stand.env`, ключи подбора из `secrets/parts_finder.env`, Rossko — когда заполнены `secrets/rossko_key1.txt` и `rossko_key2.txt`).
- БД стенда: `an30_ux_2b40952e`. Миграции: `DATABASE_ENVIRONMENT=development DATABASE_URL=… node packages/database/dist/migrate.js up`.
- Секреты лежат в `secrets/` (в Git не попадает). Не печатайте и не коммитьте их содержимое.

## Правила проекта

- Дизайн: цвета логотипа (#1800E0, #140F57, жёлтый #F5C400), Montserrat в заголовках; без «ИИ-шаблонов» (иконки в цветных плитках, градиентные пятна, акцентные полосы слева). Для любых изменений интерфейса — скилл `ui-ux-pro-max` как чек-лист (цели 44 px, текст ≥ 12 px, контраст, reduced motion); его палитры и шрифты не применять.
- Каждое изменение интерфейса проверяйте скриншотами на 1440, 768 и 375 px: без наложений и горизонтальной прокрутки. Снимок не видит поведения: всё, что открывается наведением, проверяйте движением мыши шагами (а не `hover()`, который переносит её мгновенно) и клавиатурой.
- Платные провайдеры (FAPI, TecDoc, ReefAPI, Apify, Groq) в тестах не вызываются — только подставные ответы.
- TecDoc (tecdoc.site): только «запрос — ответ» для посетителя. Нельзя писать его данные в PostgreSQL (в том числе в `app.article_crosses`), вызывать его из фоновых задач и увеличивать кеш без письменного согласия поставщика — см. `docs/TECDOC.md`.
- Разделы каталога и сортировка товаров из 1С — `docs/OWN_CATALOG.md`; при изменении `storefront-taxonomy.ts` нужна миграция с теми же строками.
- Описание подбора — `docs/PARTS_FINDER.md`, обмена с 1С — `docs/ONE_C_INTEGRATION.md`, поиска — `docs/SEARCH_ENGINE.md`.

## Репозиторий

- GitHub: `averm0laef/huban30` (закрытый), ветка `main`. Каждая отправка проверяется в GitHub Actions (`.github/workflows/ci.yml`): lint, типы, тесты, сборка сайта.
- Коммиты: `тип(AN30-0NN): что и зачем` (`feat`, `fix`, `docs`, `chore`, `ci`, `security`), в теле — причина и чем проверено. Одно изменение — один коммит; перед коммитом зелёные `lint`, `typecheck`, `test`.
- В Git не попадают: `secrets/`, `local-data/` (выгрузки 1С — данные владельца), `.env*`, резервные копии базы. Резервные копии базы лежат на сервере в зашифрованном виде (`scripts/backup.sh`), не в репозитории.
