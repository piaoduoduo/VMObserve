"""Synthetic allocator evidence exercises scope and rejection paths only."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
from vmobserve.allocator import PHASES, parse_allocator, validate_allocator
from vmobserve.server import Workbench
from vmobserve.runner import parser, plan_cases


class AllocatorTests(unittest.TestCase):
    def evidence(self):
        # A 1 KiB block inside a larger 8 KiB heap VMA, retained after free.
        condition = dict(kind="condition", probe_version=1, allocator="malloc", requested_kib=1,
                         page_bytes=4096, positions=1, thp_policy="system_default",
                         allocation_sequence="fresh_process_single_block")
        samples, raw = [], []
        body = ("1000-3000 rw-p 00000000 00:00 0 [heap]\n"
                "Size: 8 kB\nRss: 4 kB\nPss: 4 kB\nPrivate_Dirty: 4 kB\n"
                "Shared_Dirty: 0 kB\nAnonHugePages: 0 kB\nSwap: 0 kB")
        for i, phase in enumerate(PHASES):
            samples.append(dict(kind="sample", phase=phase, role="parent", pid=123,
                                address="0" if i == 0 else "1010", program_break="3000",
                                written_positions=1 if 2 <= i <= 4 else 0,
                                action_minor=0, action_major=0))
            raw.append(f"BEGIN phase={phase} role=parent pid=123\n{body}\nEND\n")
        return [condition, *samples, dict(kind="values", checked_positions=1, mismatches=0, ok=True)], "".join(raw)

    def test_whole_heap_scope_retained_after_free(self):
        records, raw = self.evidence()
        data = parse_allocator(records, raw, {"requested_kib": 1})
        self.assertEqual(data["samples"][1]["size_kib"], 8)
        self.assertEqual(data["samples"][1]["requested_kib"], 1)
        self.assertEqual(data["samples"][-1]["scope"], "overlapping_vmas")
        self.assertTrue(data["samples"][-1]["mapping_present"])
        self.assertEqual(validate_allocator(data)["status"], "passed")

    def test_metadata_counts_and_raw_fields_required(self):
        records, raw = self.evidence()
        for index, field, value in ((0, "requested_kib", 256), (0, "probe_version", True),
                                    (2, "address", "0"), (3, "written_positions", 0)):
            broken = copy.deepcopy(records)
            broken[index][field] = value
            with self.assertRaises(ValueError):
                parse_allocator(broken, raw, {"requested_kib": 1})
        with self.assertRaises(ValueError):
            parse_allocator(records, raw.replace("Pss: 4 kB\n", "", 1), {"requested_kib": 1})
        with self.assertRaises(ValueError):
            parse_allocator(records[:-2] + records[-1:], raw, {"requested_kib": 1})

    def test_value_errors_cannot_confirm_success(self):
        records, raw = self.evidence()
        records[-1]["mismatches"] = 1
        data = parse_allocator(records, raw, {"requested_kib": 1})
        self.assertEqual(validate_allocator(data)["status"], "failed")

    def test_course_runs_through_public_entry_points(self):
        plan = plan_cases(parser().parse_args(["--suite", "course"]))
        self.assertEqual(len(plan), 12)
        self.assertEqual({c["parameters"]["requested_kib"] for c in plan}, {1, 256, 1024, 16384})
        self.assertEqual(Workbench("local").command(course=True)[-2:], ["--suite", "course"])


if __name__ == "__main__":
    unittest.main()
