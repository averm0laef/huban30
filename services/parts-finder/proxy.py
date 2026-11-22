"""Local catalog server and VIN/parts JSON API."""

import argparse
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import ssl
import sys
from threading import BoundedSemaphore, Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener

import certifi
from dotenv import load_dotenv

import api_registry
import part_ai
from api_registry import initialize_registry, providers_for_display
from autodoc_terms import MARKETS, autodoc_term
from car_part import CarPart, CarPartError
from external_vehicle import ProviderError, Vinroku, ninjas_lookup
from fapi_budget import FapiBudget
from fapi_catalog import FapiError, find_part, read_usage
from part_ai import suggest_parts_query
from runtime_config import DEFAULT_HOST, DEFAULT_PORT, allowed_hosts, env_file, state_dir, state_file
from vehicle_parts import search_vehicle_parts
from vin_decoder import InvalidVIN, VPICUnavailable, check_us_vin, decode_vin, normalize_chassis, normalize_vin

ROOT = Path(__file__).resolve().parent
REEF_URL = "https://api.reefapi.com/autodoc/v1/part_search"
REEF_OE_URL = "https://api.reefapi.com/autodoc/v1/oem_lookup"
VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/"
MAX_BODY = 16 * 1024
MAX_ACTIVE_REQUESTS = 24
CLIENT_TIMEOUT_SECONDS = 10
# VINROKU answers 403 to urllib's default "Python-urllib/x.y" agent.
USER_AGENT = "AN30-parts-finder/1.0"
MAX_RESPONSE = 4 * 1024 * 1024
REEF_CACHE_TTL = 420
REEF_CACHE = OrderedDict()
REEF_LOCK = Lock()
API_PATHS = {
    "/vin", "/vin/check-digit", "/autodoc", "/car-part", "/car-part/status",
    "/fapi/part", "/fapi/vehicle-parts", "/parts/search", "/parts/ai-suggest",
}
FAPI_BUDGET = FapiBudget()
LEGACY_ORIGINS = {"http://localhost:8000", "http://127.0.0.1:8000"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTPS = build_opener(HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())), NoRedirect())


def request_json(url, *, payload=None, headers=None, timeout=8, include_headers=False):
    request_headers = {"Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})}
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        request_headers["Content-Type"] = "application/json"
    with HTTPS.open(Request(url, data=body, headers=request_headers), timeout=timeout) as response:
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError("Upstream response is too large")
        data = parse_json(body)
        return (data, response.headers) if include_headers else data


def parse_json(body):
    def reject_constant(_):
        raise ValueError("Invalid JSON number")

    return json.loads(body, parse_constant=reject_constant)


def load_vpic(vin):
    if os.getenv("VIN_VPIC_MODE", "offline").strip().lower() == "online":
        try:
            response = request_json(f"{VPIC_URL}{vin}?format=json")
            record = response["Results"][0]
            if not isinstance(record, dict):
                raise ValueError
        except HTTPError as err:
            err.close()
            raise VPICUnavailable from None
        except (URLError, OSError, ValueError, KeyError, IndexError, TypeError):
            raise VPICUnavailable from None
        return "nhtsa_vpic_online", record

    try:
        import ultravin

        decoded = ultravin.decode(vin)
        record = dict(decoded["attributes"])
        record["ModelYear"] = decoded["model_year"]
        record["ErrorCode"] = ",".join(map(str, decoded["error_codes"]))
    except (ImportError, OSError, RuntimeError, ValueError, KeyError, TypeError):
        raise VPICUnavailable from None
    return "nhtsa_vpic_offline", record


def reef_search(payload):
    query = payload.get("query")
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200:
        return 400, {"ok": False, "error": "Введите номер или название детали."}
    market, mode = payload.get("market", "uk"), payload.get("mode", "part")
    page, limit = payload.get("page", 1), payload.get("max_results", payload.get("per_page", 20))
    if market not in MARKETS or mode not in ("part", "keyword", "oe"):
        return 400, {"ok": False, "error": "Проверьте рынок и способ поиска в Autodoc."}
    if type(page) is not int or not 1 <= page <= 50 or type(limit) is not int or not 1 <= limit <= 200:
        return 400, {"ok": False, "error": "Проверьте параметры выдачи Autodoc."}
    if not (key := os.getenv("REEF_KEY", "").strip()):
        return 503, {"ok": False, "error": "Настройте ключ ReefAPI в файле .env."}

    query = " ".join(query.split())
    if mode == "keyword":
        if not (query := autodoc_term(query, market)):
            return 400, {"ok": False, "error": "Уточните название детали, например «тормозные колодки»."}
    endpoint = REEF_OE_URL if mode == "oe" else REEF_URL
    payload = {"oem_number" if mode == "oe" else "query": query, "market": market, "page": page, "max_results": limit}
    cache_key = json.dumps([endpoint, payload], sort_keys=True)
    with REEF_LOCK:
        now = monotonic()
        while REEF_CACHE and next(iter(REEF_CACHE.values()))[0] <= now:
            REEF_CACHE.popitem(last=False)
        if cached := REEF_CACHE.get(cache_key):
            _, data = cached
            return 200, {**data, "meta": {**data["meta"], "cached": True, "charged_credits": 0}}
        try:
            data = request_json(endpoint, payload=payload, headers={"x-api-key": key}, timeout=12)
        except HTTPError as err:
            if err.code == 404:
                try:
                    envelope = parse_json(err.read(MAX_RESPONSE))
                except (OSError, ValueError):
                    envelope = None
                if isinstance(envelope, dict) and isinstance(envelope.get("error"), dict) and envelope["error"].get("code") == "NOT_FOUND":
                    data = envelope
                else:
                    data = None
            else:
                data = None
            err.close()
            messages = {
                401: "ReefAPI отклонил ключ. Проверьте REEF_KEY.",
                402: "Недостаточно кредитов ReefAPI.",
                403: "Ключ ReefAPI не даёт доступа к этому запросу.",
                429: "ReefAPI ограничил частоту запросов. Повторите позже.",
            }
            if data is None:
                return err.code if err.code in messages else 502, {
                    "ok": False, "error": messages.get(err.code, "ReefAPI отклонил запрос."),
                }
        except (URLError, OSError, ValueError):
            return 502, {"ok": False, "error": "ReefAPI не ответил или вернул некорректные данные."}
        error = data.get("error") if isinstance(data, dict) else None
        if isinstance(error, dict) and error.get("code") == "NOT_FOUND":
            data = {**data, "ok": True, "data": {"parts": []}, "error": None}
        elif not isinstance(data, dict) or data.get("ok") is not True:
            code = error.get("code") if isinstance(error, dict) else None
            code = code if isinstance(code, str) else None
            status, message = {
                "INVALID_PARAMS": (400, "Autodoc отклонил параметры поиска."),
                "INSUFFICIENT_CREDITS": (402, "Недостаточно кредитов ReefAPI."),
                "UPSTREAM_BLOCKED": (503, "Autodoc временно ограничил доступ. Попробуйте позже."),
            }.get(code, (502, "Autodoc временно не смог выполнить поиск. Попробуйте позже."))
            return status, {"ok": False, "error": message}
        results = data.get("data")
        if not isinstance(results, dict) or not isinstance(results.get("parts"), list):
            return 502, {"ok": False, "error": "Autodoc вернул выдачу в неизвестном формате."}
        meta = data.get("meta")
        data = {**data, "meta": {**(meta if isinstance(meta, dict) else {}), "cached": False}}
        REEF_CACHE[cache_key] = (monotonic() + REEF_CACHE_TTL, data)
        if len(REEF_CACHE) > 64:
            REEF_CACHE.popitem(last=False)
        return 200, data


CAR_PART = CarPart(request_json)
VINROKU = Vinroku(request_json)


def lookup_chassis(chassis):
    failure = None
    try:
        result = VINROKU.lookup(chassis)
    except ProviderError as err:
        failure = err
        result = {"type": "chassis", "chassis": chassis, "status": "no_data"}
    if result.get("matches") or result.get("catalog_references"):
        return result
    try:
        fallback = ninjas_lookup(chassis, request_json)
    except ProviderError as err:
        if failure:
            raise failure from None
        result["warnings"] = [err.code]
        return result
    if fallback:
        return {"type": "chassis", "chassis": chassis, "source": "api_ninjas", "status": "partial", "vehicle": fallback}
    if failure:
        raise failure
    return result


def identify_vehicle(raw):
    if chassis := normalize_chassis(raw):
        return lookup_chassis(chassis)

    vin = normalize_vin(raw)
    vpic_unavailable = False
    try:
        result = decode_vin(vin, load_vpic)
    except VPICUnavailable:
        vpic_unavailable = True
        result = {"vin": vin, "wmi": vin[:3], "status": "no_data", "source": None,
                  "vehicle": {}, "check_digit": "not_assessed", "warnings": []}
    if result["vehicle"].get("model") or vin.startswith("XTA"):
        return result

    try:
        fallback = ninjas_lookup(vin, request_json)
    except ProviderError as err:
        result["warnings"].append(err.code)
        fallback = {}
    if fallback:
        existing_make = (result["vehicle"].get("make") or "").casefold()
        fallback_maker = fallback["manufacturer"].casefold()
        if not existing_make or existing_make == fallback_maker:
            return {
                "vin": vin, "wmi": vin[:3], "source": "api_ninjas", "vehicle": fallback,
                "status": "partial", "check_digit": "not_assessed", "warnings": ["api_ninjas_partial"],
            }
        result["warnings"].append("provider_make_conflict")
    if vpic_unavailable:
        raise VPICUnavailable
    return result


class PartsFinderHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address, handler):
        self.request_slots = BoundedSemaphore(MAX_ACTIVE_REQUESTS)
        super().__init__(server_address, handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(CLIENT_TIMEOUT_SECONDS)
        return connection, address

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            try:
                request.setblocking(False)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


class ProxyHandler(BaseHTTPRequestHandler):
    def respond(self, status, body=b"", content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if origin in LEGACY_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def json_response(self, status, data):
        self.respond(status, json.dumps(data, ensure_ascii=False, allow_nan=False).encode())

    def valid_host(self):
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in allowed_hosts(self.server.server_port):
            self.json_response(403, {"error": "Используйте локальный адрес сервера."})
            return False
        return True

    def valid_origin(self):
        origin = self.headers.get("Origin")
        local_origin = "http://" + self.headers["Host"]
        if origin is not None and origin != local_origin and origin not in LEGACY_ORIGINS:
            self.json_response(403, {"error": "Источник запроса не разрешён."})
            return False
        return True

    def do_GET(self):
        if not self.valid_host():
            return
        path = urlsplit(self.path).path
        if path == "/health":
            self.json_response(200, {"ok": True})
        elif path in {"/", "/index.html"}:
            self.respond(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif path == "/api-providers":
            if self.valid_origin():
                try:
                    self.json_response(200, {"providers": providers_for_display()})
                except sqlite3.Error:
                    self.json_response(503, {"error": "Реестр API сейчас недоступен."})
        elif path == "/fapi/usage":
            if self.valid_origin():
                try:
                    self.json_response(200, read_usage(request_json))
                except FapiError as err:
                    self.json_response(err.status, {"code": err.code, "error": str(err)})
        else:
            self.json_response(404, {"error": "Страница не найдена."})

    do_HEAD = do_GET

    def do_OPTIONS(self):
        if not self.valid_host() or not self.valid_origin():
            return
        if self.path in API_PATHS:
            self.respond(204)
        else:
            self.json_response(404, {"error": "Маршрут не найден."})

    def do_POST(self):
        if not self.valid_host() or not self.valid_origin():
            return
        if self.path not in API_PATHS:
            self.json_response(404, {"error": "Маршрут не найден."})
            return
        if self.headers.get_content_type() != "application/json":
            self.json_response(415, {"error": "Отправьте данные в JSON."})
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= MAX_BODY:
                raise ValueError
            payload = parse_json(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, RecursionError):
            self.json_response(400, {"error": "Запрос должен содержать объект JSON размером до 16 КБ."})
            return

        try:
            if self.path == "/vin":
                response = 200, identify_vehicle(payload.get("vin"))
            elif self.path == "/vin/check-digit":
                response = 200, check_us_vin(payload.get("vin"))
            elif self.path == "/autodoc":
                response = reef_search(payload)
            elif self.path == "/fapi/part":
                response = 200, find_part(payload, request_json, budget=FAPI_BUDGET)
            elif self.path == "/fapi/vehicle-parts":
                response = 200, search_vehicle_parts(payload, FAPI_BUDGET, request_json)
            elif self.path == "/parts/search":
                response = 200, search_vehicle_parts(payload, FAPI_BUDGET, request_json, guided=True)
            elif self.path == "/parts/ai-suggest":
                response = 200, suggest_parts_query(payload, request_json)
            elif self.path == "/car-part":
                response = CAR_PART.start(payload)
            else:
                response = CAR_PART.status(payload)
        except InvalidVIN as err:
            response = 400, {"code": err.code, "error": str(err)}
        except VPICUnavailable:
            response = 503, {"code": "vpic_unavailable", "error": "База vPIC сейчас недоступна."}
        except CarPartError as err:
            response = err.status, {"code": err.code, "error": str(err)}
        except (ProviderError, FapiError) as err:
            response = err.status, {"code": err.code, "error": str(err)}
        self.json_response(*response)

    def log_message(self, format, *args):
        pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST, help="адрес для входящих запросов")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="порт сервиса")
    return parser.parse_args(argv)


def load_settings():
    """Read provider keys from the configured env file; the process environment wins."""
    path = env_file()
    if os.getenv("PARTS_FINDER_ENV_FILE", "").strip() and not path.is_file():
        print("Файл PARTS_FINDER_ENV_FILE не найден, внешние источники без ключей отключены.", file=sys.stderr, flush=True)
    load_dotenv(path)


def configure_state():
    """Place every SQLite state file in PARTS_FINDER_STATE_DIR (read after the env file is loaded)."""
    state_dir().mkdir(parents=True, exist_ok=True)
    api_registry.REGISTRY_PATH = state_file("api-providers.sqlite3")
    part_ai.STATE_PATH = state_file("groq-state.sqlite3")
    FAPI_BUDGET.path = state_file("fapi-state.sqlite3")


if __name__ == "__main__":
    args = parse_args()
    load_settings()
    configure_state()
    initialize_registry()
    with PartsFinderHTTPServer((args.host, args.port), ProxyHandler) as server:
        print(f"Сервис подбора слушает http://{args.host}:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
