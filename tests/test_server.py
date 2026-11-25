"""Local HTTP contract checks; no real experiment is started by these tests."""
from http.server import ThreadingHTTPServer
import csv
import io
import json
import hashlib
import tempfile
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.server import experiment_args, Workbench, handler_for
from vmobserve import SCHEMA_VERSION
from vmobserve.common import write_json
from vmobserve.replay import read_evidence


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Workbench("local", {"test": ROOT / "tests/fixtures", "example": ROOT / "examples"})
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

    def test_demand_pair_export_includes_same_repeat_and_evidence_checksums(self):
        run_id = "20261120T120355.446473Z"
        export = self.base + f"/api/export?id=example--{run_id}&format=demand-pair-csv"
        with urlopen(export + "&case=demand512-thp-on-2") as response:
            self.assertIn('filename="demand-pair-samples.csv"', response.headers["Content-Disposition"])
            rows = list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
        phases = ["before_alloc", "allocated", "write_quarter", "write_half", "write_all", "freed"]
        self.assertEqual([(r["phase"], r["thp_advice"]) for r in rows],
                         [(phase, policy) for phase in phases for policy in ("off", "on")])
        self.assertEqual({r["repeat"] for r in rows}, {"2"})
        self.assertEqual({r["case_id"] for r in rows}, {"demand512-thp-off-2", "demand512-thp-on-2"})
        self.assertEqual([(r["rss_kib"], r["anon_huge_kib"], r["process_minor_delta"])
                          for r in rows if r["phase"] == "write_quarter"],
                         [("131072", "0", "32768"), ("131072", "131072", "64")])
        for row in rows:
            base = ROOT / "examples" / run_id
            self.assertEqual(row["report_sha256"], hashlib.sha256((base / "report.json").read_bytes()).hexdigest())
            self.assertEqual(row["smaps_sha256"], hashlib.sha256((base / row["smaps_path"]).read_bytes()).hexdigest())
            if row["phase"] in ("before_alloc", "freed"):
                self.assertEqual((row["mapping_present"], row["rss_kib"], row["anon_huge_kib"]), ("0", "", ""))
        with urlopen(export + "&case=demand512-thp-off-2") as response:
            self.assertEqual(list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig")))), rows)

    def test_demand_csv_formats_agree_on_missing_measurements(self):
        endpoint = self.base + "/api/export?id=example--20261120T120355.446473Z"
        with urlopen(endpoint + "&format=csv") as response:
            general = list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
        case = "demand512-thp-off-2"
        with urlopen(endpoint + f"&format=demand-pair-csv&case={case}") as response:
            paired = list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
        comparable = ("phase", "written_positions", "rss_kib")
        self.assertEqual([tuple(row[key] for key in comparable) for row in general if row["case_id"] == case],
                         [tuple(row[key] for key in comparable) for row in paired if row["case_id"] == case])
        released = next(row for row in general if row["case_id"] == case and row["phase"] == "freed")
        self.assertEqual((released["count"], released["written_positions"], released["pss_kib"]), ("0", "", ""))
        observed = next(row for row in general if row["case_id"] == case and row["phase"] == "write_quarter")
        self.assertEqual(observed["huge_kib"], "0")
        with urlopen(endpoint + "&format=html") as response:
            page = response.read().decode("utf-8")
        self.assertIn(f"<td>{case}</td><td>freed</td><td>parent</td><td>address_containing_vma</td>"
                      "<td>—</td><td>—</td><td>—</td>", page)

    def test_sequence_html_agrees_with_deduplicated_report_rss(self):
        endpoint = self.base + "/api"
        identifier = "example--20261118T013159.221864Z"
        with urlopen(endpoint + f"/report?id={identifier}") as response:
            report = json.load(response)
        case = next(item for item in report["cases"] if item["suite"] == "sequence")
        sample = next(row for row in case["data"]["samples"] if row["phase"] == "alloc_1MiB")
        self.assertEqual(sample["related_rss_kib"], 16)
        self.assertNotEqual(sample["rss_kib"], sample["related_rss_kib"])
        with urlopen(endpoint + f"/export?id={identifier}&format=html") as response:
            page = response.read().decode("utf-8")
        self.assertIn(f'<td>{case["id"]}</td><td>alloc_1MiB</td><td>parent</td>'
                      "<td>相关 VMA 去重合计</td><td>16</td>", page)

    def test_demand_pair_export_rejects_unpaired_baseline(self):
        path = "/api/export?id=example--20261118T013159.221864Z&format=demand-pair-csv&case=demand512-1"
        with self.assertRaises(HTTPError) as error:
            urlopen(self.base + path)
        self.assertEqual(error.exception.code, 400)

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

    def test_group3_stderr_evidence_types_are_served(self):
        for kind in ("file_stderr", "readelf_stderr", "ldd_stderr"):
            with urlopen(f"{self.base}/api/evidence?id=example--20261118T013159.221864Z&case=link-dynamic-1&kind={kind}") as response:
                self.assertEqual(response.status, 200)

    def test_raw_evidence_does_not_replay_other_cases(self):
        with patch("vmobserve.server.load_run", side_effect=AssertionError("unexpected full replay")):
            with urlopen(self.base + "/api/evidence?id=test--legacy-run&case=baseline-16MiB-run1&kind=smaps") as response:
                self.assertIn(b"BEGIN phase=untouched", response.read())

    def test_raw_evidence_checks_selected_bytes_and_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = b'{"kind":"sample"}\n'
            (root / "raw.jsonl").write_bytes(payload)
            report = {"schema_version": SCHEMA_VERSION, "cases": [
                {"id": "one", "artifacts": {"jsonl": "raw.jsonl"}}],
                "artifacts": {"raw.jsonl": hashlib.sha256(payload).hexdigest()}}
            write_json(root / "report.json", report)
            self.assertEqual(read_evidence(root, "one", "jsonl"), payload)
            with self.assertRaisesRegex(ValueError, "size limit"):
                read_evidence(root, "one", "jsonl", limit=2)
            (root / "raw.jsonl").write_bytes(payload + b"changed")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                read_evidence(root, "one", "jsonl")
            report["artifacts"] = {}
            write_json(root / "report.json", report)
            with self.assertRaisesRegex(ValueError, "missing from artifact manifest"):
                read_evidence(root, "one", "jsonl")
            report["cases"][0]["artifacts"]["jsonl"] = "../outside.jsonl"
            write_json(root / "report.json", report)
            with self.assertRaisesRegex(ValueError, "escapes"):
                read_evidence(root, "one", "jsonl")

    def test_full_recheck_keeps_selected_pattern(self):
        command = self.app.command(experiment_args("recheck", pattern="full"), ROOT / "tests/fixtures/legacy-run")
        self.assertEqual(command[-2:], ["--pattern", "full"])
        with self.assertRaises(ValueError):
            self.app.start("recheck", "test--legacy-run", "shell-command")
        self.assertIsNone(self.app.job)

if __name__ == "__main__":
    unittest.main()
