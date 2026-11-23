# Проверки API UMAPI

`probe.mjs` — первая проверка ключа UMAPI. Что проверяем и зачем — в [docs/UMAPI_INTEGRATION.md](../../docs/UMAPI_INTEGRATION.md), раздел 3.

```bash
node scripts/umapi-checks/probe.mjs
```

- Ключ — одной строкой в `secrets/umapi_api_key.txt`. Папка `secrets/` в Git не попадает, ключ скрипт не печатает.
- Делает около 10 запросов. Ничего не сохраняет: аналоги и применимость только считаются и сверяются с нашим справочником машин в памяти.
- Для сверки номеров машин нужны файл `local-data/umapi/cb_passenger_cars.csv` и собранный пакет базы данных: `corepack pnpm --filter @an30/database build`.
- Адрес и регион можно поменять переменными окружения: `UMAPI_BASE_URL` (по умолчанию `https://api.umapi.ru`) и `UMAPI_LOCALE` (по умолчанию `ru-WWW`, можно попробовать `ru-RUS`).

Это ручная проверка, а не тест: в автоматических тестах платные провайдеры не вызываются.
