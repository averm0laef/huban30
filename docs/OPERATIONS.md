# Эксплуатация АН-30

Документ описывает развёртывание, обновление, откат, резервное копирование и
восстановление автономного стека. Время везде указывается в UTC на сервере и в
Asia/Chita в журналах проекта.

## Инфраструктура

| Параметр | Значение |
| --- | --- |
| Сервер | Timeweb Cloud, Ubuntu 24.04 LTS, 4 vCPU, 8 ГБ RAM, 80 ГБ NVMe |
| Адрес | `185.177.216.238` |
| Staging | `https://staging.an30.ru` — закрытый, `noindex` |
| Production | `an30.ru` — переключается только в AN30-015 после приёмки |
| Каталог приложения | `/opt/an30/app` |
| Конфигурация окружения | `/etc/an30/staging.env` |
| Секреты | `/etc/an30/secrets` (каталог `0700 root`, файлы `0444 root`) |
| Резервные копии | `/var/backups/an30` (каталог `0700 root`) |

Доступ по SSH только по ключу, под пользователем `an30-deploy` с `sudo`.

## Развёртывание с нуля

```bash
# 1. Каталоги
sudo install -d -m 0755 -o an30-deploy -g an30-deploy /opt/an30
sudo install -d -m 0700 /etc/an30/secrets

# 2. Исходники (с машины разработчика)
git archive --format=tar HEAD | gzip > /tmp/an30-src.tar.gz
scp /tmp/an30-src.tar.gz an30-deploy@185.177.216.238:/tmp/
ssh an30-deploy@185.177.216.238 'mkdir -p /opt/an30/app && tar xzf /tmp/an30-src.tar.gz -C /opt/an30/app'

# 3. Секреты. Значения генерируются на сервере и никогда не печатаются.
sudo env AN30_SECRETS_DIR=/etc/an30/secrets sh /opt/an30/app/scripts/init-secrets.sh

# 4. Конфигурация окружения
sudo install -m 0644 /opt/an30/app/deploy/staging.env.example /etc/an30/staging.env

# 5. Сборка и запуск
cd /opt/an30/app
sudo AN30_SECRETS_DIR=/etc/an30/secrets docker compose --env-file /etc/an30/staging.env up -d --build
```

Одноразовый сервис `migrate` применяет миграции до старта API. Его состояние
`Exited (0)` — ожидаемое. Первый владелец создаётся отдельной командой, см.
`docs/ADMIN_ACCESS.md`.

## Обновление

Исходники распаковываются в **чистый** каталог, который затем подменяет
рабочий. Распаковка поверх существующего дерева (`tar xzf -C /opt/an30/app`)
для обновления непригодна: `tar` записывает то, что есть в архиве, но не
удаляет то, чего в нём больше нет. Файл, удалённый из репозитория, остаётся
на сервере навсегда и продолжает отдаваться — так на витрине несколько недель
жили удалённые баннеры, а `COPY` в `apps/web/Dockerfile` собирался с давно
удалённого пути, из-за чего поломка сборки не проявлялась до чистого сервера.

```bash
# 1. Архив с машины разработчика
git archive --format=tar HEAD | gzip > /tmp/an30-src.tar.gz
scp /tmp/an30-src.tar.gz an30-deploy@185.177.216.238:/tmp/

# 2. Распаковка в чистое дерево и подмена. Предыдущее остаётся как app.old —
#    это и есть быстрый откат: mv app.old app && пересборка.
ssh an30-deploy@185.177.216.238 'set -e
  cd /opt/an30
  rm -rf app.new && mkdir -p app.new
  tar xzf /tmp/an30-src.tar.gz -C app.new
  rm -rf app.old && mv app app.old && mv app.new app'

# 3. Сборка и запуск
cd /opt/an30/app
sudo AN30_SECRETS_DIR=/etc/an30/secrets docker compose --env-file /etc/an30/staging.env up -d --build
sudo AN30_SECRETS_DIR=/etc/an30/secrets docker compose --env-file /etc/an30/staging.env ps
curl -fsS https://staging.an30.ru/health/ready

# 4. После успешной проверки — очистка кеша сборки Docker
sudo docker builder prune -f
```

Кеш сборки не очищается сам: каждое обновление добавляет в него несколько
гигабайт. На стенде за сутки частых обновлений он занял 44 ГБ из 80.
`docker builder prune -f` удаляет только кеш; образы, контейнеры и тома с
данными он не трогает, следующая сборка просто пройдёт дольше.

Проверка, что удаление действительно доехало: запросить любой заведомо
удалённый файл и убедиться, что отдаётся 404, а не 200 из старого образа.

Перед обновлением production обязательно запускается внеочередная резервная
копия: `sudo systemctl start an30-backup.service`.

## Откат

Образы предыдущей версии остаются в локальном реестре Docker. Порядок отката:

1. Остановить приложение, оставив базу: `docker compose stop api worker web`.
2. Если проблема в коде — развернуть предыдущий Git-коммит и пересобрать.
3. Если повреждены данные — восстановить базу из архива, см. ниже.
4. Поднять стек и проверить `/health/ready` до объявления восстановления.

Миграции forward-only и не откатываются автоматически. Откат схемы выполняется
только восстановлением из резервной копии, снятой до применения миграции.

## Резервное копирование

`scripts/backup.sh` запускается systemd-таймером `an30-backup.timer` каждые
15 минут, что соответствует целевому RPO.

Артефакты за один запуск:

- `an30-db-<stamp>.dump.zst.gpg` — `pg_dump` в custom-формате;
- `an30-uploads-<stamp>.tar.zst.gpg` — том вложений.

Оба зашифрованы AES-256 паролем из `/etc/an30/secrets/backup_passphrase.txt`.
Дамп проверяется `pg_restore --list` внутри контейнера до шифрования, поэтому
повреждённый архив не заменит исправный.

Срок хранения — 14 дней (`AN30_RETAIN_DAYS`). Все копии хранятся только первые
48 часов (`AN30_KEEP_ALL_HOURS`); от более старых суток остаётся последняя
копия дня. Без прореживания 96 копий в сутки за 14 дней занимают диск: на
ассортименте в 42 тысячи товаров один архив базы весит около 21 МБ, то есть
около 29 ГБ вместо примерно 4,5 ГБ.

```bash
sudo systemctl start an30-backup.service      # внеочередная копия
systemctl list-timers an30-backup.timer       # расписание
sudo journalctl -u an30-backup.service -n 50  # журнал
```

**Пароль резервных копий нужно хранить вне сервера.** Без него архивы
восстановить невозможно. Смена пароля делает все прежние архивы нечитаемыми.

Внешнее копирование пока не настроено: локальные копии не спасают от потери
самого сервера. До production нужно настроить выгрузку `/var/backups/an30` в
независимое хранилище.

## Восстановление

Проверка архива без затрагивания рабочих данных — восстановление во временную
базу, подсчёт объектов и её удаление:

```bash
cd /opt/an30/app
ARCHIVE=$(sudo sh -c 'ls -1 /var/backups/an30/an30-db-*.dump.zst.gpg | tail -1')
sudo AN30_SECRETS_DIR=/etc/an30/secrets bash scripts/restore.sh --verify "$ARCHIVE"
```

Восстановление поверх рабочей базы требует явного подтверждения словом
`RESTORE` и останавливает приложение на время операции:

```bash
sudo AN30_SECRETS_DIR=/etc/an30/secrets bash scripts/restore.sh --into-production "$ARCHIVE"
```

Целевой RTO — 2 часа. Проверка восстановления выполняется не реже одного раза в
месяц и записывается в `docs/PROJECT_STATUS.md`.

## Сеть и доступ

UFW включён, политика по умолчанию — запрет входящих:

| Порт | Назначение |
| --- | --- |
| 22/tcp | SSH |
| 80/tcp | HTTP: ACME и редирект на HTTPS |
| 443/tcp, 443/udp | HTTPS и HTTP/3 |
| 10050/tcp | Zabbix-агент Timeweb |

Docker управляет `iptables` в обход UFW, поэтому опубликованные порты 80 и 443
доступны независимо от правил UFW. UFW защищает службы самого хоста.

Порт `10050` открыт для всего интернета — его следует ограничить подсетью
мониторинга Timeweb.

## Наблюдение

Проверки состояния:

```bash
curl -fsS https://staging.an30.ru/health/live
curl -fsS https://staging.an30.ru/health/ready   # подтверждает PostgreSQL, Redis и ClamAV
docker compose --env-file /etc/an30/staging.env ps
```

Логи структурированные, в формате JSON, с маскированием паролей, email и IP.
Драйвер `local`, ротация 10 МБ × 5 файлов настроена в `/etc/docker/daemon.json`.

```bash
sudo docker compose --env-file /etc/an30/staging.env logs -f --tail=100 api
sudo docker compose --env-file /etc/an30/staging.env logs --since 1h worker
```

Автоматические обновления безопасности Ubuntu включены через
`unattended-upgrades`.

## Инциденты

1. Зафиксировать время и симптом; снять внеочередную резервную копию.
2. Проверить `/health/ready` и состояние контейнеров.
3. Прочитать логи затронутого сервиса за период инцидента.
4. Если затронуты данные — восстановить из архива по процедуре выше.
5. Записать причину, действия и результат в `docs/PROJECT_STATUS.md`.

При компрометации секретов следовать `docs/SECRET_ROTATION.md`: секреты
перевыпускаются, сессии отзываются, действия фиксируются в журнале аудита.
