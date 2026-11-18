"""Regression checks use temporary copies and synthetic inputs, not new Linux runs."""
import copy
import csv
import io
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.common import digest, read_json, write_json
from vmobserve.diagnosis import diagnose
from vmobserve.evidence import validate_measurements
from vmobserve.export import csv_text
from vmobserve.replay import legacy_report, load_run
from vmobserve.server import Workbench
from vmobserve.runner import compare_thp_environment

FIXTURE = ROOT / "tests/fixtures/legacy-run"
TEST_TMP = ROOT / "output/test-tmp"
TEST_TMP.mkdir(parents=True, exist_ok=True)


def v1_copy(root):
    shutil.copytree(FIXTURE, root)
    report = legacy_report(root, read_json(root / "report.json"))
    report.pop("original_schema")
    report["data_origin"] = "synthetic_test"
    for rel in report["sources"]:
        target = root / "source" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / rel, target)
    report["artifacts"] = {rel: digest(root / rel)
                           for case in report["cases"] for rel in case["artifacts"].values()}
    write_json(root / "environment.json", report["environment"])
    report["artifacts"]["environment.json"] = digest(root / "environment.json")
    write_json(root / "report.json", report)
    return report


class ReviewRegressions(unittest.TestCase):
    def test_home_example_is_replayable_without_private_run_directories(self):
        app = Workbench("local", {"example": ROOT / "examples"})
        item, = [r for r in app.catalog() if r["suites"] == ["sequence"]]
        report = load_run(app.directory(item["id"]))
        self.assertEqual(report["integrity"]["status"], "verified")
        self.assertEqual(report["data_origin"], "real_execution")
        self.assertEqual(len(report["cases"]), 3)
        sample = next(s for s in report["cases"][0]["data"]["samples"] if s["phase"] == "alloc_1MiB")
        self.assertEqual((sample["related_vma_count"], sample["related_rss_kib"]), (2, 16))

    def test_environment_summary_cannot_override_the_original(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            root = Path(tmp) / "copy"
            report = v1_copy(root)
            original = read_json(root / "environment.json")
            report["environment"]["kernel"] = "QA-only"
            write_json(root / "report.json", report)
            loaded = load_run(root)
            self.assertEqual(loaded["environment"], original)
            self.assertEqual(loaded["integrity"]["status"], "failed")
            self.assertTrue(all(c["data"] is None for c in loaded["cases"]))
            self.assertTrue(Workbench("local", {"test": Path(tmp)}).catalog()[0]["environment_issue"])

    def test_packaged_systems_replay_distinguishes_eagain_from_eof(self):
        report = load_run(ROOT / "examples/20261118T085249.704120Z")
        self.assertEqual(report["integrity"]["status"], "verified")
        self.assertEqual(len(report["cases"]), 9)
        self.assertTrue(all(c["validation"]["status"] == "passed" for c in report["cases"]))
        fifo = next(c for c in report["cases"] if c["parameters"]["lab"] == "7.2")
        changed = copy.deepcopy(fifo["data"])
        empty = next(row for row in changed["samples"] if row["observed"] == "EAGAIN")
        empty["observed"] = 0
        self.assertEqual(validate_measurements("io", changed)["status"], "failed")

    def test_thp_recheck_compares_conditions_not_timestamps(self):
        root = ROOT / "examples/20261116T090129.522833Z/environment.json"
        env = read_json(root)
        self.assertEqual(compare_thp_environment(env, dict(env, captured_at="later"))["status"], "matched_conditions")
        self.assertEqual(compare_thp_environment(env, dict(env, kernel="other"))["status"], "cross_environment")
        self.assertEqual(compare_thp_environment(env, dict(env, thp_enabled=None))["status"], "unknown")

    @classmethod
    def setUpClass(cls):
        cls.report = load_run(FIXTURE)

    def test_case_corruption_is_local_in_legacy_and_v1_regardless_of_order(self):
        for legacy in (True, False):
            for index in (0, 17):
                with self.subTest(legacy=legacy, index=index), tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
                    root = Path(tmp) / "copy"
                    if legacy:
                        shutil.copytree(FIXTURE, root)
                        saved = self.report
                    else:
                        saved = v1_copy(root)
                    broken = saved["cases"][index]
                    (root / broken["artifacts"]["jsonl"]).write_text("incomplete JSON\n", encoding="utf-8")
                    report = load_run(root)
                    self.assertEqual(report["integrity"]["status"], "failed")
                    self.assertIsNone(report["cases"][index]["data"])
                    self.assertEqual(report["cases"][index]["integrity"], "failed")
                    good = [c for i, c in enumerate(report["cases"]) if i != index]
                    self.assertEqual(len(good), 17)
                    self.assertTrue(all(c["data"] and c["validation"]["status"] == "passed" for c in good))
                    self.assertTrue(all(c["integrity"] == ("legacy_partial" if legacy else "verified") for c in good))
                    self.assertFalse(any(f["confidence"] == "confirmed" and
                                         any(e.get("case_id") == broken["id"] for e in f["evidence"])
                                         for f in report["diagnosis"]["findings"]))

    def test_shared_environment_hash_failure_still_blocks_all_cases(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            root = Path(tmp) / "copy"
            v1_copy(root)
            (root / "environment.json").write_text("{}", encoding="utf-8")
            report = load_run(root)
            self.assertEqual(report["integrity"]["status"], "failed")
            self.assertTrue(all(c["data"] is None and c["integrity"] == "failed" for c in report["cases"]))

    def test_full_thp_title_distinguishes_equal_and_different_fault_counts(self):
        for equal in (True, False):
            with self.subTest(equal=equal):
                report = copy.deepcopy(self.report)
                report["data_origin"] = "synthetic_test"
                report["cases"] = [c for c in report["cases"] if c["suite"] == "thp" and
                                   c["parameters"]["pattern"] == "full" and c["parameters"]["repeat"] == 1]
                off = next(c for c in report["cases"] if c["parameters"]["thp"] == "off")
                on = next(c for c in report["cases"] if c["parameters"]["thp"] == "on")
                if equal:
                    on["data"]["samples"][-1]["action_minor"] = off["data"]["samples"][-1]["action_minor"]
                for case in report["cases"]:
                    case["validation"] = validate_measurements("thp", case["data"])
                finding = next(f for f in diagnose(report)["findings"] if f["rule"] == "thp_full_control")
                self.assertEqual(finding["confidence"], "confirmed")
                self.assertIn("计数相同" if equal else "计数差异", finding["title"])

    def test_job_exit_three_requires_matching_new_report(self):
        for code, run_status, expected in ((3, "completed_with_deviations", "completed_with_deviations"),
                                           (3, "failed", "failed"), (3, None, "failed"),
                                           (7, "completed_with_deviations", "failed")):
            with self.subTest(code=code, run_status=run_status), tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
                root = Path(tmp)
                app = Workbench("local", {"local": root})
                app.job = {"status": "running"}
                (root / "unrelated").mkdir()
                write_json(root / "unrelated/report.json", {"status": "completed_with_deviations"})
                if run_status:
                    (root / "new").mkdir()
                    write_json(root / "new/report.json", {"status": run_status})
                    (root / "stdout.log").write_text(f"RUN_DIRECTORY={root / 'new'}\n", encoding="utf-8")
                result = {"status": "failed", "exit_code": code,
                          "error": {"code": "process_exit", "message": f"exit status {code}"}}
                with patch("vmobserve.server.execute", return_value=result):
                    app._worker(root, [])
                self.assertEqual(app.job["new_run_ids"], ["local--new"] if run_status else [])
                self.assertEqual(app.job["status"], expected)
                self.assertEqual(app.job["exit_code"], code)
                self.assertEqual(app.job["error"] is None, expected == "completed_with_deviations")
                self.assertEqual(read_json(Path(tmp) / "job.json")["status"], expected)

    def test_csv_keeps_failed_validation_and_both_integrity_levels(self):
        report = copy.deepcopy(self.report)
        report.update(data_origin="synthetic_test", status="failed", cases=report["cases"][:1])
        report["integrity"]["status"] = "failed"
        report["cases"][0]["validation"]["status"] = "failed"
        rows = list(csv.DictReader(io.StringIO(csv_text(report))))
        self.assertEqual(len(rows), 8)
        for row in rows:
            self.assertEqual(row["run_status"], "failed")
            self.assertEqual(row["case_status"], "completed")
            self.assertEqual(row["validation_status"], "failed")
            self.assertEqual(row["run_integrity"], "failed")
            self.assertEqual(row["case_integrity"], "legacy_partial")

    def test_csv_retains_failed_cases_without_inventing_samples(self):
        report = copy.deepcopy(self.report)
        report.update(data_origin="synthetic_test", status="failed", cases=report["cases"][:1])
        case = report["cases"][0]
        case.update(status="timeout", data=None, validation={"status": "insufficient_evidence", "checks": []})
        case.pop("integrity", None)
        rows = list(csv.DictReader(io.StringIO(csv_text(report))))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["case_status"], "timeout")
        self.assertEqual(rows[0]["validation_status"], "insufficient_evidence")
        self.assertEqual(rows[0]["phase"], "")
        self.assertEqual(rows[0]["rss_kib"], "")
        self.assertEqual(rows[0]["case_integrity"], "")


if __name__ == "__main__":
    unittest.main()
