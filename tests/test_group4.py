"""Recorded WSL events and deliberate mutations; these tests are not new lab runs."""
import copy,csv,io,json
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'work'))
from vmobserve import group4
from vmobserve.runner import parser,plan_cases,source_files
from vmobserve.server import Workbench
from vmobserve.export import csv_text

class Group4Tests(unittest.TestCase):
    def fixture(self,suite,mode):
        all_cases=json.loads((Path(__file__).parent/'fixtures/group4/events.json').read_text(encoding='utf-8'))['cases']
        f=next(c for c in all_cases if c['suite']==suite and c['parameters']['mode']==mode)
        return group4.parse(f['events'],f['kernel'],suite,f['parameters'])

    def test_real_recordings_reconstruct_all_modes(self):
        for suite,modes in group4.MODES.items():
            for mode in modes:
                with self.subTest(suite=suite,mode=mode):
                    self.assertEqual(group4.validate(suite,self.fixture(suite,mode))['status'],'passed')

    def test_exec_identity_and_exit_cannot_be_substituted(self):
        d=self.fixture('g4-fork','normal')
        next(r for r in d['samples'] if r['event']=='after_exec')['pid']+=100
        self.assertEqual(group4.validate('g4-fork',d)['status'],'failed')
        d=self.fixture('g4-fork','normal');d['summary']['exit_code']=0
        self.assertEqual(group4.validate('g4-fork',d)['status'],'failed')

    def test_mutex_counter_and_kernel_threads_are_checked(self):
        d=self.fixture('g4-pthread','mutex');d['summary']['value']-=1
        self.assertEqual(group4.validate('g4-pthread',d)['status'],'failed')
        d=self.fixture('g4-pthread','mutex');workers=[r for r in d['samples'] if r['event']=='worker_start'];workers[1]['tid']=workers[0]['tid']
        self.assertEqual(group4.validate('g4-pthread',d)['status'],'failed')
        # Unsafe results are collected as observations, never certified as a safe counter.
        d=self.fixture('g4-pthread','unsafe');d['summary']['value']=2000000
        self.assertEqual(group4.validate('g4-pthread',d)['status'],'passed')

    def test_uthreads_need_own_stacks_and_real_rotation(self):
        d=self.fixture('g4-uthread','round-robin');created=[r for r in d['samples'] if r['event']=='created'];created[1]['stack_base']=created[0]['stack_base']
        self.assertEqual(group4.validate('g4-uthread',d)['status'],'failed')
        d=self.fixture('g4-uthread','round-robin');next(r for r in d['samples'] if r['event']=='step')['worker']=2
        self.assertEqual(group4.validate('g4-uthread',d)['status'],'failed')

    def test_eof_epipe_and_sigpipe_are_not_interchangeable(self):
        d=self.fixture('g4-pipe','eagain');next(r for r in d['samples'] if r['event']=='empty_with_writer')['read_bytes']=0
        self.assertEqual(group4.validate('g4-pipe',d)['status'],'failed')
        d=self.fixture('g4-pipe','sigpipe');d['summary']['signal']=0
        self.assertEqual(group4.validate('g4-pipe',d)['status'],'failed')

    def test_final_total_alone_does_not_certify_transfer_ledger(self):
        d=self.fixture('g4-bank','transfer');next(r for r in d['samples'] if r['event']=='transferred')['from_balance']+=1
        self.assertEqual(group4.validate('g4-bank',d)['status'],'failed')
        d=self.fixture('g4-bank','transfer');r=next(r for r in d['samples'] if r['event']=='transferred');r['first_lock'],r['second_lock']=r['second_lock'],r['first_lock']
        self.assertEqual(group4.validate('g4-bank',d)['status'],'failed')

    def test_selected_lab_and_child_source_reach_public_entrypoints(self):
        all_cases=plan_cases(parser().parse_args(['--suite','group4']))
        self.assertEqual(len(all_cases),42)
        for task,count in [('4.1',6),('4.2',6),('4.3',6),('4.4',24)]:
            args=parser().parse_args(['--suite','group4','--group4-task',task])
            self.assertEqual(len(plan_cases(args)),count)
            command=Workbench('local').command(group4=True,group4_task=task)
            self.assertEqual(command[command.index('--group4-task')+1],task)
        self.assertTrue(any(p.name=='child_prog.c' for p in source_files()))
        self.assertEqual(len(plan_cases(parser().parse_args([]))),33)

    def test_event_csv_keeps_thread_ids_and_no_fake_memory_metrics(self):
        d=self.fixture('g4-pthread','mutex')
        c={'id':'pthread-fixture','suite':'g4-pthread','status':'completed','integrity':'verified',
           'validation':group4.validate('g4-pthread',d),'data':d}
        r={'run_id':'fixture','data_origin':'fixture','view_mode':'test','status':'completed',
           'integrity':{'status':'verified'},'cases':[c]}
        rows=list(csv.DictReader(io.StringIO(csv_text(r))))
        self.assertTrue(all(row['pid'] and row['tid'] for row in rows))
        self.assertTrue(all(row['rss_kib']=='' for row in rows))
        self.assertEqual(rows[-1]['value'],'2000000')

if __name__=='__main__':unittest.main()
