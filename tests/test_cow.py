"""COW metadata integrity, old evidence compatibility, and parameter transport.

Modified probe records below are explicitly synthetic test inputs; they never
enter the workbench's real-run directories.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.evidence import parse_case, validate_measurements
from vmobserve.runner import parser, plan_cases
from vmobserve.server import Workbench

FIXTURE = ROOT / "tests/fixtures/legacy-run/proj5-memory-pilot/results"
TEST_TMP = ROOT / "output/test-tmp"
TEST_TMP.mkdir(parents=True, exist_ok=True)


class CowTests(unittest.TestCase):
    def synthetic_probe(self, path, mutate=None):
        records = [json.loads(s) for s in (FIXTURE / "16MiB-run1.jsonl").read_text().splitlines()]
        env = next(r for r in records if r["kind"] == "environment")
        env.update(probe_version=2, cow_fraction="1/4", cow_stride_pages=4, total_pages=4096, cow_pages=1024)
        values = next(r for r in records if r["kind"] == "isolation")
        values.update(cow_written_pages=1024, parent_mismatches=0, child_mismatches=0)
        for r in records:
            if r.get("phase") == "child_write_quarter":
                r["phase"] = "child_write"
        if mutate:
            mutate(env, values)
        raw, smaps = path / "synthetic.jsonl", path / "synthetic.smaps.txt"
        raw.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
        smaps.write_text((FIXTURE / "16MiB-run1.smaps.txt").read_text().replace("child_write_quarter", "child_write"), encoding="utf-8")
        return raw, smaps

    def test_old_and_new_quarter_records_have_explicit_distinct_origins(self):
        old = parse_case(FIXTURE / "16MiB-run1.jsonl", FIXTURE / "16MiB-run1.smaps.txt", "baseline", {"mib": 16})
        self.assertEqual(old["cow"]["condition_origin"], "legacy_fixed_quarter")
        self.assertEqual(old["cow"]["phase"], "child_write_quarter")
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            raw, smaps = self.synthetic_probe(Path(tmp))
            new = parse_case(raw, smaps, "baseline", {"mib": 16, "cow_fraction": "1/4"})
        self.assertEqual(new["cow"]["condition_origin"], "recorded")
        self.assertEqual(new["cow"]["phase"], "child_write")
        self.assertEqual(new["cow"]["written_pages"], 1024)
        self.assertEqual(validate_measurements("baseline", new)["status"], "passed")

    def test_plan_or_record_cannot_silently_claim_a_different_fraction(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            raw, smaps = self.synthetic_probe(Path(tmp))
            with self.assertRaisesRegex(ValueError, "execution plan"):
                parse_case(raw, smaps, "baseline", {"mib": 16, "cow_fraction": "1/8"})
            for field, value in (("cow_pages", 512), ("cow_stride_pages", 8), ("total_pages", 2048)):
                raw, smaps = self.synthetic_probe(Path(tmp), lambda e, v: e.update({field: value}))
                with self.assertRaises(ValueError):
                    parse_case(raw, smaps, "baseline", {"mib": 16, "cow_fraction": "1/4"})
            raw, smaps = self.synthetic_probe(Path(tmp), lambda e, v: v.update(cow_written_pages=0))
            with self.assertRaisesRegex(ValueError, "actual COW writes"):
                parse_case(raw, smaps, "baseline", {"mib": 16, "cow_fraction": "1/4"})
        with self.assertRaisesRegex(ValueError, "explicit probe metadata"):
            parse_case(FIXTURE / "16MiB-run1.jsonl", FIXTURE / "16MiB-run1.smaps.txt", "baseline", {"mib": 16, "cow_fraction": "0"})

    def test_equal_checksums_do_not_hide_page_value_errors(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as tmp:
            raw, smaps = self.synthetic_probe(Path(tmp), lambda e, v: v.update(child_mismatches=2))
            data = parse_case(raw, smaps, "baseline", {"mib": 16, "cow_fraction": "1/4"})
        validation = validate_measurements("baseline", data)
        self.assertEqual(validation["status"], "failed")
        self.assertTrue(any(c["id"] == "child_page_values" and c["status"] == "deviation" for c in validation["checks"]))

    def test_defaults_and_matrix_are_distinct_and_bounded(self):
        defaults = plan_cases(parser().parse_args([]))
        self.assertEqual(len(defaults), 33)
        self.assertTrue(all(c["arguments"] == [str(c["parameters"]["mib"]), "1/4"] for c in defaults if c["suite"] == "baseline"))
        matrix = plan_cases(parser().parse_args(["--suite", "baseline", "--cow-fraction", "all"]))
        self.assertEqual(len(matrix), 30)
        self.assertEqual(len({c["id"] for c in matrix}), 30)
        for mib in (16, 64):
            for repeat in (1, 2, 3):
                self.assertEqual({c["parameters"]["cow_fraction"] for c in matrix if c["parameters"]["mib"] == mib and c["parameters"]["repeat"] == repeat}, {"0", "1/8", "1/4", "1/2", "1"})

    def test_web_command_transmits_fraction_and_rejects_invalid_values(self):
        app = Workbench("local")
        self.assertEqual(app.command(cow_fraction="1/8")[-4:], ["--suite", "baseline", "--cow-fraction", "1/8"])
        self.assertEqual(app.command(cow_fraction="all")[-1], "all")
        for bad in ("1/3", "../", "1;echo", None):
            with self.assertRaises(ValueError):
                app.start("cow", cow_fraction=bad)
        self.assertIsNone(app.job)


if __name__ == "__main__":
    unittest.main()
