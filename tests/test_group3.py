"""Group-3 acceptance checks: a collected process is not a passed experiment."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from vmobserve.group3 import validate
from vmobserve.runner import parser, plan_cases
from vmobserve.server import Workbench


class Group3Tests(unittest.TestCase):
    def test_full_course_path_is_exposed_without_changing_default_matrix(self):
        self.assertEqual(len(plan_cases(parser().parse_args(['--suite','group3']))),24)
        self.assertEqual(len(plan_cases(parser().parse_args([]))),33)
        app=Workbench('local')
        command=app.command(group3=True)
        self.assertEqual(command[command.index('--suite')+1],'group3')
        self.assertEqual(command[command.index('--timeout')+1],'120')

    def test_combined_course_plan_keeps_group_three_and_intro(self):
        args = parser().parse_args(['--suite', 'course-all'])
        cases = plan_cases(args)
        self.assertEqual(len(cases), 36)
        self.assertEqual(sum(case['suite'] == 'course' for case in cases), 12)
        app = Workbench('local', strace='/tools/strace')
        command = app.command(course_all=True)
        self.assertEqual(command[command.index('--suite') + 1], 'course-all')
        self.assertEqual(command[-2:], ['--strace', '/tools/strace'])

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

if __name__=='__main__': unittest.main()
