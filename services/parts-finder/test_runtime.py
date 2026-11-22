"""Tests for the settings that let the module run as an internal АН-30 service."""

import io
import json
import os
import unittest
import unittest.mock
from contextlib import redirect_stderr
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

import api_registry
import local_fitment
import part_ai
import proxy
import runtime_config
from fapi_budget import FapiBudget
from test_app import MemoryRequest


def get(path, host, port=8011):
    connection = MemoryRequest(f"GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n".encode())
    proxy.ProxyHandler(connection, ("127.0.0.1", 50000), SimpleNamespace(server_port=port))
    head, content = connection.writer.getvalue().split(b"\r\n\r\n", 1)
    return int(head.split()[1]), json.loads(content)


def clean_env(**values):
    names = ("PARTS_FINDER_ALLOWED_HOSTS", "PARTS_FINDER_STATE_DIR", "PARTS_FINDER_ENV_FILE", "AN30_FITMENT_DB")
    environment = {key: value for key, value in os.environ.items() if key not in names}
    return patch.dict(os.environ, {**environment, **values}, clear=True)


class ArgumentTests(unittest.TestCase):
    def test_defaults_listen_on_localhost_8011(self):
        args = proxy.parse_args([])
        self.assertEqual((args.host, args.port), ("127.0.0.1", 8011))

    def test_host_and_port_can_be_set_for_a_container(self):
        args = proxy.parse_args(["--host", "0.0.0.0", "--port", "9000"])
        self.assertEqual((args.host, args.port), ("0.0.0.0", 9000))


class AllowedHostTests(unittest.TestCase):
    def test_default_allows_only_localhost_with_the_server_port(self):
        with clean_env():
            self.assertEqual(runtime_config.allowed_hosts(8011), {"localhost:8011", "127.0.0.1:8011"})
            self.assertEqual(get("/health", "127.0.0.1:8011"), (200, {"ok": True}))
            self.assertEqual(get("/health", "localhost:8011")[0], 200)
            self.assertEqual(get("/health", "parts-finder:8011")[0], 403)
            self.assertEqual(get("/health", "127.0.0.1:9999")[0], 403)

    def test_configured_list_replaces_the_default_and_ignores_case_and_spaces(self):
        with clean_env(PARTS_FINDER_ALLOWED_HOSTS=" parts-finder:8011 , 127.0.0.1:8011,, "):
            self.assertEqual(runtime_config.allowed_hosts(8011), {"parts-finder:8011", "127.0.0.1:8011"})
            self.assertEqual(get("/health", "Parts-Finder:8011")[0], 200)
            self.assertEqual(get("/health", "127.0.0.1:8011")[0], 200)
            self.assertEqual(get("/health", "localhost:8011")[0], 403)
            self.assertEqual(get("/health", "evil.example:8011")[0], 403)

    def test_missing_host_header_is_rejected(self):
        connection = MemoryRequest(b"GET /health HTTP/1.0\r\n\r\n")
        proxy.ProxyHandler(connection, ("127.0.0.1", 50000), SimpleNamespace(server_port=8011))
        self.assertIn(b" 403 ", connection.writer.getvalue().split(b"\r\n", 1)[0])


class RequestLimitTests(unittest.TestCase):
    def test_rejects_excess_connections_without_starting_more_handlers(self):
        started, release = Event(), Event()

        class SlowHandler(proxy.ProxyHandler):
            def do_GET(self):
                started.set()
                release.wait(3)
                super().do_GET()

        with patch.object(proxy, "MAX_ACTIVE_REQUESTS", 1):
            with proxy.PartsFinderHTTPServer(("127.0.0.1", 0), SlowHandler) as server:
                listener = Thread(target=server.serve_forever, daemon=True)
                listener.start()
                url = f"http://127.0.0.1:{server.server_port}/health"
                first = []

                def request_health():
                    with urlopen(url, timeout=4) as response:
                        first.append(response.status)

                ongoing = Thread(target=request_health, daemon=True)
                ongoing.start()
                try:
                    self.assertTrue(started.wait(2))
                    with self.assertRaises(HTTPError) as error:
                        urlopen(url, timeout=2)
                    with error.exception as response:
                        self.assertEqual(response.code, 503)
                finally:
                    release.set()
                    ongoing.join(4)
                    server.shutdown()
                    listener.join(2)
                self.assertEqual(first, [200])


class StateDirectoryTests(unittest.TestCase):
    def setUp(self):
        saved = (api_registry.REGISTRY_PATH, part_ai.STATE_PATH, proxy.FAPI_BUDGET.path)

        def restore():
            api_registry.REGISTRY_PATH, part_ai.STATE_PATH, proxy.FAPI_BUDGET.path = saved

        self.addCleanup(restore)

    def test_default_keeps_state_next_to_the_code(self):
        with clean_env():
            self.assertEqual(runtime_config.state_file("fapi-state.sqlite3"), runtime_config.ROOT / "fapi-state.sqlite3")
            self.assertEqual(local_fitment.db_path(), runtime_config.ROOT / "an30-fitment.sqlite3")

    def test_state_dir_moves_every_state_file_and_is_created(self):
        with TemporaryDirectory() as directory, clean_env(PARTS_FINDER_STATE_DIR=str(Path(directory) / "state")):
            state = Path(directory) / "state"
            proxy.configure_state()
            self.assertTrue(state.is_dir())
            self.assertEqual(api_registry.REGISTRY_PATH, state / "api-providers.sqlite3")
            self.assertEqual(part_ai.STATE_PATH, state / "groq-state.sqlite3")
            self.assertEqual(proxy.FAPI_BUDGET.path, state / "fapi-state.sqlite3")
            self.assertEqual(FapiBudget().path, state / "fapi-state.sqlite3")
            self.assertEqual(local_fitment.db_path(), state / "an30-fitment.sqlite3")
            api_registry.initialize_registry()
            self.assertTrue((state / "api-providers.sqlite3").is_file())

    def test_explicit_fitment_db_still_wins(self):
        with clean_env(PARTS_FINDER_STATE_DIR="/srv/state", AN30_FITMENT_DB="/srv/shop/fitment.sqlite3"):
            self.assertEqual(local_fitment.db_path(), Path("/srv/shop/fitment.sqlite3"))


class OutboundRequestTests(unittest.TestCase):
    def test_requests_carry_a_service_user_agent_and_keep_caller_headers(self):
        response = io.BytesIO(b'{"ok": true}')
        response.headers = {}
        opened = unittest.mock.MagicMock()
        opened.__enter__.return_value = response
        with patch.object(proxy.HTTPS, "open", return_value=opened) as call:
            self.assertEqual(proxy.request_json("https://example.test/api", headers={"X-Api-Key": "k"}), {"ok": True})
        request = call.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), proxy.USER_AGENT)
        self.assertEqual(request.get_header("X-api-key"), "k")
        self.assertEqual(request.get_header("Accept"), "application/json")


class EnvFileTests(unittest.TestCase):
    def test_default_env_file_is_next_to_the_code(self):
        with clean_env():
            self.assertEqual(runtime_config.env_file(), runtime_config.ROOT / ".env")

    def test_configured_env_file_is_loaded_without_overriding_the_process(self):
        with TemporaryDirectory() as directory:
            settings = Path(directory) / "parts.env"
            settings.write_text("PF_TEST_ONLY_VALUE=from-file\nPF_TEST_ONLY_KEPT=from-file\n", encoding="utf-8")
            with clean_env(PARTS_FINDER_ENV_FILE=str(settings), PF_TEST_ONLY_KEPT="from-process"):
                self.assertEqual(runtime_config.env_file(), settings)
                proxy.load_settings()
                self.assertEqual(os.environ["PF_TEST_ONLY_VALUE"], "from-file")
                self.assertEqual(os.environ["PF_TEST_ONLY_KEPT"], "from-process")

    def test_missing_configured_env_file_warns_without_printing_values(self):
        stderr = io.StringIO()
        with clean_env(PARTS_FINDER_ENV_FILE="/nonexistent/parts.env"), redirect_stderr(stderr), patch.object(
            proxy, "load_dotenv",
        ) as loader:
            proxy.load_settings()
        loader.assert_called_once_with(Path("/nonexistent/parts.env"))
        self.assertIn("PARTS_FINDER_ENV_FILE", stderr.getvalue())
        self.assertNotIn("/nonexistent", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
