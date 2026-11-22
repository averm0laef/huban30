# Безопасность фото и видео в чате

## Рабочая схема

API принимает JPEG, PNG и WebP до 5 МиБ, а MP4, MOV и WebM до 15 МиБ. До записи в хранилище и БД файл последовательно проходит:

1. проверку фактической сигнатуры и MIME;
2. синхронный ClamAV `INSTREAM` scan — чистым считается только точный ответ `stream: OK`;
3. `ffprobe` container/duration/dimension check;
4. полный decode pass через `ffmpeg` с одним потоком, запретом внешних протоколов, timeout и memory limit.

На получение тела вложения отведено 30 секунд; допускается до восьми
параллельных получений. При обрыве или истечении времени поток закрывается,
а допуск освобождается. Отдельный общий слот тяжёлой проверки берётся после
получения файла, поэтому незавершённая передача не удерживает его.
Общий HTTP requestTimeout составляет 35 секунд.

Заражённый, повреждённый или слишком длинный файл получает HTTP 400 и не создаёт storage object. Если clamd, ffprobe или ffmpeg недоступны, загрузка fail-closed с HTTP 503. Readiness API тоже становится `degraded`, если clamd не отвечает.

Антивирус снижает риск известных угроз, но не является обещанием абсолютной безопасности; ограничения форматов, изолированный protocol whitelist и decode check остаются обязательными слоями защиты.

ClamAV доступен только в Docker-сети `backend`; порт 3310 на хост не публикуется. Выдача разрешённых вложений идёт потоком, только после авторизации и rate limit.

## Проверка после обновления или деплоя

```sh
docker compose ps clamav api
docker compose exec -T clamav clamdcheck.sh
docker compose exec -T clamav clamdscan --version
docker compose exec -T clamav sh -c 'grep -E "^(StreamMaxLength|MaxFileSize|MaxScanSize|MaxScanTime|MaxRecursion|MaxFiles) " /etc/clamav/clamd.conf'
docker compose exec -T api node dist/cli/chat-smoke.js
```

`clamdscan --version` должен показать актуальную версию движка и дату/номер базы сигнатур. Smoke проверяет рабочий PNG, реальный декодируемый MP4, файл больше прежнего proxy-limit 10 МиБ, structural-negative MP4 и runtime-собранную EICAR test signature.

## Обновление ClamAV

Образ закреплён точной версией в `compose.yaml`. Для обновления:

1. сверить новый стабильный релиз и его security notes на официальном сайте ClamAV;
2. изменить только tag `clamav/clamav:<version>`;
3. выполнить `docker compose pull clamav` и штатный deploy;
4. дождаться healthy и выполнить команды проверки выше.

`clamav_signatures` содержит воспроизводимую базу сигнатур и не относится к пользовательским данным — включать этот volume в пользовательские backups не требуется. Его сохранение лишь ускоряет перезапуск и снижает повторные загрузки. `clamav_config` содержит runtime-конфигурацию clamd, но не секреты магазина.

Официальные опоры: [ClamAV в Docker](https://docs.clamav.net/manual/Installing/Docker.html), [протокол clamd](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).
