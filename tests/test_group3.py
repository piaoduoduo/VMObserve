"""Group-3 acceptance checks: a collected process is not a passed experiment."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from vmobserve.group3 import validate
from unittest.mock import patch
from vmobserve.runner import check_collection, parser, plan_cases
from vmobserve.server import experiment_args, Workbench


class Group3Tests(unittest.TestCase):
    def test_full_course_path_is_exposed_without_changing_default_matrix(self):
        self.assertEqual(len(plan_cases(parser().parse_args(['--suite','group3']))),24)
        self.assertEqual(len(plan_cases(parser().parse_args([]))),33)
        app=Workbench('local')
        command=experiment_args("group3")
        self.assertEqual(command[command.index('--suite')+1],'group3')
        self.assertEqual(command[command.index('--timeout')+1],'120')

    def test_preflight_checks_only_tools_for_the_planned_suite(self):
        env = {"system": "Linux", "kernel": "6.6", "distribution": {"ID": "ubuntu"}, "pmd_size": "2097152"}
        with patch("vmobserve.runner.environment", return_value=env), \
                patch("vmobserve.runner.read_optional", return_value="smaps"), \
                patch("vmobserve.runner.shutil.which", side_effect=lambda name: None if name == "strace" else "/usr/bin/" + name):
            sequence = check_collection(parser().parse_args(["--suite", "sequence", "--check-tools"]))
            self.assertEqual(sequence["missing_tools"], ["strace"])
            self.assertEqual(sequence["status"], "blocked")
            demand = check_collection(parser().parse_args(["--suite", "demand512-thp", "--check-tools"]))
            self.assertEqual(demand["status"], "ready")
            self.assertNotIn("strace", demand["tools"])
            group3 = check_collection(parser().parse_args(["--suite", "group3", "--check-tools"]))
            self.assertEqual(set(group3["tools"]), {"gcc", "strace", "file", "ldd", "readelf"})
            io = check_collection(parser().parse_args(["--suite", "systems", "--lab", "6.1", "--check-tools"]))
            self.assertEqual(io["tools"], {})
            os_check = check_collection(parser().parse_args(["--suite", "sequence", "--require-openeuler", "--check-tools"]))
            self.assertTrue(any("openEuler" in issue for issue in os_check["issues"]))

    def test_overflow_requires_sigsegv_and_normal_return_is_distinct(self):
        data={'condition':{'mode':'overflow'},'samples':[{'size_kib':132},{'size_kib':480}],
              'outcome':{'signal':11,'exit_code':-1,'minor':130},'returned':[]}
        self.assertEqual(validate('stack',data)['status'],'passed')
        for field,value in (('signal',0),('signal',9),('exit_code',0)):
            bad=copy.deepcopy(data); bad['outcome'][field]=value
            self.assertEqual(validate('stack',bad)['status'],'failed')
        bad=copy.deepcopy(data); bad['returned']=[{'checksum':1}]
        self.assertEqual(validate('stack',bad)['status'],'failed')

    def test_demand_must_validate_written_values_and_resident_growth(self):
        data={'samples':[{'rss_kib':n} for n in (0,4,131072,262144,524288,0)],
              'values':{'kind':'values','checked':131072,'mismatches':0}}
        self.assertEqual(validate('demand512',data)['status'],'passed')
        bad=copy.deepcopy(data); bad['values']['mismatches']=1
        self.assertEqual(validate('demand512',bad)['status'],'failed')
        bad=copy.deepcopy(data); bad['samples'][4]['rss_kib']=4
        self.assertEqual(validate('demand512',bad)['status'],'failed')

    def test_demand_thp_pairs_alternate_order_and_use_same_suite(self):
        args = parser().parse_args(experiment_args("demand512-thp"))
        cases = plan_cases(args)
        self.assertEqual([(case["parameters"]["repeat"], case["arguments"][0]) for case in cases],
                         [(1, "off"), (1, "on"), (2, "on"), (2, "off"), (3, "off"), (3, "on")])
        self.assertTrue(all(case["suite"] == "demand512" for case in cases))

    def test_process_demand_mode_persists_control_condition(self):
        args = parser().parse_args(experiment_args("demand512-thp-disable"))
        cases = plan_cases(args)
        self.assertTrue(all(case["parameters"]["process_thp"] == "disable" for case in cases))
        self.assertEqual(cases[1]["arguments"], ["on", "disable"])

    def test_demand_thp_checks_advice_separately_from_huge_page_observation(self):
        data = {
            "samples": [{"rss_kib": n, "huge_kib": 0, "vm_flags": ["hg"],
                         "mapping_present": 0 < i < 5}
                        for i, n in enumerate((0, 0, 131072, 262144, 524288, 0))],
            "values": {"kind": "values", "checked": 131072, "mismatches": 0},
            "policy": {"policy": "on", "result": 0},
        }
        self.assertEqual(validate("demand512", data)["status"], "passed")
        blocked = copy.deepcopy(data)
        blocked["condition"] = {"process_thp": "disable", "process_thp_disabled": 1}
        self.assertEqual(validate("demand512", blocked)["status"], "passed")
        blocked["condition"]["process_thp_disabled"] = 0
        self.assertEqual(validate("demand512", blocked)["status"], "failed")
        for field, value in (("result", -1), ("policy", "off")):
            failed = copy.deepcopy(data)
            failed["policy"][field] = value
            self.assertEqual(validate("demand512", failed)["status"], "failed")
        data["policy"]["policy"] = "off"
        for sample in data["samples"][1:5]:
            sample["vm_flags"] = ["nh"]
        self.assertEqual(validate("demand512", data)["status"], "passed")
        data["samples"][2]["huge_kib"] = 2048
        self.assertEqual(validate("demand512", data)["status"], "failed")

if __name__=='__main__': unittest.main()
