"""Shared cache and limits for metered FAPI requests."""

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from time import time

from fapi_catalog import FapiError, fapi_request, read_usage
from runtime_config import state_file

MOSCOW = timezone(timedelta(hours=3))
DAY_LIMIT_DEFAULT = 1000
CATALOG_INDEXES = {
    "/catalogList/dt/manufacturerList": "mf",
    "/catalogList/dt/modelList": "m",
    "/catalogList/dt/modificationList": "m",
    "/catalogList/dt/treeList": None,
}


def timestamp(value):
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo:
                return dt.timestamp()
        except (ValueError, OverflowError):
            pass
    return None


def daily_limit():
    value = os.getenv("FAPI_DAILY_CREDIT_LIMIT", "").strip()
    if value.isascii() and value.isdigit() and len(value) <= 7:
        return int(value)
    return DAY_LIMIT_DEFAULT


class FapiBudget:
    def __init__(self, path=None):
        self.path = path or state_file("fapi-state.sqlite3")

    def fetch(self, endpoint, params, credits, request_json):
        key = os.getenv("FAPI_KEY", "").strip()
        if not key:
            raise FapiError(503, "fapi_key_missing", "Задайте ключ FAPI в локальном файле .env.")
        scope = hashlib.sha256(key.encode()).hexdigest()
        try:
            return self.fetch_with_state(scope, endpoint, params, credits, request_json)
        except sqlite3.Error:
            raise FapiError(503, "fapi_budget_unavailable", "Сейчас недоступен учёт кредитов FAPI.") from None

    def fetch_with_state(self, scope, endpoint, params, credits, request_json):
        normalized = dict(params)
        if endpoint == "/part":
            normalized["n"] = "".join(char for char in normalized["n"].upper() if char.isalnum())
        cache_key = json.dumps([endpoint, normalized], sort_keys=True, ensure_ascii=False)
        with closing(sqlite3.connect(self.path, timeout=20)) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS account_state (
                    scope TEXT PRIMARY KEY, checked REAL NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS package_state (
                    period TEXT PRIMARY KEY, remaining INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS daily_state (
                    scope TEXT NOT NULL, day TEXT NOT NULL, reserved INTEGER NOT NULL,
                    PRIMARY KEY (scope, day)
                );
                CREATE TABLE IF NOT EXISTS lookup_cache (
                    period TEXT NOT NULL, cache_key TEXT NOT NULL, expires REAL NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY (period, cache_key)
                );
            """)
            db.execute("BEGIN IMMEDIATE")
            try:
                return self.lookup(db, scope, endpoint, params, cache_key, credits, request_json)
            finally:
                # A request with an uncertain outcome can already have reached FAPI.
                db.commit()

    def lookup(self, db, scope, endpoint, params, cache_key, credits, request_json):
        now = time()
        day = datetime.fromtimestamp(now, MOSCOW).date().isoformat()
        state = db.execute("SELECT checked, payload FROM account_state WHERE scope=?", (scope,)).fetchone()
        usage = json.loads(state[1]) if state else {}
        if not state or now - state[0] >= 60 or (timestamp(usage.get("period_end")) or float("inf")) <= now:
            usage = read_usage(request_json)
            now = time()
            day = datetime.fromtimestamp(now, MOSCOW).date().isoformat()
            db.execute(
                "INSERT OR REPLACE INTO account_state VALUES (?, ?, ?)", (scope, now, json.dumps(usage)),
            )
            db.execute("DELETE FROM lookup_cache WHERE expires<=?", (now,))
        plan = usage.get("plan")
        end = timestamp(usage.get("period_end"))
        remaining = usage.get("remaining_credits")
        allowed = usage["status"] == "allowed" and (end is None or end > now)
        trial = plan == "trial"
        active = allowed or (not trial and end is not None and end > now and usage["status"] in {
            "denied_quota", "denied_balance",
        })
        period = json.dumps([scope, plan, usage.get("period_start"), usage.get("included_credits")])
        balance = db.execute("SELECT remaining FROM package_state WHERE period=?", (period,)).fetchone()
        if type(remaining) is int and balance:
            remaining = min(remaining, balance[0])
        if active and (not trial or (type(remaining) is int and remaining > 0)):
            stored = db.execute(
                "SELECT payload FROM lookup_cache WHERE period=? AND cache_key=? AND expires>?",
                (period, cache_key, now),
            ).fetchone()
            if stored:
                return json.loads(stored[0])

        if not allowed:
            raise FapiError(402, "fapi_access_limited", "Новые запросы ограничены текущим тарифом FAPI.")
        if type(remaining) is not int or remaining < credits:
            raise FapiError(402, "fapi_package_limited", "Остатка кредитов пакета FAPI для запроса недостаточно.")
        used = db.execute(
            "SELECT reserved FROM daily_state WHERE scope=? AND day=?", (scope, day),
        ).fetchone()
        spent = used[0] if used else 0
        if spent + credits > daily_limit():
            raise FapiError(429, "fapi_daily_limit", "Дневной лимит новых запросов FAPI исчерпан. Повторите завтра.")

        # Reserve before contacting the supplier, including across local workers.
        db.execute("INSERT OR REPLACE INTO package_state VALUES (?, ?)", (period, remaining - credits))
        db.execute("INSERT OR REPLACE INTO daily_state VALUES (?, ?, ?)", (scope, day, spent + credits))
        try:
            result = fapi_request(endpoint, request_json, params)
        except FapiError as err:
            if err.status in (400, 401, 402, 403, 429):
                db.execute("UPDATE package_state SET remaining=? WHERE period=?", (remaining, period))
                db.execute("UPDATE daily_state SET reserved=? WHERE scope=? AND day=?", (spent, scope, day))
            if err.status in (401, 402, 403):
                db.execute("DELETE FROM account_state WHERE scope=?", (scope,))
            raise
        index_key = CATALOG_INDEXES.get(endpoint)
        rows = result.get(index_key) if index_key and isinstance(result, dict) else result
        empty = rows == []
        if empty and credits > 1:
            refund = credits - 1
            db.execute("UPDATE package_state SET remaining=remaining+? WHERE period=?", (refund, period))
            db.execute("UPDATE daily_state SET reserved=reserved-? WHERE scope=? AND day=?", (refund, scope, day))
            credits = 1
        ttl = 300 if trial else 86400
        if not trial and end and endpoint in CATALOG_INDEXES and not empty:
            ttl = 7 * 86400
        expiry = min(now + ttl, end) if end else now + ttl
        # During a free trial the licence expires when the credits run out.
        if not trial or remaining > credits:
            db.execute(
                "INSERT OR REPLACE INTO lookup_cache VALUES (?, ?, ?, ?)",
                (period, cache_key, expiry, json.dumps(result, ensure_ascii=False)),
            )
        return result
