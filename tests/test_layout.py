"""Synthetic address-space cases exercise association and rejection, not Linux behavior."""
import copy
import csv
import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
from vmobserve.layout import SYMBOLS, parse_layout, validate_layout, layout_findings
from vmobserve.export import csv_text, html_text
from vmobserve.runner import parser, plan_cases
from vmobserve.server import experiment_args, Workbench


class LayoutTests(unittest.TestCase):
    def evidence(self):
        records = [dict(kind="condition", probe_version=1, pid=123, page_bytes=4096,
                        method="dl_iterate_phdr+smaps", executable="/app")]
        records += [dict(kind="point", symbol=name, address=address) for name, address in zip(
            SYMBOLS, ("1100", "2100", "4100", "5100", "8100", "d100", "a100"))]
        for index, vaddr, offset, filesz, memsz, flags in (
            (0,"1000",0,4096,4096,"r-x"), (1,"2000",4096,4096,4096,"r--"),
            (2,"3000",8192,8192,12288,"rw-")):
            records.append(dict(kind="segment", object="/app", is_main=True, index=index,
                                load_bias="0", vaddr=vaddr, offset=offset, filesz=filesz, memsz=memsz, flags=flags))
        records.append(dict(kind="segment", object="/lib/libc.so.6", is_main=False, index=0,
                            load_bias="a000", vaddr="0", offset=0, filesz=4096, memsz=4096, flags="r-x"))
        headers = ["1000-2000 r-xp 00000000 00:00 1 /app", "2000-3000 r--p 00001000 00:00 1 /app",
                   "3000-4000 r--p 00002000 00:00 1 /app", "4000-5000 rw-p 00003000 00:00 1 /app",
                   "5000-6000 rw-p 00000000 00:00 0", "8000-9000 rw-p 00000000 00:00 0 [heap]",
                   "a000-b000 r-xp 00000000 00:00 2 /lib/libc.so.6", "d000-e000 rw-p 00000000 00:00 0 [stack]"]
        metrics = "\nSize: 4 kB\nRss: 4 kB\nPss: 4 kB\nPrivate_Dirty: 0 kB\nShared_Dirty: 0 kB\nAnonHugePages: 0 kB\nSwap: 0 kB\n"
        raw = "BEGIN phase=layout role=parent pid=123\n" + "".join(h + metrics for h in headers) + "END\n"
        return records, raw

    def test_split_segment_and_anonymous_bss_tail(self):
        records, raw = self.evidence()
        data = parse_layout(records, raw, {"repeat": 1})
        self.assertEqual(validate_layout(data)["status"], "passed")
        self.assertEqual(len(data["segments"][2]["mappings"]), 3)
        bss = next(s for s in data["samples"] if s["symbol"] == "uninitialized")
        self.assertEqual((bss["pathname"], bss["elf_object"], bss["elf_segment_index"]), ("", "/app", 2))

    def test_incomplete_or_contradictory_evidence_rejected(self):
        records, raw = self.evidence()
        for broken_raw in (raw.replace("pid=123", "pid=124"), raw.replace("00003000", "00004000"),
                           raw.replace("Pss: 4 kB\n", "", 1)):
            with self.assertRaises(ValueError):
                parse_layout(records, broken_raw, {})
        for index, field, value in ((1,"address","f000"),(8,"memsz",8192),(0,"probe_version",True)):
            broken = copy.deepcopy(records)
            broken[index][field] = value
            with self.assertRaises(ValueError):
                parse_layout(broken, raw, {})

    def test_permission_deviation_keeps_real_observation(self):
        records, raw = self.evidence()
        data = parse_layout(records, raw.replace("1000-2000 r-xp", "1000-2000 rw-p"), {})
        validation = validate_layout(data)
        self.assertEqual(validation["status"], "deviation")
        case = dict(id="synthetic", data=data, validation=validation, artifacts={"jsonl":"raw", "smaps":"maps"})
        self.assertEqual(layout_findings(case)[-1]["rule"], "layout_permissions")

    def test_exports_preserve_address_scope_without_fake_fault_counts(self):
        records, raw = self.evidence()
        data = parse_layout(records, raw, {})
        case = dict(id="synthetic", suite="layout", status="completed", integrity="synthetic_test",
                    data=data, validation=validate_layout(data), artifacts={"jsonl":"raw", "smaps":"maps"})
        report = dict(run_id="synthetic", data_origin="synthetic_test", view_mode="test", status="completed",
                      integrity={"status":"synthetic_test"}, cases=[case], replayed_at="test",
                      diagnosis={"findings":layout_findings(case),"references":[]})
        rows = list(csv.DictReader(io.StringIO(csv_text(report))))
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[0]["scope"], "address_containing_vma")
        self.assertEqual(rows[0]["action_minor"], "")
        self.assertIn("程序地址与映射", html_text(report))
        self.assertIn("加载后的 ELF PT_LOAD", html_text(report))

    def test_public_entry_points_include_layout(self):
        plan = plan_cases(parser().parse_args(["--suite", "layout"]))
        self.assertEqual([c["id"] for c in plan], ["layout-1", "layout-2", "layout-3"])
        self.assertEqual(experiment_args("layout")[-2:], ["--suite", "layout"])


if __name__ == "__main__":
    unittest.main()
