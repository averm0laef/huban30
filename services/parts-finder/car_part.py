"""Server-side Car-Part job adapter for the Apify Actor."""

from collections import OrderedDict
from datetime import datetime, timezone
import http
import os
import re
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError

ACTOR_ID = "YJtKnjFupdQDdpN05"
APIFY_URL = "https://api.apify.com/v2"
RUN_ID = re.compile(r"[A-Za-z0-9]{8,64}")
MAX_ITEMS = 25
TERMINAL_STATES = {"FAILED", "TIMED-OUT", "ABORTED"}
PENDING_STATES = {"READY", "RUNNING", "TIMING-OUT", "ABORTING"}
ITEM_FIELDS = (
    "year", "makeModel", "partName", "description", "interchangeCode", "price",
    "priceFormatted", "currency", "coreCharge", "partGrade", "stockNumber", "mileage",
    "supplierName", "supplierWebsite", "stateProvince", "city", "distanceMiles",
)


class CarPartError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def car_part_input(data):
    year = data.get("year")
    make_model = data.get("makeModel")
    part = data.get("part")
    zip_code = data.get("userZip")
    if type(year) is not int or not 1900 <= year <= datetime.now(timezone.utc).year + 1:
        raise CarPartError(400, "invalid_year", "Укажите модельный год автомобиля.")
    if not isinstance(make_model, str) or not 2 <= len(make_model.strip()) <= 80:
        raise CarPartError(400, "invalid_make_model", "Укажите марку и модель.")
    if not isinstance(part, str) or not 2 <= len(part.strip()) <= 80:
        raise CarPartError(400, "invalid_part", "Укажите название детали на английском.")
    if not isinstance(zip_code, str) or not re.fullmatch(r"[0-9]{5}", zip_code.strip()):
        raise CarPartError(400, "invalid_zip", "Введите ZIP-код США из пяти цифр.")
    return {
        "year": year, "makeModel": make_model.strip(), "part": part.strip(),
        "userZip": zip_code.strip(), "userLocation": "USA", "sortBy": "price",
        "interchangeMode": "first", "maxItems": MAX_ITEMS, "maxPages": 3,
        "concurrency": 1, "softDeadlineSecs": 85, "monitorMode": False,
        "includePhones": False, "includeEmails": False,
        "proxyConfiguration": {
            "useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "US",
        },
    }


def configured_token():
    token = os.getenv("APIFY_TOKEN", "").strip()
    if not token:
        raise CarPartError(503, "apify_not_configured", "Настройте токен Apify в файле .env.")
    expiry = os.getenv("APIFY_TOKEN_EXPIRES_AT", "").strip()
    if expiry:
        try:
            cutoff = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            if cutoff.tzinfo is None:
                raise ValueError
        except ValueError:
            raise CarPartError(503, "apify_expiry_invalid", "Проверьте дату окончания действия токена Apify.") from None
        if datetime.now(timezone.utc) >= cutoff:
            raise CarPartError(503, "apify_expired", "Срок действия тестового токена Apify в этой сборке истёк.")
    return token


class CarPart:
    def __init__(self, request_json):
        self.request_json = request_json
        self.jobs = OrderedDict()
        self.lock = Lock()

    def request(self, path, payload=None):
        try:
            return self.request_json(
                APIFY_URL + path, payload=payload,
                headers={"Authorization": "Bearer " + configured_token()}, timeout=12,
            )
        except HTTPError as err:
            err.close()
            messages = {
                401: "Apify отклонил токен.",
                402: "Проверьте баланс и тариф Apify.",
                403: "У токена Apify нет доступа к Actor или прокси.",
                429: "Apify ограничил частоту запросов. Повторите позже.",
            }
            raise CarPartError(
                err.code if err.code in messages else 502, "apify_http_error",
                messages.get(err.code, "Apify отклонил запрос к Actor."),
            ) from None
        except (URLError, OSError, ValueError):
            raise CarPartError(502, "apify_unavailable", "Сервис Apify не ответил. Проверьте статус запуска перед повтором.") from None

    @staticmethod
    def run_data(reply):
        data = reply.get("data") if isinstance(reply, dict) else None
        if not isinstance(data, dict) or not RUN_ID.fullmatch(str(data.get("id", ""))):
            raise CarPartError(502, "invalid_run", "Apify вернул неизвестный формат запуска.")
        return data

    def start(self, form):
        payload = car_part_input(form)
        configured_token()
        key = (payload["year"], payload["makeModel"].casefold(), payload["part"].casefold(), payload["userZip"])
        with self.lock:
            now = monotonic()
            while self.jobs and next(iter(self.jobs.values()))[1] <= now:
                self.jobs.popitem(last=False)
            for run_id, (existing_key, _) in self.jobs.items():
                if key == existing_key:
                    return http.HTTPStatus.ACCEPTED, {"run_id": run_id, "status": "pending"}
            if len(self.jobs) >= 128:
                raise CarPartError(429, "too_many_searches", "Слишком много поисков Car-Part. Повторите позже.")
            run = self.run_data(self.request(
                f"/actors/{ACTOR_ID}/runs?timeout=110&maxItems={MAX_ITEMS}&maxTotalChargeUsd=0.25",
                payload,
            ))
            self.jobs[run["id"]] = (key, monotonic() + 420)
        return http.HTTPStatus.ACCEPTED, {"run_id": run["id"], "status": "pending"}

    def status(self, data):
        run_id = data.get("run_id")
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise CarPartError(400, "invalid_run_id", "Неверный идентификатор поиска.")
        with self.lock:
            job = self.jobs.get(run_id)
            if job is None or job[1] <= monotonic():
                raise CarPartError(404, "unknown_run", "Поиск больше не доступен в этой сессии.")

        run = self.run_data(self.request(f"/actor-runs/{run_id}"))
        state = run.get("status")
        if state in PENDING_STATES:
            return http.HTTPStatus.ACCEPTED, {"run_id": run_id, "status": "pending"}
        if state in TERMINAL_STATES:
            with self.lock:
                self.jobs.pop(run_id, None)
            raise CarPartError(502, "run_failed", f"Поиск Car-Part завершился со статусом {state}.")

        dataset_id = run.get("defaultDatasetId")
        if state != "SUCCEEDED" or not RUN_ID.fullmatch(str(dataset_id)):
            raise CarPartError(502, "invalid_dataset", "Apify не вернул идентификатор набора результатов.")
        fields = ",".join(ITEM_FIELDS)
        items = self.request(f"/datasets/{dataset_id}/items?format=json&clean=true&limit={MAX_ITEMS}&fields={fields}")
        if not isinstance(items, list):
            raise CarPartError(502, "invalid_items", "Apify вернул неизвестный формат списка запчастей.")
        listings = [
            {name: item[name] for name in ITEM_FIELDS if name in item}
            for item in items[:MAX_ITEMS]
            if isinstance(item, dict) and (item.get("partName") or item.get("supplierName"))
        ]
        return http.HTTPStatus.OK, {"status": "complete", "source": "car-part", "items": listings}
