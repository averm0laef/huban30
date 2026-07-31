# Авторизация и права АН-30

## Модель доступа

API использует серверную opaque-сессию. В браузере нет JWT и прав доступа:
случайное значение хранится в cookie `an30_session` с `HttpOnly`, `SameSite=Lax`
и `Secure` в production, а в PostgreSQL находится только HMAC-хеш. Сессия имеет
абсолютный срок 24 часа и idle timeout 30 минут; оба значения настраиваются.

Все небезопасные HTTP-методы обязаны прийти с точным same-origin `Origin`.
Авторизованный запрос дополнительно передаёт `X-CSRF-Token`, совпадающий со
значением cookie `an30_csrf`. В БД находится только HMAC-хеш CSRF-токена.
После TOTP сессия ротируется, предыдущая немедленно отзывается.

Пароли хешируются Argon2id средствами Node.js 24: 64 MiB памяти, 3 прохода,
parallelism 4 и отдельная случайная соль. Токены подтверждения email,
восстановления, приглашения и recovery-коды хранятся только как
purpose-separated HMAC. Токен для будущей отправки почты лежит в outbox в
AES-256-GCM виде с привязкой к назначению.

## Роли и серверная RBAC

Матрица определена в `packages/contracts`, но проверяется глобальным guard API
на каждом защищённом handler. Скрытие кнопки в интерфейсе не считается защитой.

| Возможность | customer | manager | director | admin |
| --- | --- | --- | --- | --- |
| Свой профиль, заказы, избранное и чат | Да | Только свой профиль | Только свой профиль | Да |
| Все заказы и чаты | Нет | Да | Да | Да |
| Изменение и импорт каталога | Нет | Да | Да | Да |
| Отчёты и чтение персонала | Нет | Нет | Да | Да |
| Приглашение и управление персоналом | Нет | Нет | Нет | Да |
| Настройки и audit log | Нет | Нет | Нет | Да |

Доступ к конкретной записи дополнительно должен ограничиваться владельцем
ресурса в каждом доменном endpoint. Такие endpoints добавляются вместе с
заказами, чатом и кабинетом; глобальная роль не заменяет ownership-проверку.

## Первый владелец

Публичного `init-admin` нет. Первый `admin` создаётся ровно один раз командой
внутри API-контейнера. Пароль передаётся через root-only файл/stdin, чтобы он не
оказался в аргументах процесса или истории shell:

```bash
sudo sh -c 'docker compose exec -T api node dist/cli/create-owner.js \
  --email owner@an30.ru \
  --display-name "Владелец АН-30" \
  --password-file /dev/stdin < /etc/an30/secrets/initial_owner_password.txt'
```

Команда откажется создавать владельца, если уже существует любой сотрудник.
Повтор с тем же admin email безопасен и ничего не изменяет. После первого входа
владелец имеет только ограниченную MFA-сессию, пока не настроит TOTP.

## Клиентский сценарий

1. `POST /api/v1/auth/register` создаёт неподтверждённый аккаунт и outbox-событие.
2. `POST /api/v1/auth/email/verify` активирует одноразовый токен на 24 часа.
3. `POST /api/v1/auth/login` создаёт opaque-сессию.
4. `POST /api/v1/auth/password/forgot` всегда возвращает одинаковый ответ и не
   раскрывает наличие email; reset-токен действует 30 минут.
5. `POST /api/v1/auth/password/reset` меняет пароль и отзывает все сессии.
6. `POST /api/v1/auth/logout` требует CSRF и отзывает текущую сессию.

Пять неудачных попыток блокируют аккаунт на 15 минут. Redis дополнительно
ограничивает IP и HMAC-маскированный email; при отказе Redis auth endpoint
закрывается с 503, а не работает без brute-force защиты.

## Персонал и TOTP

Только admin с `staff:invite` создаёт приглашение сроком 72 часа. Сотрудник
принимает одноразовый токен, входит и обязан настроить TOTP. Секрет TOTP хранится
в AES-256-GCM виде. При подтверждении один раз показываются 10 recovery-кодов;
в БД остаются только HMAC-хеши. Каждый код одноразовый. Повторное применение
TOTP того же временного шага блокируется.

Development может возвращать `developmentToken` для воспроизводимых smoke-тестов
только при `AUTH_DEBUG_TOKENS=true` и локальном HTTP origin. С не-local origin
API завершает запуск с ошибкой. В production эта возможность выключена.

## Проверка на локальном стеке

Customer flow проверяет Origin, cookie, CSRF, подтверждение email, generic login,
reset с отзывом сессии и logout. Staff flow проверяет одноразовый bootstrap,
обязательный TOTP, recovery-коды, ротацию сессии и запрет manager приглашать
персонал:

```bash
docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/auth-smoke.js

printf '%s' 'Owner smoke password phrase 2026' | \
  docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/create-owner.js --email owner-smoke@example.invalid \
  --display-name 'Owner Smoke' --password-file /dev/stdin

docker compose -f compose.yaml -f compose.dev.yaml exec -T api \
  node dist/cli/staff-auth-smoke.js
```

Smoke-аккаунты обезличиваются и soft-delete после проверки. Их audit events не
удаляются: append-only журнал и внешние ключи намеренно запрещают hard delete.
