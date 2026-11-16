"""Local HTTP contract checks; no real experiment is started by these tests."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.server import Workbench, handler_for


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Workbench("local", {"test": ROOT / "tests/fixtures"})
        handler = handler_for(cls.app)
        handler.log_message = lambda *args: None
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_report_and_all_export_formats(self):
        with urlopen(self.base + "/api/report?id=test--legacy-run") as response:
            report = json.load(response)
        self.assertEqual(report["view_mode"], "historical_replay")
        for fmt, mime in (("html", "text/html"), ("csv", "text/csv"), ("json", "application/json")):
            with urlopen(self.base + f"/api/export?id=test--legacy-run&format={fmt}") as response:
                self.assertIn(mime, response.headers["Content-Type"])
                self.assertIn("attachment", response.headers["Content-Disposition"])
                self.assertGreater(len(response.read()), 100)

    def test_cross_origin_and_missing_token_cannot_execute(self):
        for headers in ({}, {"X-VMObserve-Token": self.app.token, "Origin": "https://example.invalid"}):
            request = Request(self.base + "/api/run", data=b'{"mode":"complete"}', headers=headers, method="POST")
            with self.assertRaises(HTTPError) as error:
                urlopen(request)
            self.assertEqual(error.exception.code, 403)
        self.assertIsNone(self.app.job)

    def test_dns_rebinding_host_is_rejected(self):
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.base + "/api/config", headers={"Host": "attacker.invalid"}))
        self.assertEqual(error.exception.code, 403)

    def test_evidence_is_allowlisted_and_read_only(self):
        with urlopen(self.base + "/api/evidence?id=test--legacy-run&case=baseline-16MiB-run1&kind=smaps") as response:
            self.assertIn(b"BEGIN phase=untouched", response.read())
        for suffix in ("/api/report?id=test--..", "/api/evidence?id=test--legacy-run&case=baseline-16MiB-run1&kind=../../secret"):
            with self.assertRaises(HTTPError) as error:
                urlopen(self.base + suffix)
            self.assertEqual(error.exception.code, 400)

    def test_raw_view_does_not_rebuild_the_report(self):
        with patch("vmobserve.server.load_run", side_effect=AssertionError("unexpected replay")):
            path = "/api/evidence?id=test--legacy-run&case=baseline-16MiB-run1&kind=smaps"
            with urlopen(self.base + path) as response:
                self.assertIn(b"BEGIN phase=untouched", response.read())

    def test_default_catalog_includes_builtin_sample(self):
        app = Workbench("local")
        self.assertTrue(any(item["id"] == "sample--legacy-run" for item in app.catalog()))

    def test_full_recheck_keeps_selected_pattern(self):
        command = self.app.command(ROOT / "tests/fixtures/legacy-run", "full")
        self.assertEqual(command[-2:], ["--pattern", "full"])
        with self.assertRaises(ValueError):
            self.app.start("recheck", "test--legacy-run", "shell-command")
        self.assertIsNone(self.app.job)

if __name__ == "__main__":
    unittest.main()
