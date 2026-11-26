"""Synthetic raw words exercise capture errors and decision boundaries. Real runs are archived separately."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
from vmobserve.diagnosis import cow_page_finding, demand_page_finding
from vmobserve.diagnosis import diagnose
from vmobserve.pagemap import attach_pagemaps
from vmobserve.replay import load_run

PAGE = 4096
BASE = 0x70000000
DEMAND_INDICES = (0, 1, 511, 32767, 32768, 65535, 65536, 131071)


def event(sample, indices, written, frames, access, pages, *, status="available"):
    entries = []
    for i, touched, frame in zip(indices, written, frames, strict=True):
        present = frame is not None
        raw = (int(present) << 63) | (1 << 55) | (frame or 0)
        entries.append(dict(page_index=i, vaddr=f"{BASE + i * PAGE:x}", expected_written=touched,
                            raw_hex=f"{raw:016x}", present=present, swapped=False, soft_dirty=True,
                            file_shared=False, pfn=f"{frame:x}" if present and access == "visible" else None))
    return dict(kind="pagemap", **sample, source=f"/proc/{sample['pid']}/pagemap",
                status=status, pfn_access=access, cap_sys_admin=access != "masked", page_bytes=PAGE,
                reason="requires_cap_sys_admin" if access == "masked" else None,
                region_start=f"{BASE:x}", region_pages=pages, sampled_count=len(entries),
                present_count=sum(e["present"] for e in entries), swapped_count=0, entries=entries)


def cow_data(stride=4, masked=False):
    condition = dict(page_bytes=PAGE, pagemap_version=1, mib=16, cow_stride_pages=stride)
    samples, events = [], []
    for phase in ("fork_shared", "child_write"):
        for role, pid in (("parent", 33), ("child", 34)):
            sample = dict(phase=phase, role=role, pid=pid)
            flags = [bool(phase == "child_write" and stride and i % stride == 0) for i in range(8)]
            frames = [0 if masked else 100 + i + (20 if flag and role == "child" else 0)
                      for i, flag in enumerate(flags)]
            samples.append(sample)
            events.append(event(sample, range(8), flags, frames, "masked" if masked else "visible", 4096))
    return condition, samples, events


def attach_cow(condition, samples, events):
    attach_pagemaps(events, samples, condition, "baseline", [BASE] * len(samples))


class PagemapTests(unittest.TestCase):
    def test_zero_page_requires_all_sampled_frames_and_zero_values(self):
        legacy = Path(__file__).resolve().parent / "fixtures/legacy-run"
        case = next(c for c in load_run(legacy)["cases"] if c["suite"] == "baseline")
        case["data"]["value_check"]["initial_read_sum"] = 0
        read = next(s for s in case["data"]["samples"] if s["phase"] == "read_all")
        pm = event({k: read[k] for k in ("phase", "role", "pid")},
                   range(8), [False] * 8, [42] * 8, "visible", 4096)
        read["pagemap"] = pm
        def confidence():
            rules = diagnose({"data_origin": "synthetic_test", "cases": [case]})["findings"]
            return next(f["confidence"] for f in rules if f["rule"] == "anonymous_zero_page")
        self.assertEqual(confidence(), "confirmed")
        pm["entries"][7]["pfn"] = "bb"
        self.assertEqual(confidence(), "insufficient_evidence")
        pm["entries"][7]["pfn"] = "2a"
        case["data"]["value_check"]["initial_read_sum"] = 1
        self.assertEqual(confidence(), "insufficient_evidence")

    def test_actual_write_masks_and_same_address_pairs(self):
        for stride, label in ((0, "0"), (8, "1/8"), (4, "1/4"), (2, "1/2"), (1, "1")):
            with self.subTest(fraction=label):
                cond, samples, events = cow_data(stride)
                attach_cow(cond, samples, list(reversed(events)))
                indexed = {(s["phase"], s["role"]): s for s in samples}
                case = {"id": "synthetic-cow", "artifacts": {"jsonl": "test.jsonl"}, "data": {"cow": {"fraction": label}}}
                finding, = cow_page_finding(case, indexed, "child_write")
                self.assertEqual(finding["confidence"], "confirmed")
                self.assertEqual(finding["rule"], "cow_pfn_split" if stride else "cow_pfn_shared_control")
                if stride:
                    before = indexed["fork_shared", "child"]["pagemap"]["entries"][0]
                    before["pfn"] = "101"
                    self.assertEqual(cow_page_finding(case, indexed, "child_write")[0]["confidence"], "insufficient_evidence")

    def test_masked_and_failed_reads_have_no_physical_verdict(self):
        cond, samples, events = cow_data(masked=True)
        for status in ("available", "unavailable", "error"):
            with self.subTest(status=status):
                rows, captures = copy.deepcopy(samples), copy.deepcopy(events)
                if status != "available":
                    captures[-1].update(status=status, reason="errno=13" if status == "unavailable" else "short_read=4",
                                        pfn_access="not_applicable", entries=[], sampled_count=0, present_count=0)
                attach_cow(cond, rows, captures)
                self.assertTrue(all(e["pfn"] is None for s in rows for e in s["pagemap"]["entries"]))
                finding, = cow_page_finding({"id": "synthetic", "artifacts": {"jsonl": "raw"},
                                            "data": {"cow": {"fraction": "1/4"}}},
                                           {(s["phase"], s["role"]): s for s in rows}, "child_write")
                self.assertEqual(finding["confidence"], "insufficient_evidence")

    def test_corrupt_raw_bits_addresses_counts_and_mask_are_rejected(self):
        cond, samples, events = cow_data(masked=True)
        for target, field, value in (
                ("entry", "raw_hex", "0080000000000000"), ("entry", "soft_dirty", False),
                ("entry", "raw_hex", "8080000000000123"), ("entry", "pfn", "0"),
                ("entry", "page_index", 7), ("entry", "vaddr", "70000001"),
                ("entry", "expected_written", True), ("event", "present_count", 7),
                ("event", "source", "/proc/34/pagemap"), ("event", "pid", 34)):
            with self.subTest(field=field, value=value):
                captures = copy.deepcopy(events)
                item = captures[0]["entries"][0] if target == "entry" else captures[0]
                item[field] = value
                with self.assertRaisesRegex(ValueError, "pagemap"):
                    attach_cow(cond, copy.deepcopy(samples), captures)

    def test_optional_for_old_record_and_complete_for_new_record(self):
        cond, samples, captures = cow_data()
        attach_cow({}, samples, [])
        self.assertNotIn("pagemap", samples[0])
        for incomplete in ([], captures[1:], captures + captures[:1]):
            with self.assertRaisesRegex(ValueError, "pagemap"):
                attach_cow(cond, samples, incomplete)

    def test_thp_grid_spans_two_2mib_intervals_even_with_a_larger_pmd(self):
        indices = (0, 1, 256, 511, 512, 513)
        for huge in (2 * 1024**2, 32 * 1024**2):
            with self.subTest(pmd_bytes=huge):
                cond = dict(region_bytes=32 * 1024**2, page_bytes=PAGE, huge_bytes=huge,
                            stride_bytes=huge, pagemap_version=1)
                row = dict(phase="after_write", role="parent", pid=15)
                flags = [i * PAGE % huge == 0 for i in indices]
                capture = event(row, indices, flags, [0 if wrote else None for wrote in flags],
                                "masked", 8192)
                attach_pagemaps([capture], [row], cond, "thp", [BASE])
                self.assertEqual(row["pagemap"]["present_count"], sum(flags))

    def test_demand_needs_four_matching_snapshots_even_without_pfn(self):
        cond = dict(bytes=512 * 1024**2, stride=PAGE, page_bytes=PAGE, pagemap_version=1)
        rows, captures = [], []
        for phase, count in (("allocated", 0), ("write_quarter", 32768), ("write_half", 65536), ("write_all", 131072)):
            row = dict(phase=phase, role="parent", pid=75, count=count)
            flags = [i < count for i in DEMAND_INDICES]
            capture = event(row, DEMAND_INDICES, flags, [0 if x else None for x in flags],
                            "masked" if count else "not_applicable", 131072)
            rows.append(row)
            captures.append(capture)
        attach_pagemaps(captures, rows, cond, "demand512", [BASE] * 4)
        case = dict(id="synthetic-demand", artifacts={"jsonl": "test.jsonl"}, data={"samples": [{}, *rows, {}]})
        self.assertEqual(demand_page_finding(case)[0]["confidence"], "confirmed")
        first = rows[0]["pagemap"]
        first["entries"][0]["present"] = True
        first["present_count"] = 1
        self.assertEqual(demand_page_finding(case)[0]["confidence"], "insufficient_evidence")

    def test_empty_entries_and_nonzero_rss_never_confirm_findings(self):
        # 1) 空 entries 即使伪装成 available/visible 也绝不能判为 confirmed
        empty_pm = dict(source="/proc/1/pagemap", status="available", pfn_access="visible",
                        page_bytes=PAGE, sampled_count=0, present_count=0, swapped_count=0, entries=[])
        demand_rows = [dict(phase=p, role="parent", pid=1, pagemap=copy.deepcopy(empty_pm))
                       for p in ("allocated", "write_quarter", "write_half", "write_all")]
        demand_case = dict(id="empty-demand", artifacts={"jsonl": "t.jsonl"}, data={"samples": [{}, *demand_rows, {}]})
        self.assertEqual(demand_page_finding(demand_case)[0]["confidence"], "insufficient_evidence")

        cow_samples = {(p, r): dict(phase=p, role=r, pid=1 if r == "parent" else 2, pagemap=copy.deepcopy(empty_pm))
                       for p in ("fork_shared", "child_write") for r in ("parent", "child")}
        cow_case = dict(id="empty-cow", artifacts={"jsonl": "t.jsonl"}, data={"cow": {"fraction": "1/4"}})
        self.assertEqual(cow_page_finding(cow_case, cow_samples, "child_write")[0]["confidence"], "insufficient_evidence")

        # 2) anonymous_zero_page 需要 read_all 的 rss_kib == 0 且所有 PFN 非空
        legacy = Path(__file__).resolve().parent / "fixtures/legacy-run"
        case = next(c for c in load_run(legacy)["cases"] if c["suite"] == "baseline")
        case["data"]["value_check"]["initial_read_sum"] = 0
        read = next(s for s in case["data"]["samples"] if s["phase"] == "read_all")
        read["pagemap"] = event({k: read[k] for k in ("phase", "role", "pid")},
                                range(8), [False] * 8, [42] * 8, "visible", 4096)
        read["rss_kib"] = 4
        rules = diagnose({"data_origin": "synthetic_test", "cases": [case]})["findings"]
        self.assertEqual(next(f["confidence"] for f in rules if f["rule"] == "anonymous_zero_page"),
                         "insufficient_evidence")
        read["rss_kib"] = 0
        for entry in read["pagemap"]["entries"]:
            entry["pfn"] = None
        rules = diagnose({"data_origin": "synthetic_test", "cases": [case]})["findings"]
        self.assertEqual(next(f["confidence"] for f in rules if f["rule"] == "anonymous_zero_page"),
                         "insufficient_evidence")
