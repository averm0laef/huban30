"""Local register of providers, published allowances and observed quota."""

import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from time import time

from runtime_config import state_file

REGISTRY_PATH = state_file("api-providers.sqlite3")

PROVIDERS = (
    ("vininfo", "vininfo", "LADA и справочник производителей", "Локальная библиотека",
     "https://github.com/idlesign/vininfo", "Локально, без квоты", "active", None, None),
    ("vpic", "NHTSA vPIC", "VIN рынка США и доступные экспортные VIN",
     "Локальный ultravin / GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}",
     "https://vpic.nhtsa.dot.gov/api/", "Офлайн без квоты. Публичный API ограничивает частоту запросов",
     "active", None, None),
    ("vinroku", "VINROKU", "Японские номера кузова и серийные диапазоны",
     "GET https://vinroku.jp/api/v1/lookup",
     "https://vinroku.jp/api-docs", "100 запросов на сетевой адрес за сутки UTC", "active", None, None),
    ("api_ninjas", "API Ninjas", "Резерв для VIN и номеров кузова",
     "GET https://api.api-ninjas.com/v1/vinlookup",
     "https://api-ninjas.com/api/vinlookup", "Free: 3 000 в месяц и 100 в час. Марка и модель требуют Premium",
     "fallback", "API_NINJAS_KEY", None),
    ("reef", "ReefAPI / Autodoc", "Поиск новых запчастей",
     "POST https://api.reefapi.com/autodoc/v1/part_search",
     "https://reefapi.com/autodoc-api", "2 кредита за поиск. Баланс зависит от аккаунта",
     "active", "REEF_KEY", None),
    ("fapi", "FAPI", "Подбор по автомобилю, кроссы и замены",
     "GET https://fapi.iisis.ru/fapi/v2/part; /catalogList/dt/*; /usage",
     "https://fapi.iisis.ru/api-dostup", "Кроссы — 1 кредит. Подбор с пустым кешем — до 35. Остаток — бесплатно",
     "active", "FAPI_KEY", None),
    ("groq", "Groq", "Уточнение формулировки для поиска деталей",
     "POST https://api.groq.com/openai/v1/chat/completions", "https://console.groq.com/docs/structured-outputs",
     "Бюджет настраивается локально, по умолчанию 50 подсказок в день", "active", "GROQ_API_KEY", None),
    ("apify", "Apify / Car-Part", "Поиск запчастей на разборках США",
     "POST https://api.apify.com/v2/actors/YJtKnjFupdQDdpN05/runs",
     "https://apify.com/crawloop/car-part-scraper", "Локально до 25 результатов, 3 страниц и $0.25 на запуск",
     "active", "APIFY_TOKEN", "APIFY_TOKEN_EXPIRES_AT"),
    ("firecrawl", "Firecrawl", "Поиск страниц и чтение публичных карточек",
     "POST https://api.firecrawl.dev/v2/search; POST https://api.firecrawl.dev/v2/scrape",
     "https://www.firecrawl.dev/pricing", "Free: 1 000 кредитов в месяц. JSON по схеме: 5 кредитов за страницу",
     "review", "FIRECRAWL_API_KEY", None),
    ("corgi", "Corgi", "Альтернативный vPIC и дополнительные правила Tesla LRW/XP7",
     "Локальная библиотека @cardog/corgi", "https://github.com/cardog-ai/corgi",
     "Локально, без квоты", "review", None, None),
    ("cardog", "Cardog API", "Дополнительный источник для китайских VIN и JDM",
     "GET https://api.cardog.app/v2/vin/{vin}; GET https://api.cardog.app/v2/chassis/{chassis}",
     "https://cardog.app/docs/credits", "Free: 50 кредитов в месяц. VIN или номер кузова: 2 кредита",
     "review", "CARDOG_API_KEY", None),
)


def initialize_registry():
    with closing(sqlite3.connect(REGISTRY_PATH, timeout=3)) as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, purpose TEXT NOT NULL,
                endpoint TEXT NOT NULL, docs_url TEXT NOT NULL, allowance TEXT NOT NULL,
                integration TEXT NOT NULL, credential_env TEXT, expiry_env TEXT
            );
            CREATE TABLE IF NOT EXISTS provider_quota (
                provider_id TEXT PRIMARY KEY, request_limit INTEGER, remaining INTEGER,
                reset_at INTEGER NOT NULL, observed_at INTEGER NOT NULL
            );
        """)
        db.executemany("""
            INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, purpose=excluded.purpose,
                endpoint=excluded.endpoint, docs_url=excluded.docs_url, allowance=excluded.allowance,
                integration=excluded.integration, credential_env=excluded.credential_env,
                expiry_env=excluded.expiry_env
        """, PROVIDERS)


def providers_for_display():
    with closing(sqlite3.connect(REGISTRY_PATH, timeout=3)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("""
            SELECT p.*, q.request_limit, q.remaining, q.reset_at, q.observed_at
            FROM providers AS p LEFT JOIN provider_quota AS q ON q.provider_id = p.id
            ORDER BY p.rowid
        """).fetchall()
    result = []
    for row in rows:
        provider = dict(row)
        auth = provider["credential_env"]
        provider["credential_status"] = (
            "configured" if auth and os.getenv(auth, "").strip() else "missing" if auth else "no_key"
        )
        expiry_name = provider.pop("expiry_env")
        expiry = os.getenv(expiry_name, "").strip() if expiry_name else ""
        if expiry and provider["credential_status"] == "configured":
            try:
                cutoff = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
                if cutoff.tzinfo is None:
                    raise ValueError
                provider["expires_at"] = cutoff.isoformat()
                if cutoff <= datetime.now(timezone.utc):
                    provider["credential_status"] = "expired"
            except ValueError:
                provider["credential_status"] = "expiry_invalid"
        if provider["reset_at"] and provider["reset_at"] <= time():
            provider["remaining"] = None
        if provider["id"] == "api_ninjas":
            provider["mode"] = os.getenv("API_NINJAS_MODE", "off").strip().lower()
        result.append(provider)
    return result


def get_quota(provider_id):
    with closing(sqlite3.connect(REGISTRY_PATH, timeout=3)) as db:
        return db.execute(
            "SELECT remaining, reset_at FROM provider_quota WHERE provider_id = ?", (provider_id,),
        ).fetchone()


def save_quota(provider_id, limit, remaining, reset_at):
    with closing(sqlite3.connect(REGISTRY_PATH, timeout=3)) as db, db:
        db.execute("""
            INSERT INTO provider_quota VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(provider_id) DO UPDATE SET request_limit=excluded.request_limit,
                remaining=excluded.remaining, reset_at=excluded.reset_at, observed_at=excluded.observed_at
        """, (provider_id, limit, remaining, reset_at, int(time())))
