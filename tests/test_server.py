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
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.server import default_executor, experiment_args, Workbench, handler_for
from vmobserve import SCHEMA_VERSION
from vmobserve.common import write_json
from vmobserve.replay import read_evidence, load_run
from vmobserve.export import demand_process_evidence
from verify_submission import verify_process_file


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

    def test_classroom_review_page_and_assets_are_available(self):
        for route, marker in (("/practice-review", "课堂首答复核"),
                              ("/practice-review.js", "reviewPracticeAttempt"),
                              ("/practice-data.js", "vmobserve.demand-practice-attempt/v1")):
            with self.subTest(route=route), urlopen(self.base + route) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(marker, response.read().decode("utf-8"))

    def test_windows_clean_checkout_defaults_to_replay_until_vm_is_configured(self):
        with tempfile.TemporaryDirectory() as tmp, patch("vmobserve.server.WORK", Path(tmp)), \
                patch("vmobserve.server.platform.system", return_value="Windows"):
            self.assertEqual(default_executor(), "local")
            app = Workbench(default_executor())
            with self.assertRaisesRegex(ValueError, "回放"):
                app.start("sequence")
            self.assertIsNone(app.job)
            disk = Path(tmp) / "openeuler-vm/experiment.qcow2"
            disk.parent.mkdir()
            disk.touch()
            self.assertEqual(default_executor(), "openeuler-vm")
            with patch("vmobserve.server.platform.system", return_value="Linux"):
                self.assertEqual(default_executor(), "local")

    def test_report_and_all_export_formats(self):
        with urlopen(self.base + "/api/report?id=test--legacy-run") as response:
            report = json.load(response)
        self.assertEqual(report["view_mode"], "historical_replay")
        for fmt, mime in (("html", "text/html"), ("csv", "text/csv"), ("json", "application/json")):
            with urlopen(self.base + f"/api/export?id=test--legacy-run&format={fmt}") as response:
                self.assertIn(mime, response.headers["Content-Type"])
                self.assertIn("attachment", response.headers["Content-Disposition"])
                self.assertGreater(len(response.read()), 100)

    def test_catalog_keeps_other_runs_when_a_case_is_missing_its_suite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "broken").mkdir()
            (root / "broken/report.json").write_text('{"cases":[{"parameters":{}}]}', encoding="utf-8")
            app = Workbench("local", {"import": root, "example": ROOT / "examples"})
            items = {record["id"]: record for record in app.catalog()}
            self.assertEqual(items["import--broken"]["status"], "unreadable")
            self.assertEqual(items["example--20261120T120355.446473Z"]["status"], "completed")

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

    def test_process_evidence_download_matches_display_and_hashes(self):
        allow, disable = "20261125T110630.221939Z", "20261125T110657.478995Z"
        endpoint = self.base + "/api/demand-process-comparison?"
        query = urlencode({"id": f"example--{disable}", "other": f"example--{allow}", "repeat": 3})
        active = endpoint + query + "&phase=write_quarter"
        with urlopen(active) as response:
            evidence = json.load(response)
        with urlopen(active + "&download=1") as response:
            self.assertIn('filename="demand-process-evidence.json"', response.headers["Content-Disposition"])
            self.assertEqual(json.load(response), evidence)
        self.assertEqual(evidence["schema_version"], "vmobserve.demand-process-evidence/v1")
        self.assertEqual((evidence["repeat"], evidence["phase"]), (3, "write_quarter"))
        self.assertEqual([(row["rss_kib"], row["huge_kib"], row["action_minor"]) for row in evidence["cases"]],
                         [(131072, 131072, 64), (131072, 0, 32768)])
        for row in evidence["cases"]:
            root = ROOT / "examples" / row["run_id"]
            self.assertEqual(row["case_id"], "demand512-thp-on-3")
            self.assertEqual(row["report_sha256"], hashlib.sha256((root / "report.json").read_bytes()).hexdigest())
            self.assertEqual(set(row["artifacts"]), {"jsonl", "smaps"})
            for source in row["artifacts"].values():
                self.assertEqual(source["sha256"], hashlib.sha256((root / source["path"]).read_bytes()).hexdigest())
        with urlopen(endpoint + query + "&phase=freed") as response:
            released = json.load(response)["cases"]
        self.assertTrue(all(row["rss_kib"] is None and row["huge_kib"] is None
                            and row["written_positions"] is None for row in released))
        self.assertTrue(all(isinstance(row["action_minor"], int) for row in released))

    def test_downloaded_process_file_rebuilds_and_rejects_changed_readings(self):
        paths = ["20261125T110630.221939Z", "20261125T110657.478995Z"]
        reports = [load_run(ROOT / "examples" / path) for path in paths]
        ids = [f"example--{path}" for path in paths]
        evidence = demand_process_evidence(ids, reports, 1, "write_quarter")
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "process.json"
            file.write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
            roots = [ROOT / "examples"]
            self.assertEqual(verify_process_file(file, roots)["status"], "passed")
            with self.assertRaisesRegex(ValueError, "no matching original report"):
                verify_process_file(file, [])
            evidence["cases"][1]["huge_kib"] = False
            file.write_text(json.dumps(evidence), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, r"cases\[2\]\.huge_kib"):
                verify_process_file(file, roots)
            file.write_text('{"repeat":1,"repeat":2}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate JSON fields"):
                verify_process_file(file, roots)

    def test_process_evidence_rejects_incompatible_records(self):
        paths = ["20261125T110630.221939Z", "20261125T110657.478995Z"]
        first, second = [load_run(ROOT / "examples" / path) for path in paths]
        ids = [f"example--{path}" for path in paths]
        for changes in ({"environment": {**second["environment"], "page_bytes": 65536}},
                        {"sources": {}}, {"integrity": {"status": "failed"}}):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    demand_process_evidence(ids, [first, {**second, **changes}], 2, "write_quarter")
        with self.assertRaises(ValueError):
            demand_process_evidence(ids, [first, second], 4, "write_quarter")
        with self.assertRaises(ValueError):
            demand_process_evidence(ids, [first, second], 2, "not_a_phase")
        with self.assertRaises(ValueError):
            demand_process_evidence(ids, [first, first], 2, "write_quarter")

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
