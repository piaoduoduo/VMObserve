"""Synthetic boundary cases for action attribution; no fabricated live results."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.sequence import trace_actions, attach_mappings, describe_allocations, allocation_overview
from vmobserve.smaps import FIELDS
from vmobserve.runner import parser, plan_cases, run
from vmobserve.server import experiment_args, Workbench


def marker(name, edge, legacy=False):
    size = len(f"ACTION {name} {edge}\n") + legacy
    suffix = r'\n\0' if legacy else r'\n'
    return f'write(2, "ACTION {name} {edge}{suffix}", {size}) = {size}'


def trace(legacy=False):
    lines = ['mmap(NULL, 8192, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) = 0x9000']
    for name in ('malloc_1', 'malloc_2', 'malloc_3', 'free_all'):
        lines.append(marker(name, 'BEGIN', legacy))
        if name == 'malloc_2':
            lines.append('mmap(NULL, 8192, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) = 0x2000')
        if name == 'malloc_3':
            lines.append('brk(0x8000) = 0x8000')
        lines.append(marker(name, 'END', legacy))
        lines.append('brk(NULL) = 0x8000')  # Snapshot activity, outside malloc.
    return '\n'.join(lines)


class SequenceTests(unittest.TestCase):
    def test_isolated_plan_and_web_command(self):
        cases = plan_cases(parser().parse_args(['--suite', 'sequence']))
        self.assertEqual([c['id'] for c in cases], ['sequence-1','sequence-2','sequence-3'])
        self.assertEqual(experiment_args("sequence")[-2:], ['--suite','sequence'])

    def test_observer_calls_excluded_and_empty_action_is_valid(self):
        actions = trace_actions(trace())
        self.assertEqual([len(a['events']) for a in actions], [0,1,1,0])
        for action in actions:
            for event in action['events']:
                self.assertEqual(trace().splitlines()[event['line']-1], event['text'])
                self.assertLess(action['begin_line'], event['line'])
                self.assertLess(event['line'], action['end_line'])

    def test_legacy_nul_markers_are_replayable(self):
        self.assertEqual(len(trace_actions(trace(legacy=True))), 4)

    def test_bad_markers_and_unfinished_calls_are_rejected(self):
        good = trace()
        bad = [good.replace(marker('malloc_1','END'), ''),
               good + '\n' + marker('malloc_1','BEGIN'),
               good.replace('malloc_2', 'malloc_4'),
               good.replace('brk(0x8000) = 0x8000', 'brk(0x8000 <unfinished ...>'),
               good.replace(marker('malloc_1','BEGIN'), marker('malloc_1','BEGIN')[:-2]+'0')]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                trace_actions(value)

    def test_block_sizes_do_not_determine_the_mechanism(self):
        actions = trace_actions(trace())
        samples = [{'program_break':'4000'}]*5
        describe_allocations(actions, samples, ['1100','2100','4100'], [100]*3)
        self.assertEqual([a['allocation_source'] for a in actions[:3]], ['no_memory_syscall','new_mmap_range','new_brk_range'])
        actions = trace_actions(trace())
        describe_allocations(actions, samples, ['1100','a100','b100'], [100]*3)
        self.assertEqual([a['allocation_source'] for a in actions[1:3]], ['unresolved','unresolved'])

    def test_merged_vma_is_counted_once_and_freed_blocks_are_not_live(self):
        mapping = dict(start='1000', end='9000', header='test', pathname='')
        mapping.update({k: (32 if k == 'size_kib' else 8) for k in FIELDS})
        samples = [{} for _ in range(5)]
        maps = [[mapping] for _ in samples]
        attach_mappings(samples, maps, ['1100','2100','3100'], [1024]*3)
        overview = allocation_overview(samples[3])
        self.assertEqual([r["blocks"] for r in overview["regions"]], [[1, 2, 3]])
        self.assertEqual((overview["requested_kib"], overview["resident_kib"]), (3, 8))
        self.assertEqual(samples[3]['related_vma_count'], 1)
        self.assertEqual(samples[3]['related_rss_kib'], 8)
        self.assertEqual(len(samples[3]['blocks']), 3)
        self.assertTrue(all(not b['alive'] for b in samples[4]['blocks']))
        broken = copy.deepcopy(maps)
        broken[2] = []
        with self.assertRaisesRegex(ValueError, 'not fully covered'):
            attach_mappings([{} for _ in range(5)], broken, ['1100','2100','3100'], [1024]*3)

    def test_missing_tracer_is_not_reported_as_success(self):
        def execute(command, stdout, stderr, timeout):
            stdout.write_text('synthetic version\n')
            stderr.write_text('synthetic missing strace\n' if command[0]=='strace' else '')
            failed = command[0]=='strace'
            return dict(command=command, status='failed' if failed else 'completed',
                        exit_code=None if failed else 0, error={'code':'spawn_failed'} if failed else None)
        env = dict(system='Linux', kernel='synthetic_test', distribution={}, pmd_size=None)
        with tempfile.TemporaryDirectory() as folder, patch('vmobserve.runner.environment', return_value=env), \
             patch('vmobserve.runner.execute', side_effect=execute), \
             patch('vmobserve.runner.source_files', return_value=[]), \
             patch('vmobserve.runner.read_optional', return_value='synthetic'):
            args = parser().parse_args(['--suite','sequence','--output',folder])
            code, path = run(args)
            report = json.loads((path/'report.json').read_text(encoding='utf-8'))
            self.assertEqual(code, 1)
            self.assertTrue(all(c['status']=='unsupported' and c['data'] is None for c in report['cases']))
            self.assertTrue(all(c['error']['code']=='trace_tool_unavailable' for c in report['cases']))
            self.assertTrue(all(f['confidence']=='insufficient_evidence' for f in report['diagnosis']['findings']))


if __name__ == '__main__':
    unittest.main()
