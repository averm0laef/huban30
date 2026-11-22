import io
import json
import os
import unittest
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from time import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import proxy
import api_registry
from car_part import CarPart
from external_vehicle import NINJAS_URL, VINROKU_URL, Vinroku
from fapi_budget import FapiBudget
from fapi_catalog import FAPI_URL, fapi_request
from local_fitment import import_fitment
from part_ai import GROQ_URL
from vehicle_parts import CATEGORIES, matching_nodes

LADA = "XTAGFK330JY144213"
HONDA = "1HGCM82633A004352"
CAR_FORM = {"year": 2019, "makeModel": "Toyota Camry", "part": "Engine", "userZip": "90210"}
LOCAL_HOST = "127.0.0.1:8010"
CHASSIS = "MXPH14-0036630"
CHASSIS_RESPONSE = {
    "ok": True, "type": "chassis", "query": {"normalized": CHASSIS},
    "matches": [
        {"manufacturer": "Toyota", "productionYear": 2025, "chassisCode": "MXPH14",
         "registrationType": "6AA-MXPH14", "serialStartText": "0036630", "serialEndText": "0071067",
         "sourceUrl": "https://www.jama.or.jp/2025.pdf", "sourcePage": 4},
        {"manufacturer": "Toyota", "productionYear": 2024, "chassisCode": "MXPH14",
         "registrationType": "6AA-MXPH14", "serialStartText": "0001005", "serialEndText": "0036654",
         "sourceUrl": "https://www.jama.or.jp/2024.pdf", "sourcePage": 4},
        {"manufacturer": "Toyota", "productionYear": 2023, "chassisCode": "MXPH14",
         "serialStartText": "0001005", "serialEndText": "0036629"},
    ],
    "catalogReferences": [
        {"manufacturer": "TOYOTA", "model": "YARIS", "chassisCode": "MXPH14",
         "engines": ["M15A-FXE"], "gearboxes": ["CVT"]},
    ],
}


class MemoryRequest:
    def __init__(self, request):
        self.reader = io.BytesIO(request)
        self.writer = io.BytesIO()

    def makefile(self, *_):
        return self.reader

    def sendall(self, data):
        self.writer.write(data)


def request(method, path, body=None, origin=None):
    payload = json.dumps(body).encode() if body is not None else b""
    headers = f"Host: {LOCAL_HOST}\r\n"
    if body is not None:
        headers += f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n"
    if origin:
        headers += f"Origin: {origin}\r\n"
    connection = MemoryRequest(f"{method} {path} HTTP/1.1\r\n{headers}\r\n".encode() + payload)
    proxy.ProxyHandler(connection, ("127.0.0.1", 50000), SimpleNamespace(server_port=8010))
    head, content = connection.writer.getvalue().split(b"\r\n\r\n", 1)
    return int(head.split()[1]), head, content


def post(path, data):
    status, _, body = request("POST", path, data)
    return status, json.loads(body)


class VINTests(unittest.TestCase):
    def test_lada_is_local_and_disambiguates_the_model_year(self):
        with patch.object(proxy, "load_vpic", side_effect=AssertionError("vPIC should not run")):
            status, info = post("/vin", {"vin": "  " + LADA.lower() + "\n"})
        self.assertEqual((status, info["status"], info["source"]), (200, "decoded", "vininfo"))
        self.assertEqual(info["check_digit"], "not_assessed")
        self.assertEqual(info["vehicle"]["make"], "LADA")
        self.assertEqual(info["vehicle"]["model"], "Vesta")
        self.assertEqual(info["vehicle"]["model_year"], 2018)
        self.assertEqual(info["vehicle"]["engine_model"], "21179")
        self.assertEqual(info["vehicle"]["plant_city"], "Izhevsk")

    def test_honda_uses_installed_offline_vpic(self):
        with patch.dict(os.environ, {"VIN_VPIC_MODE": "offline"}), patch.object(
            proxy, "request_json", side_effect=AssertionError("VIN was sent over the network"),
        ):
            status, info = post("/vin", {"vin": HONDA})
        self.assertEqual((status, info["status"], info["source"]), (200, "decoded", "nhtsa_vpic_offline"))
        self.assertEqual(info["check_digit"], "match")
        self.assertEqual(info["vehicle"]["model"], "Accord")
        self.assertEqual(info["vehicle"]["model_year"], 2003)
        self.assertEqual(info["vehicle"]["engine_hp"], "240")
        self.assertEqual(info["vehicle"]["transmission_speeds"], "5")

    def test_online_shapes_and_vpic_error_codes(self):
        raw = {"Make": "HONDA", "Model": "Accord", "ModelYear": "2003", "ErrorCode": "1", "Trim": "Not Applicable"}
        with patch.dict(os.environ, {"VIN_VPIC_MODE": "online"}), patch.object(
            proxy, "request_json", return_value={"Results": [raw]},
        ) as call:
            status, info = post("/vin", {"vin": HONDA})
        call.assert_called_once_with(f"{proxy.VPIC_URL}{HONDA}?format=json")
        self.assertEqual((status, info["source"], info["check_digit"]), (200, "nhtsa_vpic_online", "mismatch"))
        self.assertEqual(info["status"], "partial")
        self.assertNotIn("trim", info["vehicle"])

    def test_unmatched_pattern_does_not_publish_guessed_model_and_year(self):
        raw = {"Make": "BYD", "Model": "Electric Bus Chassis", "ModelYear": "2022", "ErrorCode": "1,4,14"}
        with patch.object(proxy, "load_vpic", return_value=("nhtsa_vpic_offline", raw)):
            status, info = post("/vin", {"vin": "LC0CE4CB6N0123456"})
        self.assertEqual((status, info["status"]), (200, "partial"))
        self.assertEqual(info["vehicle"], {"make": "BYD"})

    def test_model_year_is_not_guessed_with_only_manufacturer_data(self):
        raw = {"Make": "PEUGEOT", "ModelYear": "1987", "ErrorCode": "1,5,14,400", "PlantCountry": "FRANCE"}
        with patch.object(proxy, "load_vpic", return_value=("nhtsa_vpic_offline", raw)):
            status, info = post("/vin", {"vin": "VF3AAA123HA123456"})
        self.assertEqual((status, info["status"]), (200, "partial"))
        self.assertEqual(info["vehicle"], {"make": "PEUGEOT"})

    def test_vpic_outage_uses_known_wmi_and_distinguishes_unknown(self):
        with patch.object(proxy, "load_vpic", side_effect=proxy.VPICUnavailable):
            status, info = post("/vin", {"vin": "JHM12345678901234"})
            missing, _ = post("/vin", {"vin": "ZZZ12345678901234"})
        self.assertEqual((status, info["status"], info["source"]), (200, "partial", "vininfo"))
        self.assertEqual(info["vehicle"], {"manufacturer": "Honda"})
        self.assertEqual(missing, 503)

    def test_malformed_chassis_and_non_latin_lookalike_are_rejected(self):
        for vin, code in (("BNR32-30AB66", "invalid_vin"), ("ХTAGFK330JY144213", "invalid_vin")):
            with self.subTest(vin=vin):
                status, error = post("/vin", {"vin": vin})
                self.assertEqual((status, error["code"]), (400, code))

    def test_us_check_supports_x_and_placeholder(self):
        status, result = post("/vin/check-digit", {"vin": "1M8GDM9A?KP042788"})
        self.assertEqual(status, 200)
        self.assertIsNone(result["matches"])
        self.assertEqual(result["expected_check_digit"], "X")
        self.assertEqual(result["vin_with_check_digit"], "1M8GDM9AXKP042788")
        _, result = post("/vin/check-digit", {"vin": HONDA})
        self.assertTrue(result["matches"])
        status, error = post("/vin/check-digit", {"vin": CHASSIS})
        self.assertEqual((status, error["code"]), (400, "chassis_number"))


class ExternalVehicleTests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        directory = stack.enter_context(TemporaryDirectory())
        stack.enter_context(patch.object(api_registry, "REGISTRY_PATH", Path(directory) / "providers.sqlite3"))
        api_registry.initialize_registry()
        stack.enter_context(patch.dict(os.environ, {"API_NINJAS_KEY": "demo-secret", "API_NINJAS_MODE": "demo"}))

    def test_japanese_chassis_keeps_both_years_and_uses_one_request(self):
        headers = {"RateLimit-Limit": "100", "RateLimit-Remaining": "99", "RateLimit-Reset": str(int(time()) + 3600)}
        upstream = Mock(return_value=(CHASSIS_RESPONSE, headers))
        with patch.object(proxy, "VINROKU", Vinroku(upstream)), patch.object(
            proxy, "ninjas_lookup", side_effect=AssertionError("A range match must not call the fallback"),
        ):
            status, info = post("/vin", {"vin": " mxph14 — 0036630 "})
            _, repeat = post("/vin", {"vin": CHASSIS})
        self.assertEqual((status, info["status"], info["chassis"]), (200, "ambiguous", CHASSIS))
        self.assertEqual([record["production_year"] for record in info["matches"]], [2025, 2024])
        self.assertEqual(info["catalog_references"][0]["model"], "YARIS")
        self.assertEqual(info["matches"][0]["serial_start"], "0036630")
        self.assertNotIn("vehicle", info)
        self.assertTrue(repeat["cached"])
        upstream.assert_called_once_with(VINROKU_URL + "?q=" + CHASSIS, timeout=6, include_headers=True)

    def test_vinroku_quota_blocks_more_requests_until_reset(self):
        api_registry.save_quota("vinroku", 100, 0, int(time()) + 3600)
        upstream = Mock()
        with patch.dict(os.environ, {"API_NINJAS_MODE": "off"}), patch.object(proxy, "VINROKU", Vinroku(upstream)):
            status, response = post("/vin", {"vin": CHASSIS})
        self.assertEqual((status, response["code"]), (429, "vinroku_rate_limited"))
        upstream.assert_not_called()

    def test_ninjas_fallback_uses_key_as_header_and_never_caches(self):
        vin = "LGXCE4CB1R2065480"
        public = {"vin": vin, "country": "China", "year": "2024"}
        full = {**public, "manufacturer": "BYD", "model": "Yuan Plus", "class": "SUV"}
        partial = {"Make": "BYD", "ErrorCode": "8"}
        with patch.object(proxy, "load_vpic", return_value=("nhtsa_vpic_offline", partial)), patch.object(
            proxy, "request_json", side_effect=[public, full],
        ) as upstream:
            _, without_model = post("/vin", {"vin": vin})
            _, with_model = post("/vin", {"vin": vin})
        self.assertEqual(without_model["source"], "nhtsa_vpic_offline")
        self.assertNotIn("model_year", without_model["vehicle"])
        self.assertEqual(with_model["source"], "api_ninjas")
        self.assertEqual(with_model["vehicle"]["model"], "Yuan Plus")
        self.assertEqual(upstream.call_count, 2)
        self.assertEqual(upstream.call_args.args[0], NINJAS_URL + "?vin=" + vin)
        self.assertEqual(upstream.call_args.kwargs["headers"], {"X-Api-Key": "demo-secret"})

    def test_ninjas_is_a_chassis_fallback_when_vinroku_has_no_result(self):
        payload = {**CHASSIS_RESPONSE, "matches": [], "catalogReferences": []}
        with patch.object(proxy, "VINROKU", Vinroku(Mock(return_value=(payload, {})))), patch.object(
            proxy, "request_json", return_value={"vin": CHASSIS, "manufacturer": "Toyota", "model": "Yaris"},
        ):
            status, info = post("/vin", {"vin": CHASSIS})
        self.assertEqual((status, info["type"], info["source"]), (200, "chassis", "api_ninjas"))
        self.assertEqual(info["vehicle"]["model"], "Yaris")

    def test_registry_shows_quota_and_key_state_without_secrets(self):
        api_registry.save_quota("vinroku", 100, 99, int(time()) + 3600)
        status, _, body = request("GET", "/api-providers")
        self.assertEqual(status, 200)
        self.assertNotIn(b"demo-secret", body)
        providers = {row["id"]: row for row in json.loads(body)["providers"]}
        self.assertEqual(providers["api_ninjas"]["credential_status"], "configured")
        self.assertEqual(providers["vinroku"]["remaining"], 99)
        self.assertEqual(request("GET", "/api-providers.sqlite3")[0], 404)


class PartsTests(unittest.TestCase):
    def test_car_part_polls_once_started_and_filters_dataset_fields(self):
        upstream = Mock(side_effect=[
            {"data": {"id": "TestRun12345", "status": "READY"}},
            {"data": {"id": "TestRun12345", "status": "RUNNING"}},
            {"data": {"id": "TestRun12345", "status": "SUCCEEDED", "defaultDatasetId": "TestData12345"}},
            [{"partName": "Engine", "price": 2000, "supplierEmail": "drop@example.com"}],
        ])
        with patch.dict(os.environ, {"APIFY_TOKEN": "test", "APIFY_TOKEN_EXPIRES_AT": ""}), patch.object(
            proxy, "CAR_PART", CarPart(upstream),
        ):
            status, job = post("/car-part", CAR_FORM)
            self.assertEqual(status, 202)
            self.assertEqual(post("/car-part", CAR_FORM), (202, job))
            self.assertEqual(post("/car-part/status", {"run_id": job["run_id"]}), (202, job))
            done, data = post("/car-part/status", {"run_id": job["run_id"]})
        self.assertEqual(done, 200)
        self.assertEqual(data["items"], [{"partName": "Engine", "price": 2000}])
        self.assertEqual(len(upstream.call_args_list), 4)
        call = upstream.call_args_list[0]
        self.assertIn("/actors/YJtKnjFupdQDdpN05/runs", call.args[0])
        self.assertFalse(call.kwargs["payload"]["includePhones"])
        self.assertFalse(call.kwargs["payload"]["includeEmails"])
        self.assertEqual(call.kwargs["headers"], {"Authorization": "Bearer test"})

    def test_expired_token_and_unknown_job_do_not_call_upstream(self):
        upstream = Mock()
        with patch.dict(os.environ, {"APIFY_TOKEN": "test", "APIFY_TOKEN_EXPIRES_AT": "2025-01-01T00:00:00Z"}), patch.object(
            proxy, "CAR_PART", CarPart(upstream),
        ):
            self.assertEqual(post("/car-part", CAR_FORM)[1]["code"], "apify_expired")
            self.assertEqual(post("/car-part/status", {"run_id": "OtherAccountRun1"})[0], 404)
        upstream.assert_not_called()

    def test_reef_cache_reports_zero_credits_for_repeat(self):
        proxy.REEF_CACHE.clear()
        response = {"ok": True, "data": {"parts": []}, "meta": {"charged_credits": 2}}
        with patch.dict(os.environ, {"REEF_KEY": "test"}), patch.object(proxy, "request_json", return_value=response) as call:
            self.assertEqual(post("/autodoc", {"query": "ref", "market": "uk"})[1]["meta"]["charged_credits"], 2)
            cached = post("/autodoc", {"market": "uk", "query": " ref "})[1]["meta"]
            self.assertEqual((cached["cached"], cached["charged_credits"]), (True, 0))
        call.assert_called_once()

    def test_reef_returns_key_and_credit_errors_separately(self):
        with patch.dict(os.environ, {"REEF_KEY": "test"}):
            for status in (401, 402):
                error = HTTPError(proxy.REEF_URL, status, "error", {}, None)
                with patch.object(proxy, "request_json", side_effect=error):
                    self.assertEqual(post("/autodoc", {"query": "different"})[0], status)

    def test_reef_localizes_keywords_and_reuses_the_translated_cache(self):
        proxy.REEF_CACHE.clear()
        response = {"ok": True, "data": {"parts": []}, "meta": {"charged_credits": 2}}
        with patch.dict(os.environ, {"REEF_KEY": "test"}), patch.object(proxy, "request_json", return_value=response) as call:
            self.assertEqual(post("/autodoc", {"query": "тормозные колодки", "market": "es", "mode": "keyword"})[0], 200)
            status, cached = post("/autodoc", {"query": "brake pads", "market": "es", "mode": "keyword"})
            self.assertEqual((status, cached["meta"]["charged_credits"]), (200, 0))
        self.assertEqual(call.call_args.kwargs["payload"], {
            "query": "pastillas de freno", "market": "es", "page": 1, "max_results": 20,
        })
        call.assert_called_once()

    def test_reef_oe_uses_official_endpoint_and_typed_not_found_is_empty(self):
        proxy.REEF_CACHE.clear()
        response = {"ok": False, "error": {"code": "NOT_FOUND"}, "meta": {}}
        with patch.dict(os.environ, {"REEF_KEY": "test"}), patch.object(proxy, "request_json", return_value=response) as call:
            status, body = post("/autodoc", {"query": "04152-40060", "mode": "oe"})
            self.assertEqual((status, body["data"]["parts"]), (200, []))
        self.assertEqual(call.call_args.args[0], proxy.REEF_OE_URL)
        self.assertEqual(call.call_args.kwargs["payload"]["oem_number"], "04152-40060")

    def test_legacy_browser_preflight_works_and_foreign_origins_are_denied(self):
        status, head, _ = request("OPTIONS", "/autodoc", origin="http://localhost:8000")
        self.assertEqual(status, 204)
        self.assertIn(b"Access-Control-Allow-Origin: http://localhost:8000", head)
        self.assertEqual(request("OPTIONS", "/car-part", origin="https://example.com")[0], 403)
        self.assertEqual(request("GET", "/.env")[0], 404)
        self.assertIn(b"id=\"carPartForm\"", request("GET", "/")[2])


class FapiTests(unittest.TestCase):
    def setUp(self):
        self.fapi_env = patch.dict(os.environ, {"FAPI_KEY": "fapi-test-secret"})
        self.fapi_env.start()
        self.addCleanup(self.fapi_env.stop)
        budget = Mock()
        budget.fetch.side_effect = lambda endpoint, params, credits, call: fapi_request(endpoint, call, params)
        budget_patch = patch.object(proxy, "FAPI_BUDGET", budget)
        budget_patch.start()
        self.addCleanup(budget_patch.stop)

    def test_article_lookup_returns_grouped_references(self):
        original = {"mfi": 7, "ds": "Source Brand", "n": "W 75/3", "ns": "W753"}
        replacement = {"mfi": 7, "ds": "Source Brand", "n": "W 75/4", "ns": "W754"}
        analog = {"mfi": 9, "ds": "Other Brand", "ns": "AB100", "rp": 3, "rm": 0, "mfc": True}
        response = {
            "part": original, "current": replacement, "candidates": [original], "status": "replaced",
            "analogs": [analog], "oe": [{"mfi": 12, "ds": "Car Brand", "n": "00001"}],
            "replacedBy": [replacement],
        }
        with patch.object(proxy, "request_json", return_value=response) as upstream:
            status, item = post("/fapi/part", {"article": " W 75/3 ", "manufacturer_id": 7})
        upstream.assert_called_once_with(
            FAPI_URL + "/part?n=W+75%2F3&limit=100&mfi=7",
            headers={"Authorization": "Bearer fapi-test-secret"}, timeout=10,
        )
        self.assertEqual((status, item["status"], item["part_status"]), (200, "found", "replaced"))
        self.assertEqual(item["current"]["article"], "W 75/4")
        self.assertEqual(item["groups"]["oe"][0]["article"], "00001")
        self.assertEqual(item["groups"]["analogs"], [{
            "article": "AB100", "brand": "Other Brand", "manufacturer_id": 9,
            "manufacturer_verified": True, "votes_for": 3, "votes_against": 0,
        }])

    def test_ambiguous_article_requests_brand_without_an_extra_call(self):
        candidates = [{"mfi": maker, "ds": brand, "n": "42"} for maker, brand in [(7, "One"), (9, "Two")]]
        with patch.object(proxy, "request_json", return_value={"candidates": candidates}) as upstream:
            status, item = post("/fapi/part", {"article": "42"})
        self.assertEqual((status, item["status"]), (200, "choose_brand"))
        self.assertEqual([part["brand"] for part in item["candidates"]], ["One", "Two"])
        upstream.assert_called_once()

    def test_free_usage_preserves_zero_credits_and_filters_other_balances(self):
        response = {
            "account": {"st": "denied_quota", "pl": "trial", "inc": 100, "rem": 0, "u": 100},
            "vin": {"st": "ok", "balance_kopecks": 9000},
        }
        with patch.object(proxy, "request_json", return_value=response) as upstream:
            status, _, body = request("GET", "/fapi/usage")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {
            "plan": "trial", "status": "denied_quota", "included_credits": 100,
            "remaining_credits": 0, "used_credits": 100,
        })
        upstream.assert_called_once_with(
            FAPI_URL + "/usage", headers={"Authorization": "Bearer fapi-test-secret"}, timeout=10,
        )

    def test_expired_key_and_trial_quota_errors_are_not_retried(self):
        for status, code in ((401, "fapi_key_expired"), (402, "fapi_credits_unavailable")):
            error = HTTPError(FAPI_URL, status, "upstream", {}, None)
            with self.subTest(status=status), patch.object(proxy, "request_json", side_effect=error) as call:
                http_status, body = post("/fapi/part", {"article": "LRc 0127"})
                self.assertEqual((http_status, body["code"]), (status, code))
                call.assert_called_once()

    def test_no_request_for_invalid_brand_or_empty_key(self):
        with patch.object(proxy, "request_json") as upstream:
            self.assertEqual(post("/fapi/part", {"article": "42", "manufacturer_id": True})[0], 400)
            with patch.dict(os.environ, {"FAPI_KEY": ""}):
                self.assertEqual(post("/fapi/part", {"article": "42"})[1]["code"], "fapi_key_missing")
        upstream.assert_not_called()

    def test_probox_by_phrase_and_chassis_never_touches_fapi(self):
        with patch.object(proxy, "request_json") as upstream, patch.dict(os.environ, {"FAPI_KEY": ""}):
            status, result = post("/fapi/vehicle-parts", {"query": "фильтр маслянных пробокс"})
            self.assertEqual((status, result["status"], result["vehicle"]), (200, "reference", "Toyota Probox"))
            self.assertEqual({item["article"] for item in result["parts"]}, {
                "04152-40060", "90915-10003", "90915-10009", "90915-20003",
            })
            _, specific = post("/fapi/vehicle-parts", {"query": "масляный фильтр Пробокс NSP160"})
            self.assertEqual([item["article"] for item in specific["parts"]], ["04152-40060"])
        upstream.assert_not_called()

    def test_guided_probox_recognizes_layouts_and_confirms_engine_then_date(self):
        spellings = (
            "фильтр маслянных пробокс", "vfckzysq abkmnh ghj,jrc", "maslyaniy filtr Proboks",
            "щшд ашдеук ещнщеф зкщищч", "филтр масляный Toyota ghj,jrc",
        )
        with patch.object(proxy, "request_json") as upstream:
            for query in spellings:
                _, result = post("/parts/search", {"query": query})
                self.assertEqual((result["vehicle"], result["field"]), ("Toyota Probox", "engine"))
                self.assertGreater(len(result["options"]), 1)
            query = "масляный фильтр Пробокс NCP160V"
            _, engine = post("/parts/search", {"query": query})
            engine_id = engine["options"][0]["id"]
            _, versions = post("/parts/search", {"query": query, "choices": {"engine": engine_id}})
            self.assertEqual(versions["field"], "version")
            self.assertEqual(len(versions["options"]), 2)
            modern = next(item["id"] for item in versions["options"] if "03.2023" in item["label"])
            choices = {"engine": engine_id, "version": modern}
            _, result = post("/parts/search", {"query": query, "choices": choices})
            self.assertEqual([part["article"] for part in result["parts"]], ["90915-10009"])
            _, dated = post("/parts/search", {"query": query + " 02.2023", "choices": {"engine": engine_id}})
            self.assertEqual([part["article"] for part in dated["parts"]], ["90915-10003"])
        upstream.assert_not_called()

    def test_guided_initial_steps_never_contact_providers(self):
        with patch.object(proxy, "request_json") as upstream:
            self.assertEqual(post("/parts/search", {"query": "колодки"})[1]["status"], "need_vehicle")
            _, result = post("/parts/search", {"query": "масляный фильтр сфькн 2019 2,5"})
            self.assertEqual((result["status"], result["vehicle"]), ("confirm", "Toyota Camry · 2019 · 2,5 л"))
            _, result = post("/parts/search", {"query": "ДКс 0127"})
            self.assertEqual([item["label"] for item in result["options"]], ["ДКс 0127", "LRC 0127"])
            self.assertEqual(post("/parts/search", {"query": "колодки", "catalog": "autodoc"})[1]["status"], "keyword")
            self.assertEqual(
                post("/parts/search", {"query": "масляный фильтр Camry 2019", "catalog": "autodoc"})[1]["status"], "confirm",
            )
        upstream.assert_not_called()


class MeteredPartsTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.budget = FapiBudget(Path(tmp.name) / "fapi.sqlite3")
        self.state_path = Path(tmp.name) / "groq.sqlite3"
        setup = ExitStack()
        self.addCleanup(setup.close)
        setup.enter_context(patch.object(proxy, "FAPI_BUDGET", self.budget))
        setup.enter_context(patch("part_ai.STATE_PATH", self.state_path))
        setup.enter_context(patch.dict(os.environ, {
            "FAPI_KEY": "fake-fapi", "FAPI_DAILY_CREDIT_LIMIT": "1000",
            "GROQ_API_KEY": "fake-groq", "GROQ_DAILY_REQUEST_LIMIT": "1",
        }))

    @staticmethod
    def account(remaining=100):
        return {"account": {"st": "allowed", "pl": "trial", "inc": 100, "rem": remaining, "u": 100 - remaining}}

    def test_normalizes_cache_keys_and_keeps_hits_when_daily_limit_reached(self):
        with patch.dict(os.environ, {"FAPI_DAILY_CREDIT_LIMIT": "1"}), patch.object(
            proxy, "request_json", side_effect=[self.account(), {"candidates": []}],
        ) as upstream:
            self.assertEqual(post("/fapi/part", {"article": "W 75/3"})[0], 200)
            self.assertEqual(post("/fapi/part", {"article": "w753"})[0], 200)
            result = post("/fapi/part", {"article": "other123"})
            self.assertEqual((result[0], result[1]["code"]), (429, "fapi_daily_limit"))
        self.assertEqual(upstream.call_count, 2)

    def test_package_remaining_blocks_larger_calls(self):
        with patch.object(proxy, "request_json", return_value=self.account(2)) as upstream:
            status, result = post("/fapi/vehicle-parts", {"query": "масляный фильтр Toyota Camry"})
        self.assertEqual((status, result["code"]), (402, "fapi_package_limited"))
        self.assertEqual(upstream.call_count, 1)

    def test_empty_catalog_step_uses_one_credit_in_local_ledger(self):
        responses = [self.account(10), {"mf": [{"dbi": 111, "ds": "TOYOTA"}]}, {"m": []}]
        with patch.object(proxy, "request_json", side_effect=responses) as upstream:
            query = {"query": "масляный фильтр Camry 2019", "confirmed": True}
            self.assertEqual(post("/parts/search", query)[0], 402)
            self.assertEqual(upstream.call_count, 2)
        responses = [self.account(20), {"mf": [{"dbi": 111, "ds": "TOYOTA"}]}, {"m": []}]
        with patch.dict(os.environ, {"FAPI_KEY": "second-fake-fapi", "FAPI_DAILY_CREDIT_LIMIT": "11"}), patch.object(
            proxy, "request_json", side_effect=[*responses, {"candidates": []}],
        ) as upstream:
            self.assertEqual(post("/parts/search", query)[0], 200)
            self.assertEqual(post("/fapi/part", {"article": "A123"})[0], 200)
            self.assertEqual(upstream.call_count, 4)

    def test_shop_catalog_guides_fitment_and_blocks_uncovered_fapi_calls(self):
        database = self.state_path.with_name("shop.sqlite3")
        csv = database.with_suffix(".csv")
        csv.write_text(
            "make,model,category,configuration,engine,liters,year_from,year_to,article,brand,oem,source\n"
            "Toyota,Camry,Масляный фильтр,XV70 2.5,A25A-FKS,2.5,2018,2024,EXAMPLE-1,Example,1,Тест\n"
            "Toyota,Camry,Масляный фильтр,XV50 2.0,6AR-FSE,2.0,2014,2017,EXAMPLE-2,Example,0,Тест\n",
            encoding="utf-8",
        )
        self.assertEqual(import_fitment(csv, database, {"Масляный фильтр"}), 2)
        with patch.dict(os.environ, {"AN30_FITMENT_DB": str(database), "FAPI_FITMENT_ENABLED": "0"}), patch.object(
            proxy, "request_json",
        ) as upstream:
            form = {"query": "масляный фильтр Камри 2019 2,5"}
            _, step = post("/parts/search", form)
            self.assertEqual(step["field"], "local_variant")
            self.assertEqual(len(step["options"]), 1)
            _, result = post("/parts/search", {**form, "choices": {"local_variant": step["options"][0]["id"]}})
            self.assertEqual(result["parts"][0]["article"], "EXAMPLE-1")
            self.assertTrue(result["parts"][0]["oem"])
            self.assertEqual(post("/parts/search", {"query": "масляный фильтр Camry 2002", "confirmed": True})[1]["status"], "no_data")
        upstream.assert_not_called()

    def test_vehicle_lookup_selects_only_one_node_and_shares_catalog(self):
        responses = [
            self.account(),
            {"mf": [{"dbi": 111, "ds": "TOYOTA"}]},
            {"m": [{"dbi": 123, "d": "CAMRY (XV70)"}]},
            {"m": [{"dbi": 456, "d": "2.5", "fd": "Toyota Camry 2.5", "engineCode": "A25A-FKS"}]},
            [{"i": 789, "d": "Масляный фильтр"}, {"i": 790, "d": "Корпус масляного фильтра"}],
            [{"mfi": 12, "mfd": "MANN", "n": "W 75/3", "d": "Фильтр масляный"}],
        ]
        search = {"query": "масляный фильтр Тойота Камри"}
        with patch.object(proxy, "request_json", side_effect=responses) as upstream:
            status, options = post("/fapi/vehicle-parts", search)
            self.assertEqual((status, options["field"]), (200, "modification"))
            self.assertEqual(upstream.call_count, 4)
            chosen = {**search, "choices": {**options["choices"], "modification": 456}}
            status, found = post("/fapi/vehicle-parts", chosen)
            self.assertEqual((status, found["parts"][0]["article"]), (200, "W 75/3"))
            self.assertEqual(upstream.call_args.args[0], FAPI_URL + "/catalogList/dt/productList?modi=456&nodei=789")
            self.assertEqual(post("/fapi/vehicle-parts", chosen), (status, found))
        self.assertEqual(upstream.call_count, 6)

    def test_identical_catalog_group_names_use_parent_sections(self):
        nodes = matching_nodes([
            {"i": 1, "d": "Двигатель"}, {"i": 2, "d": "Фильтрация"},
            {"i": 3, "d": "Масляный фильтр", "pi": 1}, {"i": 4, "d": "Масляный фильтр", "pi": 2},
        ], CATEGORIES[0][1])
        self.assertEqual([node["label"] for node in nodes], [
            "Двигатель → Масляный фильтр", "Фильтрация → Масляный фильтр",
        ])

    def test_groq_suggests_normalized_query_without_running_catalog(self):
        content = json.dumps({"category": "Масляный фильтр", "make": "Toyota", "model": "Probox"})
        with patch.object(proxy, "request_json", return_value={"choices": [{"message": {"content": content}}]}) as upstream:
            status, result = post("/parts/ai-suggest", {"query": "фильтр мазла прабокса"})
            self.assertEqual((status, result["query"]), (200, "Масляный фильтр Toyota Probox"))
            self.assertEqual(post("/parts/ai-suggest", {"query": "масляный фильтр Honda Civic"})[0], 429)
        upstream.assert_called_once()
        self.assertEqual(upstream.call_args.args[0], GROQ_URL)
        body = upstream.call_args.kwargs["payload"]
        self.assertEqual(body["messages"][0]["role"], "system")
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertNotIn("tools", body)

    def test_groq_rejects_vin_chassis_and_credential_strings(self):
        with patch.object(proxy, "request_json") as upstream:
            for label in (LADA, CHASSIS, "gsk_12345678901234567890", "a@example.com"):
                self.assertEqual(post("/parts/ai-suggest", {"query": "фильтр " + label})[0], 400)
        upstream.assert_not_called()


if __name__ == "__main__":
    unittest.main()
