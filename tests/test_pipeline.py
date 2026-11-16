"""Real historical replay plus explicitly synthetic negative-path unit tests."""
import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.common import execute
from vmobserve.diagnosis import diagnose
from vmobserve.evidence import parse_case
from vmobserve.export import csv_text, html_text
from vmobserve.replay import load_run, safe_child

FIXTURE = ROOT / "tests/fixtures/legacy-run"
TEST_TMP = ROOT / "output/test-tmp"
TEST_TMP.mkdir(parents=True, exist_ok=True)


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = load_run(FIXTURE)

    def test_real_legacy_evidence_replays_all_18_cases(self):
        self.assertEqual(self.report["integrity"]["status"], "legacy_partial")
        self.assertEqual(len(self.report["cases"]), 18)
        self.assertTrue(all(c["validation"]["status"] == "passed" for c in self.report["cases"]))
        self.assertEqual(self.report["view_mode"], "historical_replay")
        self.assertEqual(self.report["data_origin"], "real_execution")
        self.assertEqual(len(self.report["diagnosis"]["comparisons"]), 6)

    def test_zero_page_never_claims_physical_confirmation(self):
        findings = [f for f in self.report["diagnosis"]["findings"] if f["rule"] == "anonymous_zero_page"]
        self.assertEqual(len(findings), 6)
        self.assertTrue(all(f["confidence"] == "probable" for f in findings))

    def test_synthetic_fallback_does_not_invent_a_cause(self):
        report = copy.deepcopy(self.report)
        report["data_origin"] = "synthetic_test"
        case = next(c for c in report["cases"] if c["suite"] == "thp" and c["parameters"]["thp"] == "on")
        case["data"]["samples"][-1]["huge_kib"] = 0
        report["cases"] = [case]
        findings = diagnose(report)["findings"]
        self.assertTrue(any(f["rule"] == "thp_not_observed" and f["confidence"] == "insufficient_evidence" for f in findings))
        self.assertFalse(any(f["confidence"] == "confirmed" for f in findings))

    def test_synthetic_mismatched_controls_are_not_paired(self):
        report = copy.deepcopy(self.report)
        report["data_origin"] = "synthetic_test"
        for c in report["cases"]:
            if c["suite"] == "thp" and c["parameters"]["thp"] == "on":
                c["data"]["condition"]["stride_bytes"] *= 2
        self.assertEqual(diagnose(report)["comparisons"], [])

    def test_synthetic_corruption_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            dest = Path(tmp) / "copy"
            shutil.copytree(FIXTURE, dest)
            p = dest / "proj5-memory-pilot/results/16MiB-run1.jsonl"
            p.write_text(p.read_text().replace('"rss_kib":0', '"rss_kib":4', 1))
            report = load_run(dest)
            self.assertEqual(report["integrity"]["status"], "failed")
            self.assertTrue(report["integrity"]["errors"])
            self.assertIsNone(report["cases"][0]["data"])
            self.assertEqual(report["cases"][0]["integrity"], "failed")
            self.assertTrue(all(c["data"] and c["validation"]["status"] == "passed" for c in report["cases"][1:]))
            self.assertTrue(any(f["confidence"] == "confirmed" for f in report["diagnosis"]["findings"]))

    def test_synthetic_missing_sample_is_not_zero(self):
        c = self.report["cases"][0]
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            path = Path(tmp) / "missing.jsonl"
            lines = (FIXTURE / c["artifacts"]["jsonl"]).read_text().splitlines()
            path.write_text('\n'.join(lines[:2] + lines[3:]))
            with self.assertRaisesRegex(ValueError, "snapshots"):
                parse_case(path, FIXTURE / c["artifacts"]["smaps"], c["suite"], c["parameters"])

    def test_source_mismatch_prevents_diagnosis(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            dest = Path(tmp) / "copy"
            shutil.copytree(FIXTURE, dest)
            (dest / "proj5-memory-pilot/memory_probe.c").write_text("synthetic tamper")
            report = load_run(dest)
            self.assertEqual(report["integrity"]["status"], "failed")
            self.assertTrue(all(f["confidence"] == "insufficient_evidence" for f in report["diagnosis"]["findings"]))

    def test_paths_cannot_escape_run(self):
        for name in ("../secret", str(ROOT / ".gitignore")):
            with self.assertRaises(ValueError):
                safe_child(FIXTURE, name)

    def test_export_preserves_provenance_and_escapes_html(self):
        report = copy.deepcopy(self.report)
        report["environment"]["kernel"] = "<script>alert(1)</script>"
        html = html_text(report)
        self.assertNotIn("<script>", html)
        self.assertIn("历史回放", html)
        self.assertIn("legacy_partial", html)
        self.assertIn("data_origin", csv_text(report).splitlines()[0])
        self.assertEqual(len(csv_text(report).splitlines()), 73)

    def test_failed_process_keeps_partial_bytes(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            stdout, stderr = Path(tmp) / "out", Path(tmp) / "err"
            result = execute([sys.executable, "-c", "import sys; print('partial',flush=True); sys.exit(7)"], stdout, stderr, 5)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["exit_code"], 7)
            self.assertIn("partial", stdout.read_text())

    def test_timeout_keeps_partial_bytes(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            stdout, stderr = Path(tmp) / "out", Path(tmp) / "err"
            result = execute([sys.executable, "-c", "import time; print('started',flush=True); time.sleep(10)"], stdout, stderr, .5)
            self.assertEqual(result["status"], "timeout")
            self.assertIn("started", stdout.read_text())

if __name__ == "__main__":
    unittest.main()
