"""FAPI part cards and account usage."""

import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

FAPI_URL = "https://fapi.iisis.ru/fapi/v2"
PART_GROUPS = {
    "oe": "oe",
    "analogs": "analogs",
    "replacedBy": "replaced_by",
    "replaces": "replaces",
}
ACCOUNT_FIELDS = {
    "pl": "plan", "st": "status", "inc": "included_credits", "rem": "remaining_credits",
    "u": "used_credits", "ts": "observed_at", "ps": "period_start", "pe": "period_end",
}


class FapiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def fapi_request(path, request_json, params=None):
    key = os.getenv("FAPI_KEY", "").strip()
    if not key:
        raise FapiError(503, "fapi_key_missing", "Задайте ключ FAPI в локальном файле .env.")
    url = FAPI_URL + path
    if params:
        url += "?" + urlencode(params)
    try:
        response = request_json(url, headers={"Authorization": "Bearer " + key}, timeout=10)
    except HTTPError as err:
        err.close()
        known = {
            400: ("fapi_invalid_query", "FAPI отклонил параметры поиска."),
            401: ("fapi_key_expired", "FAPI отклонил ключ. Проверьте срок его действия."),
            402: ("fapi_credits_unavailable", "FAPI ограничил доступ по тарифу или балансу. Проверьте остаток кредитов."),
            403: ("fapi_access_denied", "FAPI не распознал ключ или не дал ему доступ к каталогу."),
            429: ("fapi_rate_limited", "FAPI ограничил частоту запросов. Повторите позже."),
        }
        if err.code in known:
            raise FapiError(err.code, *known[err.code]) from None
        raise FapiError(502, "fapi_unavailable", "Каталог FAPI сейчас недоступен.") from None
    except (URLError, OSError, ValueError):
        raise FapiError(502, "fapi_unavailable", "Каталог FAPI сейчас недоступен.") from None
    if not isinstance(response, (dict, list)):
        raise FapiError(502, "fapi_invalid_response", "FAPI вернул ответ неизвестного формата.")
    return response


def part_ref(raw):
    if not isinstance(raw, dict):
        return None
    article = raw.get("n") or raw.get("ns")
    brand = raw.get("ds")
    manufacturer_id = raw.get("mfi")
    if not isinstance(article, str) or not article or not isinstance(brand, str) or not brand:
        return None
    if type(manufacturer_id) is not int or manufacturer_id <= 0:
        return None
    part = {"article": article, "brand": brand, "manufacturer_id": manufacturer_id}
    if isinstance(description := raw.get("d"), str) and description.strip():
        part["description"] = description.strip()
    if raw.get("mfc") is True:
        part["manufacturer_verified"] = True
    for key, name in (("rp", "votes_for"), ("rm", "votes_against")):
        if type(raw.get(key)) is int and raw[key] >= 0:
            part[name] = raw[key]
    return part


def part_list(raw, key):
    items = raw.get(key, [])
    if not isinstance(items, list):
        raise FapiError(502, "fapi_invalid_response", "FAPI вернул список деталей неизвестного формата.")
    return [part for item in items if (part := part_ref(item))]


def find_part(form, request_json, *, budget=None):
    article = form.get("article")
    if not isinstance(article, str) or not (article := article.strip()) or len(article) > 64:
        raise FapiError(400, "invalid_article", "Введите артикул длиной до 64 символов.")
    if not article.isprintable() or not any(char.isalnum() for char in article):
        raise FapiError(400, "invalid_article", "Проверьте написание артикула.")
    manufacturer_id = form.get("manufacturer_id")
    params = {"n": article, "limit": 100}
    if manufacturer_id is not None:
        if type(manufacturer_id) is not int or manufacturer_id <= 0:
            raise FapiError(400, "invalid_manufacturer", "Выберите бренд из результатов поиска.")
        params["mfi"] = manufacturer_id
    raw = budget.fetch("/part", params, 1, request_json) if budget else fapi_request("/part", request_json, params)
    if not isinstance(raw, dict) or "candidates" not in raw:
        raise FapiError(502, "fapi_invalid_response", "FAPI вернул ответ неизвестного формата.")
    part = part_ref(raw.get("part"))
    if not part:
        candidates = part_list(raw, "candidates")
        return {"article": article, "status": "choose_brand" if candidates else "no_data", "candidates": candidates}

    groups = {label: part_list(raw, key) for key, label in PART_GROUPS.items()}
    result = {"article": article, "status": "found", "part": part, "groups": groups}
    if raw.get("status") in ("current", "replaced"):
        result["part_status"] = raw["status"]
    if current := part_ref(raw.get("current")):
        result["current"] = current
    return result


def read_usage(request_json):
    raw = fapi_request("/usage", request_json)
    account = raw.get("account") if isinstance(raw, dict) else None
    if not isinstance(account, dict) or account.get("st") not in (
        "unbilled", "allowed", "denied_unpaid", "denied_quota", "denied_balance",
    ):
        raise FapiError(502, "fapi_invalid_response", "FAPI вернул сведения о тарифе неизвестного формата.")
    return {
        key: account[field]
        for field, key in ACCOUNT_FIELDS.items()
        if type(account.get(field)) in (str, int)
    }
