"""Validate JSONL shape and reconcile every measurement with the raw smaps.

No absent field is replaced by zero. A successful process exit is not evidence
that collection was complete or that an expected relationship held.
"""

import json
import re
from pathlib import Path

from .cow import COW_STRIDES
from .allocator import parse_allocator, validate_allocator
from .layout import parse_layout, validate_layout
from .thp_policy import parse_policy
from . import group3, group4, systems

METRICS = {"size_kib": "Size", "rss_kib": "Rss", "pss_kib": "Pss",
           "private_dirty_kib": "Private_Dirty", "shared_dirty_kib": "Shared_Dirty",
           "huge_kib": "AnonHugePages", "swap_kib": "Swap", "kernel_page_kib": "KernelPageSize"}
BASE_PHASES = [(p, "parent") for p in ("untouched", "read_all", "write_quarter", "write_all")]
BASE_PHASES += [(p, r) for p in ("fork_shared", "child_write_quarter") for r in ("parent", "child")]


def one(records, kind):
    matches = [r for r in records if r.get("kind") == kind]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one {kind}, got {len(matches)}")
    return matches[0]


def integer(record, key, minimum=0):
    value = record[key]
    if type(value) is not int or value < minimum:
        raise ValueError(f"invalid {key}: {value!r}")
    return value


def baseline_condition(records, parameters):
    condition = one(records, "environment")
    page = integer(condition, "page_bytes", 1)
    mib = integer(condition, "mib", 1)
    if mib != parameters["mib"] or condition["thp_policy"] != "MADV_NOHUGEPAGE":
        raise ValueError("baseline condition differs from execution plan")
    size_bytes = mib * 1024 * 1024
    if size_bytes % (4 * page) or page % 1024:
        raise ValueError("baseline size/page unit unsupported")
    total = size_bytes // page
    if "probe_version" not in condition:
        if "cow_fraction" in parameters or any(k.startswith("cow_") for k in condition):
            raise ValueError("COW plan requires explicit probe metadata")
        fraction, written, phase, origin = "1/4", total // 4, "child_write_quarter", "legacy_fixed_quarter"
    else:
        if type(condition["probe_version"]) is not int or condition["probe_version"] != 2:
            raise ValueError("unsupported baseline probe version")
        fraction = condition["cow_fraction"]
        if fraction not in COW_STRIDES or fraction != parameters.get("cow_fraction"):
            raise ValueError("COW fraction differs from execution plan")
        stride = COW_STRIDES[fraction]
        if integer(condition, "cow_stride_pages") != stride or (stride and total % stride):
            raise ValueError("COW stride differs from requested fraction")
        written = total // stride if stride else 0
        if integer(condition, "total_pages", 1) != total or integer(condition, "cow_pages") != written:
            raise ValueError("COW page counts disagree with size/fraction")
        phase, origin = "child_write", "recorded"
    return condition, {"fraction": fraction, "written_pages": written, "total_pages": total,
                       "written_kib": written * page // 1024, "phase": phase, "condition_origin": origin}


def parse_case(jsonl, smaps, suite, parameters):
    records = []
    for line in Path(jsonl).read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if not isinstance(row, dict) or "kind" not in row:
            raise ValueError("each JSONL record must be an object with kind")
        records.append(row)
    if suite in systems.SUITES:
        return systems.parse(records, suite, parameters["lab"])
    if suite in group4.SOURCES:
        return group4.parse(records, Path(smaps).read_text(encoding="utf-8"), suite, parameters)
    if suite in group3.SUITES:
        return group3.parse(records, Path(smaps).read_text(encoding="utf-8"), suite, parameters, Path(jsonl).parent)
    if suite == "course":
        return parse_allocator(records, Path(smaps).read_text(encoding="utf-8"), parameters)
    if suite == "layout":
        return parse_layout(records, Path(smaps).read_text(encoding="utf-8"), parameters)
    samples = [r for r in records if r["kind"] == "sample"]
    cow = None
    if suite == "baseline":
        condition, cow = baseline_condition(records, parameters)
        expected = [(cow["phase"] if p == "child_write_quarter" else p, r) for p, r in BASE_PHASES]
    else:
        expected = [(p, "parent") for p in ("untouched", "after_write")]
    if [(r.get("phase"), r.get("role")) for r in samples] != expected:
        raise ValueError("missing, duplicate or out-of-order phase/role snapshots")
    for row in samples:
        for key in (*METRICS, "action_minor", "action_major", "pid"):
            integer(row, key, 1 if key in ("pid", "size_kib", "kernel_page_kib") else 0)
        if not (row["pss_kib"] <= row["rss_kib"] <= row["size_kib"]):
            raise ValueError("inconsistent PSS/RSS/Size")
        if row["huge_kib"] > row["rss_kib"]:
            raise ValueError("AnonHugePages exceeds RSS")
    # BEGIN/END delimiters include phase, role and PID; reconcile exact blocks.
    raw = Path(smaps).read_text(encoding="utf-8")
    blocks = re.findall(r"BEGIN phase=(\S+) role=(\S+) pid=(\d+)\n(.*?)\nEND(?:\n|$)", raw, re.S)
    if len(blocks) != len(samples):
        raise ValueError("incomplete raw smaps blocks")
    for row, (phase, role, pid, body) in zip(samples, blocks):
        if (phase, role, int(pid)) != (row["phase"], row["role"], row["pid"]):
            raise ValueError("raw smaps identity differs from JSONL")
        header = re.match(r"([0-9a-f]+)-([0-9a-f]+)\s", body)
        if not header or (int(header[2], 16) - int(header[1], 16)) != row["size_kib"] * 1024:
            raise ValueError("raw VMA address span differs from size")
        for field, label in METRICS.items():
            matches = re.findall(rf"^{label}:\s+(\d+) kB$", body, re.M)
            if len(matches) != 1 or int(matches[0]) != row[field]:
                raise ValueError(f"raw smaps disagrees with {field}")
    if suite == "baseline":
        check = one(records, "isolation")
        if type(check["ok"]) is not bool:
            raise ValueError("isolation.ok is not boolean")
        integer(check, "parent_sum")
        integer(check, "child_sum")
        if cow["condition_origin"] == "recorded":
            if integer(check, "cow_written_pages") != cow["written_pages"]:
                raise ValueError("actual COW writes differ from plan")
            integer(check, "parent_mismatches")
            integer(check, "child_mismatches")
        size = condition["mib"] * 1024
    else:
        condition = one(records, "condition")
        parse_policy(condition, raw, parameters, samples[0]["pid"])
        for key in ("page_bytes", "huge_bytes", "region_bytes", "stride_bytes", "writes"):
            integer(condition, key, 1)
        if (condition["thp_requested"], condition["pattern"]) != (parameters["thp"], parameters["pattern"]):
            raise ValueError("THP condition differs from execution plan")
        stride = condition["huge_bytes"] if condition["pattern"] == "sparse" else condition["page_bytes"]
        if condition["stride_bytes"] != stride or condition["region_bytes"] != 32 * 1024 * 1024:
            raise ValueError("unexpected stride or region size")
        if condition["region_bytes"] % stride or condition["writes"] != condition["region_bytes"] // stride:
            raise ValueError("writes disagree with stride/size")
        if condition["huge_aligned"] is not True:
            raise ValueError("unaligned THP mapping")
        check = one(records, "values")
        if type(check["ok"]) is not bool:
            raise ValueError("values.ok is not boolean")
        integer(check, "sum")
        size = condition["region_bytes"] // 1024
    if any(r["size_kib"] != size for r in samples):
        raise ValueError("sample size differs from condition")
    result = {"condition": condition, "samples": samples, "value_check": check}
    if cow is not None:
        result["cow"] = cow
    return result


def validate_measurements(suite, data):
    if suite in systems.SUITES:
        return systems.validate(data)
    if suite in group4.SOURCES:
        return group4.validate(suite, data)
    if suite in group3.SUITES:
        return group3.validate(suite, data)
    if suite == "layout":
        return validate_layout(data)
    if suite == "course":
        return validate_allocator(data)
    checks = []
    def add(name, observed, expected, tolerance=0, category="expectation"):
        passed = (abs(observed - expected) <= tolerance) if type(observed) is int else observed == expected
        checks.append({"id": name, "status": "passed" if passed else "deviation",
                       "observed": observed, "expected": expected, "tolerance": tolerance, "category": category})
    samples = {(s["phase"], s["role"]): s for s in data["samples"]}
    def s(phase, role="parent"):
        return samples[phase, role]
    add("values_isolated" if suite == "baseline" else "written_values", data["value_check"]["ok"], True, category="correctness")
    add("no_observed_swap", all(x["swap_kib"] == 0 for x in samples.values()), True)
    add("no_major_faults", all(x["action_major"] == 0 for x in samples.values()), True)
    add("untouched_rss", s("untouched")["rss_kib"], 0)
    if suite == "baseline":
        size = data["condition"]["mib"] * 1024
        pages = size * 1024 // data["condition"]["page_bytes"]
        cow = data["cow"]
        phase, written = cow["phase"], cow["written_kib"]
        add("parent_checksum", data["value_check"]["parent_sum"], pages, category="correctness")
        add("child_checksum", data["value_check"]["child_sum"], pages + cow["written_pages"], category="correctness")
        if cow["condition_origin"] == "recorded":
            for role in ("parent", "child"):
                add(role + "_page_values", data["value_check"][role + "_mismatches"], 0, category="correctness")
        add("no_hugepages", all(x["huge_kib"] == 0 for x in samples.values()), True)
        add("read_zero_rss", s("read_all")["rss_kib"], 0)
        add("quarter_write_rss", s("write_quarter")["rss_kib"], size // 4)
        add("full_write_rss", s("write_all")["rss_kib"], size)
        add("fork_rss_sum", sum(s("fork_shared", r)["rss_kib"] for r in ("parent", "child")), size * 2)
        add("fork_pss_sum", sum(s("fork_shared", r)["pss_kib"] for r in ("parent", "child")), size)
        add("cow_pss_sum", sum(s(phase, r)["pss_kib"] for r in ("parent", "child")), size + written)
        for role in ("parent", "child"):
            add("cow_private_dirty_" + role, s(phase, role)["private_dirty_kib"], written)
            add("cow_shared_dirty_" + role, s(phase, role)["shared_dirty_kib"], size - written)
        for phase, role, expected in (("read_all", "parent", pages), ("write_quarter", "parent", pages // 4),
                                      ("write_all", "parent", pages * 3 // 4), (cow["phase"], "child", cow["written_pages"])):
            add("faults_" + phase, s(phase, role)["action_minor"], expected, 8)
    else:
        c, after = data["condition"], s("after_write")
        add("write_checksum", data["value_check"]["sum"], c["writes"], category="correctness")
        if c.get("process_thp_disabled") == 1:
            add("process_disabled_no_huge", after["huge_kib"], 0)
        if c["thp_requested"] == "off":
            add("thp_off_no_huge", after["huge_kib"], 0)
            add("thp_off_rss", after["rss_kib"], c["writes"] * c["page_bytes"] // 1024)
        # Requested-on with no THP is a valid observation, never a failed check.
    state = "passed" if all(c["status"] == "passed" for c in checks) else "deviation"
    if any(c["status"] != "passed" and c["category"] == "correctness" for c in checks):
        state = "failed"
    return {"status": state, "checks": checks}
