"""Adapters for VINROKU chassis lookup and optional API Ninjas lookup."""

import os
from collections import OrderedDict
from threading import Lock
from time import monotonic, time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit

from api_registry import get_quota, save_quota
from vin_decoder import clean_value, model_year

VINROKU_URL = "https://vinroku.jp/api/v1/lookup"
NINJAS_URL = "https://api.api-ninjas.com/v1/vinlookup"


class ProviderError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def read_nonnegative(value):
    if type(value) is int:
        return value if value >= 0 else None
    if isinstance(value, str) and value.isascii() and value.isdigit() and len(value) <= 12:
        return int(value)
    return None


def source_link(value):
    if isinstance(value, str):
        try:
            url = urlsplit(value)
            if url.scheme == "https" and url.hostname and not url.username and not url.password:
                return value
        except ValueError:
            pass
    return None


def chassis_result(chassis, payload):
    if not isinstance(payload, dict) or payload.get("ok") is not True or payload.get("type") != "chassis":
        raise ValueError("Invalid chassis payload")
    query = payload.get("query")
    if not isinstance(query, dict) or query.get("normalized") != chassis:
        raise ValueError("Chassis response refers to a different query")
    matches = payload.get("matches")
    references = payload.get("catalogReferences", [])
    if not isinstance(matches, list) or not isinstance(references, list):
        raise ValueError("Invalid chassis result lists")

    result = {
        "type": "chassis", "chassis": chassis, "source": "vinroku",
        "matches": [], "catalog_references": [], "status": "no_data",
    }
    chassis_code, serial = chassis.split("-")
    for match in matches:
        if not isinstance(match, dict) or match.get("chassisCode", chassis_code) != chassis_code:
            continue
        manufacturer = clean_value(match.get("manufacturer"))
        year = model_year(clean_value(match.get("productionYear")))
        if not manufacturer or not year:
            continue
        low, high = match.get("serialStartText"), match.get("serialEndText")
        if low is not None or high is not None:
            low_value, high_value = read_nonnegative(low), read_nonnegative(high)
            if low_value is None or high_value is None or not low_value <= int(serial) <= high_value:
                continue
        result["matches"].append({
            "manufacturer": manufacturer, "production_year": year,
            "registration_type": clean_value(match.get("registrationType")),
            "serial_start": clean_value(low), "serial_end": clean_value(high),
            "publisher": clean_value(match.get("publisher")),
            "source_url": source_link(match.get("sourceUrl")),
            "source_page": read_nonnegative(match.get("sourcePage")),
        })
    catalog_fields = ("engines", "drives", "gearboxes", "displacements", "fuels")
    for item in references:
        if not isinstance(item, dict) or item.get("chassisCode", chassis_code) != chassis_code:
            continue
        name = clean_value(item.get("model"))
        maker = clean_value(item.get("manufacturer"))
        if not name or not maker:
            continue
        reference = {
            "manufacturer": maker, "model": name,
            "disposition": clean_value(item.get("disposition")),
        }
        for field in catalog_fields:
            if isinstance(values := item.get(field), list):
                reference[field] = [value for raw in values if (value := clean_value(raw))]
        result["catalog_references"].append(reference)

    possibilities = {
        (m["manufacturer"].casefold(), m["production_year"], (m["registration_type"] or "").casefold())
        for m in result["matches"]
    }
    if possibilities:
        result["status"] = "ambiguous" if len(possibilities) > 1 else "matched"
    elif result["catalog_references"]:
        result["status"] = "partial"
    return result


class Vinroku:
    def __init__(self, request_json):
        self.request_json = request_json
        self.cache = OrderedDict()
        self.lock = Lock()

    @staticmethod
    def record_quota(headers, exhausted=False):
        limit = read_nonnegative(headers.get("RateLimit-Limit"))
        remaining = 0 if exhausted else read_nonnegative(headers.get("RateLimit-Remaining"))
        if remaining is None:
            return
        now = int(time())
        reset = read_nonnegative(headers.get("RateLimit-Reset"))
        if reset is None or reset <= now:
            reset = (now // 86400 + 1) * 86400
        save_quota("vinroku", limit, remaining, reset)

    def lookup(self, chassis):
        with self.lock:
            now = monotonic()
            while self.cache and next(iter(self.cache.values()))[0] <= now:
                self.cache.popitem(last=False)
            if chassis in self.cache:
                return {**self.cache[chassis][1], "cached": True}
            quota = get_quota("vinroku")
            if quota and quota[0] == 0 and quota[1] > time():
                raise ProviderError(429, "vinroku_rate_limited", "Дневной лимит VINROKU исчерпан.")
            try:
                payload, headers = self.request_json(
                    VINROKU_URL + "?" + urlencode({"q": chassis}), timeout=6, include_headers=True,
                )
                self.record_quota(headers)
                result = chassis_result(chassis, payload)
            except HTTPError as err:
                err.close()
                if err.code == 429:
                    self.record_quota(err.headers or {}, exhausted=True)
                    raise ProviderError(429, "vinroku_rate_limited", "Дневной лимит VINROKU исчерпан.") from None
                raise ProviderError(502, "vinroku_http_error", "VINROKU не принял запрос.") from None
            except (URLError, OSError, ValueError):
                raise ProviderError(502, "vinroku_unavailable", "VINROKU сейчас недоступен.") from None
            self.cache[chassis] = (monotonic() + 3600, result)
            if len(self.cache) > 128:
                self.cache.popitem(last=False)
            return {**result, "cached": False}


def ninjas_lookup(identifier, request_json):
    mode = os.getenv("API_NINJAS_MODE", "off").strip().lower()
    key = os.getenv("API_NINJAS_KEY", "").strip()
    if mode not in {"demo", "commercial"} or not key:
        return {}
    url = NINJAS_URL + "?" + urlencode({"vin": identifier})
    try:
        raw = request_json(url, headers={"X-Api-Key": key}, timeout=5)
    except HTTPError as err:
        err.close()
        code = "api_ninjas_rate_limited" if err.code == 429 else "api_ninjas_unavailable"
        raise ProviderError(502, code, "API Ninjas сейчас недоступен.") from None
    except (URLError, OSError, ValueError):
        raise ProviderError(502, "api_ninjas_unavailable", "API Ninjas сейчас недоступен.") from None
    if not isinstance(raw, dict) or raw.get("error"):
        raise ProviderError(502, "api_ninjas_unavailable", "API Ninjas вернул нераспознанный ответ.")
    returned_id = clean_value(raw.get("vin"))
    if not returned_id or returned_id.upper() != identifier:
        return {}
    manufacturer = clean_value(raw.get("manufacturer") or raw.get("make"))
    model = clean_value(raw.get("model"))
    if not manufacturer or not model:
        return {}
    fields = {"manufacturer": manufacturer, "model": model}
    if year := model_year(clean_value(raw.get("year"))):
        fields["model_year"] = year
    if body := clean_value(raw.get("class")):
        fields["body"] = body
    if country := clean_value(raw.get("country")):
        fields["manufacture_country"] = country
    return fields
