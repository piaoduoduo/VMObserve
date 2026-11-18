"""Synthetic negative-path checks; these are not real Linux experiment results."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
from vmobserve.thp_policy import parse_policy, policy_comparisons
from vmobserve.runner import parser, plan_cases
from vmobserve.server import experiment_args, Workbench
from vmobserve.diagnosis import diagnose
import test_allocator
from vmobserve.allocator import parse_allocator, validate_allocator


class ControlsTests(unittest.TestCase):
    def test_process_readback_requires_matching_kernel_status(self):
        condition = dict(process_thp="disable", process_thp_disabled=1, madvise_result=0)
        raw = "BEGIN_PROCESS pid=123\nPid:\t123\nTHP_enabled:\t0\nEND_PROCESS\n"
        parse_policy(condition, raw, {"process_thp": "disable"}, 123)
        self.assertEqual(condition["status_thp_enabled"], 0)
        for broken in ("", raw.replace("THP_enabled:\t0", "THP_enabled:\t1"), raw.replace("Pid:\t123", "Pid:\t124")):
            with self.assertRaises(ValueError):
                parse_policy(condition, broken, {"process_thp": "disable"}, 123)
        with self.assertRaises(ValueError):
            parse_policy({}, raw, {"process_thp": "disable"}, 123)

    def test_legacy_cannot_gain_policy_confirmation(self):
        condition = {}
        parse_policy(condition, "", {}, 123)
        self.assertEqual(condition, {})

    def pair(self):
        cases = []
        for policy in ("allow", "disable"):
            c = dict(pattern="sparse", page_bytes=4096, huge_bytes=2097152, region_bytes=33554432,
                     stride_bytes=2097152, writes=16, huge_aligned=True, madvise_result=0,
                     process_thp_disabled=int(policy == "disable"), status_thp_enabled=int(policy == "allow"))
            sample = dict(swap_kib=0, action_major=0, rss_kib=32768 if policy == "allow" else 64,
                          huge_kib=32768 if policy == "allow" else 0)
            cases.append(dict(id=policy, suite="thp", parameters=dict(pattern="sparse", thp="on", repeat=1, process_thp=policy),
                              validation=dict(status="passed"), data=dict(condition=c, samples=[sample])))
        return cases

    def test_control_requires_positive_allowed_group_and_equal_conditions(self):
        cases = self.pair()
        self.assertTrue(policy_comparisons(cases)[0]["control_valid"])
        cases[0]["data"]["samples"][0]["huge_kib"] = 0
        self.assertFalse(policy_comparisons(cases)[0]["control_valid"])
        cases[0]["data"]["condition"]["stride_bytes"] *= 2
        self.assertEqual(policy_comparisons(cases), [])

    def test_control_missing_proof_never_confirms(self):
        cases = self.pair()
        del cases[0]["data"]["condition"]["status_thp_enabled"]
        self.assertFalse(policy_comparisons(cases)[0]["control_valid"])
        self.assertEqual(policy_comparisons(cases[:1]), [])

    def test_student_counts_are_failure_not_successful_standard_action(self):
        records, raw = test_allocator.AllocatorTests().evidence()
        records[0].update(probe_version=2, course_code="student")
        for sample in records[3:6]:
            sample["written_positions"] = 0
        # Even an accidentally matching final byte cannot hide an unfinished loop.
        data = parse_allocator(records, raw, {"requested_kib": 1, "course_code": "student"})
        validation = validate_allocator(data)
        self.assertEqual(validation["status"], "failed")
        case = dict(id="student", suite="course", status="completed", integrity="verified", data=data,
                    validation=validation, artifacts={"jsonl": "raw.jsonl"})
        findings = diagnose(dict(cases=[case]))["findings"]
        self.assertEqual([f["rule"] for f in findings], ["course_task_incomplete"])
        with self.assertRaises(ValueError):
            parse_allocator(records, raw, {"requested_kib": 1, "course_code": "reference"})

    def test_public_plans_and_commands(self):
        plan = plan_cases(parser().parse_args(["--suite", "thp", "--thp", "on", "--thp-process", "pair"]))
        self.assertEqual(len(plan), 12)
        self.assertEqual(len({c["id"] for c in plan}), 12)
        self.assertTrue(all(c["parameters"]["thp"] == "on" for c in plan))
        self.assertEqual([c["parameters"]["process_thp"] for c in plan[:4]], ["allow", "disable", "disable", "allow"])
        app = Workbench("local")
        self.assertEqual(experiment_args("student")[-4:], ["--suite", "course", "--course-code", "student"])
        self.assertIn("--thp-process", experiment_args("policy"))
        self.assertEqual(app.command(experiment_args("policy-recheck"), Path("parent"))[-2:], ["--recheck-kind", "process"])


if __name__ == "__main__":
    unittest.main()
