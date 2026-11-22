# Проверка раскладки каталога на выгрузке из 1С

Скрипты этой папки отвечают на один вопрос: **куда правила сайта положат каждый товар из базы 1С** — до обмена, без базы данных и без подключения к 1С. Ими измерялась и доводилась раскладка в ноябре 2026 (итоги — `docs/OWN_CATALOG.md`, раздел «Проверка на базе владельца»).

Сами правила лежат в `apps/api/src/catalog/` (`catalog-known-categories.ts` — порядок решения, `catalog-part-dictionary.ts` — словарь деталей, `catalog-original-numbers.ts`, `catalog-tyre-size.ts`, `catalog-mixed-script.ts`). Скрипты читают собранный код (`apps/api/dist`, `packages/contracts/dist`), поэтому после каждой правки правил нужна сборка:

```bash
corepack pnpm --filter @an30/contracts build   # если менялось дерево разделов
corepack pnpm --filter @an30/api build
```

## Данные

Выгрузка — это данные владельца, в Git она не попадает: папка `local-data/` стоит в `.gitignore`. Скрипты берут самый новый файл `local-data/1c/nomenklatura-*.json` (или тот, что назван в переменной `AN30_1C_EXPORT_JSON`).

Как получить выгрузку — **только чтение, в 1С ничего не меняется**:

1. В 1С: «Продажи» → «Номенклатура» → «Ещё» → «Вывести список». Колонки: наименование, остаток, единица, цена, артикул, код, описание. Сохранить как `.xlsx` в `local-data/1c/nomenklatura-ГГГГ-ММ-ДД.xlsx`.
2. Перевести в JSON (нужен Python с `openpyxl`):

   ```bash
   python3 scripts/catalog-placement/export-to-json.py local-data/1c/nomenklatura-ГГГГ-ММ-ДД.xlsx
   ```

   Если колонка цены называется не «Оптовая цена», добавьте `--price-column "…"`.

В списке из 1С нет групп, брендов и картинок. Поэтому всё здесь измеряет раскладку **по названию и артикулу**. С группами настоящего обмена результат будет другим (группа сильнее названия, если они не спорят о разделе) — это проверяется только обменом.

Скрипты читают названия так, как они написаны в 1С. Обмен сохраняет названия без пометок сотрудников (`publicProductName`), но на раскладку это не влияет: на всей выгрузке раздел для названия как есть и для очищенного совпадает (проверено 22.11.2026, 0 отличий из 42 723).

## Скрипты

| Команда | Что показывает |
| --- | --- |
| `node scripts/catalog-placement/queue-heads.mjs [сколько] [примеров]` | Очередь «Без категории» по главному слову названия: сколько позиций и с чего начать |
| `node scripts/catalog-placement/queue-names.mjs <сколько> <слово…>` | Настоящие названия из очереди по главному слову — из них пишутся тесты |
| `node scripts/catalog-placement/placed-by-noun.mjs <сколько> <слово…>` | Куда сейчас попадают названия с этим главным словом, по полкам, с примерами |
| `node scripts/catalog-placement/unrefined.mjs [сколько]` | Товары, получившие раздел без подраздела |
| `node scripts/catalog-placement/dump-placement.mjs <файл>` | Полка каждого товара базы в файл; два таких файла сравнивает следующий скрипт |
| `python3 scripts/catalog-placement/diff-placement.py <до> <после> [строк]` | Какие товары сменили полку между двумя снимками |
| `node scripts/catalog-placement/sample-placement.mjs [размер] [зерно]` | Случайная выборка для просмотра глазами → `local-data/1c/sample-<размер>-seed<зерно>.tsv`. Уже записанную выборку не перезаписывает: повтор идёт в `…-rerun.tsv`, а сменившие полку строки печатаются |
| `node scripts/catalog-placement/original-number-codes.mjs [мин. позиций] [мин. согласие] [примеров на код]` | Кандидаты в таблицы оригинальных номеров (`catalog-original-numbers.ts`): коды, на которых сходятся товары с понятным названием. Считает два формата отдельно: обычный «48815-60111» (строки `5-5:`) и Honda «51306-S47-003» (строки `honda:`) — у Honda своя нумерация деталей. Третий аргумент печатает несколько примеров на код: каждую строку нужно прочитать глазами, прежде чем вносить код в таблицу |
| `node scripts/catalog-placement/group-tree.mjs [own\|chain\|none\|all]` | Какой раздел даёт каждая группа 1С сама по себе и вместе с родителями. Читает дерево групп `local-data/1c/groups-tree-*.txt` (текст, два пробела на уровень; записано с экрана 1С — в списке номенклатуры групп нет) |
| `python3 scripts/catalog-placement/build-commerceml.py [выгрузка.json]` | Файлы `rehearsal-import.xml` и `rehearsal-offers.xml` в `local-data/1c/` для репетиции обмена на полном объёме (см. ниже) |
| `node scripts/catalog-placement/exchange-upload.mjs [папка]` | Играет роль 1С в обычном «Обмене с сайтом»: вход, передача `rehearsal-import.xml` и `rehearsal-offers.xml` частями, загрузка до ответа «success». Так выгрузка владельца кладётся на стенд до подключения настоящей 1С (22.11.2026 — на демо-сайт: 42 723 товара за 2 минуты, цены и остатки за 3). Адрес, пользователь и файл с паролем — в переменных `ONE_C_EXCHANGE_URL`, `ONE_C_EXCHANGE_USER`, `ONE_C_EXCHANGE_PASSWORD_FILE` |
| `node apps/api/dist/cli/catalog-placement-audit.js <import.xml или список>` | То, что решит обмен, по настоящему файлу обмена (с группами и артикулами): разделы, что решило, отчёт по каждой группе 1С. Простой список названий — только по названиям |

## Порядок работы (так доводилась раскладка)

1. **Замер.** `queue-heads.mjs 100 2` — что лежит в очереди; `unrefined.mjs 7` — что осталось без подраздела.
2. **Посмотреть настоящие названия** одной группы: `queue-names.mjs 9 <слово>`.
3. **Красный тест** с этими названиями: `apps/api/src/catalog/catalog-part-dictionary.test.ts`, блок `names from the owner's base` (подразделы масел, АКБ, шин — `catalog-known-categories.test.ts`). Запустить и увидеть, что тест падает по нужной причине.
4. **Правка правил**, тесты зелёные (`corepack pnpm --filter @an30/api exec vitest run src/catalog`).
5. **Сравнить всю базу до и после** — обязательно после любой общей правки:

   ```bash
   node scripts/catalog-placement/dump-placement.mjs /tmp/before.tsv      # до правки
   corepack pnpm --filter @an30/api build                                  # после правки
   node scripts/catalog-placement/dump-placement.mjs /tmp/after.tsv
   python3 scripts/catalog-placement/diff-placement.py /tmp/before.tsv /tmp/after.tsv 120
   ```

   Просмотреть каждую группу переездов. Этот шаг в ноябре 2026 нашёл больше десяти ошибок, которых тесты не ловили (например, шесть масляных фильтров в «Моторных маслах»). На каждую найденную ошибку — свой красный тест, потом правка.
6. **Независимая проверка.** Новая выборка с новым зерном (`sample-placement.mjs 300 <зерно>`), просмотр всех строк глазами, подсчёт: сколько получили раздел, сколько из них не в том разделе, сколько не в том подразделе. Сначала записать итог, потом чинить найденное: выборка, по которой чинили, больше ничего не доказывает.

## Репетиция обмена на полном объёме

Проверяет не правила, а сам обмен: оба файла проходят через настоящий `OneCExchangeService` в настоящую пустую базу PostgreSQL, порциями, как их опрашивает 1С.

```bash
python3 scripts/catalog-placement/build-commerceml.py            # файлы rehearsal-*.xml в local-data/1c/
createdb an30_exchange_rehearsal
DATABASE_URL=postgresql://localhost/an30_exchange_rehearsal DATABASE_ENVIRONMENT=development node packages/database/dist/migrate.js up
ONE_C_REHEARSAL_DIR="$PWD/local-data/1c" ONE_C_REHEARSAL_DATABASE_URL=postgresql://localhost/an30_exchange_rehearsal \
  corepack pnpm --filter @an30/api exec vitest run src/one-c-exchange/one-c-exchange.rehearsal.test.ts
dropdb an30_exchange_rehearsal
```

База должна быть пустой и отдельной: остатки пишутся в журнал, из которого нельзя удалять, поэтому на стенде и на базе других тестов репетицию запускать нельзя (тест сам откажется, если в базе уже есть товары). Тест падает, если обмен что-то отклонил, принял не все товары или оставил без раздела не столько товаров, сколько предсказывают правила.

## Чего здесь нельзя

- Нельзя класть выгрузку, снимки и выборки в Git: это данные владельца.
- Нельзя чинить раскладку правкой «под выборку» без теста: следующая общая правка её сломает.
- Нельзя брать знания о деталях из TecDoc и других внешних каталогов (`docs/TECDOC.md`): словарь и таблицы составлены по языку торговли и по собственной базе магазина.
