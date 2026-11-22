# Фото товаров в объектном хранилище (S3)

Фотографии карточек можно хранить не на диске сервера, а в дешёвом S3-совместимом хранилище. База фото растёт там; на сервере остаются только записи в PostgreSQL (какой товар, какой файл, размер, SHA-256).

## Как это работает

- Фото приходят из 1С (`<Картинка>` в `import.xml`, файлы — `mode=file`). Каждое проходит прежнюю проверку: тип по сигнатуре (JPEG/PNG/WebP, до 10 МБ), ClamAV, проверка изображения. Только после этого файл кладётся в хранилище.
- `PRODUCT_PHOTO_STORAGE=s3` — новые фото пишутся в бакет под ключом `catalog/ГГГГ-ММ/<uuid>.<расширение>`; в `app.storage_objects.provider` записывается `s3`. `PRODUCT_PHOTO_STORAGE=local` (по умолчанию) — как раньше, на диск.
- Читается фото из того хранилища, которое названо в его записи. Поэтому фото, сохранённые на диск до переключения, остаются на сайте, а новые идут в бакет.
- Бакет **закрытый**. Покупатель получает фото по прежнему адресу `/api/v1/catalog/media/<id>`: API читает объект из бакета, сверяет размер, тип и SHA-256 с записью в базе и только тогда отдаёт. Подменённый или повреждённый объект не показывается. Браузер кеширует фото на сутки.
- Если хранилище недоступно во время обмена, фото пропускается и считается в «пропущено» — цены и остатки обмен всё равно применяет. Фото приедет при следующей выгрузке, в которой 1С его пришлёт.
- Вложения чата и баннеры в S3 не уходят: это личные файлы покупателей и несколько картинок, они остаются на сервере.

## Что нужно от владельца

1. Завести у провайдера S3-совместимое хранилище и **закрытый** (private) бакет, например `an30-photos`. Подойдёт любой провайдер с S3 API: Selectel, Timeweb Cloud, Yandex Object Storage, VK Cloud, Beget. Выгоднее всего тот, у кого стоит сам сервер: трафик между сервером и хранилищем внутри одного провайдера обычно бесплатный. Класс хранения — стандартный («горячий»): фото читаются постоянно.
2. Выпустить ключ доступа (Access Key ID + Secret Access Key) с правами **только на этот бакет**: чтение, запись и удаление объектов. Права на список бакетов и управление не нужны.
3. Передать четыре значения: адрес API (endpoint), регион, имя бакета и пару ключей.

| Настройка | Где | Пример |
| --- | --- | --- |
| `PRODUCT_PHOTO_STORAGE` | файл настроек | `s3` |
| `S3_ENDPOINT` | файл настроек | `https://s3.ru-1.storage.selcloud.ru` (Selectel), `https://s3.twcstorage.ru` (Timeweb), `https://storage.yandexcloud.net` (Yandex) — сверить в панели провайдера |
| `S3_REGION` | файл настроек | `ru-1`, у Yandex — `ru-central1` |
| `S3_BUCKET` | файл настроек | `an30-photos` |
| `S3_FORCE_PATH_STYLE` | файл настроек | `true` (подходит всем перечисленным) |
| Access Key ID | `/etc/an30/secrets/s3_access_key_id.txt` | — |
| Secret Access Key | `/etc/an30/secrets/s3_secret_access_key.txt` | — |

С `PRODUCT_PHOTO_STORAGE=s3` сайт не запустится, если пуст адрес, бакет или ключ, либо адрес не HTTPS.

## Включение на сервере

**При обновлении сервера на эту версию**, до `docker compose up`, выполнить `init-secrets.sh` (он в порядке обновления, `docs/OPERATIONS.md`): файлы ключей S3 должны существовать и при выключенном S3, пустые, — иначе `docker compose` не запустит API. Скрипт создаёт недостающие пустые файлы и не меняет заполненные.

```bash
sudo env AN30_SECRETS_DIR=/etc/an30/secrets sh /opt/an30/app/scripts/init-secrets.sh
```

Включение S3, когда есть бакет и ключи:

```bash
sudo nano /etc/an30/secrets/s3_access_key_id.txt
sudo nano /etc/an30/secrets/s3_secret_access_key.txt
# выровнять права на файлы после правки
sudo env AN30_SECRETS_DIR=/etc/an30/secrets sh /opt/an30/app/scripts/init-secrets.sh
# в файле настроек: PRODUCT_PHOTO_STORAGE=s3, S3_ENDPOINT, S3_REGION, S3_BUCKET
```

Затем перезапустить API (раздел 12 `docs/DEPLOY_VPS.md`, перед этим — резервная копия). Проверка: выгрузить из 1С товар с фото, открыть его карточку; в журнале обмена — «изображений прикреплено», в бакете появился объект `catalog/…`.

## Резервные копии и расход

- `scripts/backup.sh` архивирует базу и том вложений сервера; объекты бакета в архив не входят. Источник фото — 1С: при потере бакета их возвращает полная выгрузка. Чтобы не зависеть от этого, включите у провайдера версионирование бакета.
- Сменили бакет — перенесите в новый все объекты `catalog/` с теми же ключами (например, `rclone sync`): записи в базе ссылаются на ключ, а не на бакет.
- Оценка объёма: фото карточки после 1С обычно 100–500 КБ, то есть 42 тысячи товаров по одному фото — порядка 5–20 ГБ.

## Локальная проверка

Тесты поставщика хранилища идут в обычном `corepack pnpm test` на встроенном подставном S3. Проверка на настоящем S3-совместимом сервере и базе (фото из 1С → бакет → карточка) включается переменными:

```bash
# любой S3-совместимый сервер, например SeaweedFS: weed server -s3 -s3.port=8333 -s3.config=s3.json
createdb an30_s3_scratch
DATABASE_URL=postgresql://localhost/an30_s3_scratch DATABASE_ENVIRONMENT=development node packages/database/dist/migrate.js up
CATALOG_SEARCH_DATABASE_URL=postgresql://localhost/an30_s3_scratch \
S3_TEST_ENDPOINT=http://127.0.0.1:8333 S3_TEST_BUCKET=an30-media-test \
S3_TEST_ACCESS_KEY_ID=… S3_TEST_SECRET_ACCESS_KEY=… \
corepack pnpm --filter @an30/api exec vitest run src/adapters/s3-storage.provider.test.ts src/one-c-exchange/product-photos-s3.integration.test.ts
```

### Проверка на тестовой базе товаров

Репетиция на копии тестовой базы (42 723 товара): 40 товаров берутся из выгрузки 1С как есть, каждому добавляется `<Картинка>`, файл идёт через настоящий обмен. Проверяется: все фото в бакете и ни одного на диске, карточка отдаёт те же байты, повторная выгрузка не создаёт дублей, подменённый в бакете объект не отдаётся, при недоступном бакете обмен завершается, а товары не меняются. Антивирус в репетиции заменён заглушкой; изображение проверяет настоящий `ffprobe`.

```bash
createdb an30_photo_rehearsal
pg_restore --no-owner -d an30_photo_rehearsal database/an30-test-base-2026-11-23.dump
PRODUCT_PHOTO_REHEARSAL_DATABASE_URL=postgresql://localhost/an30_photo_rehearsal \
PRODUCT_PHOTO_REHEARSAL_DIR="$PWD/local-data/1c" \
S3_TEST_ENDPOINT=http://127.0.0.1:8333 S3_TEST_BUCKET=an30-media-test \
S3_TEST_ACCESS_KEY_ID=… S3_TEST_SECRET_ACCESS_KEY=… \
corepack pnpm --filter @an30/api exec vitest run src/one-c-exchange/product-photos-s3.rehearsal.test.ts
dropdb an30_photo_rehearsal
```

Репетиция пишет в базу и не убирает за собой: только копия, никогда не стенд и не сервер.

Локальный стенд с S3: `DEPLOYMENT_ENVIRONMENT=development PRODUCT_PHOTO_STORAGE=s3 S3_ENDPOINT=http://127.0.0.1:8333 …` — адрес без HTTPS разрешён только на стенде разработки.
