"""Validate JSONL shape and reconcile every measurement with the raw smaps.

No absent field is replaced by zero. A successful process exit is not evidence
that collection was complete or that an expected relationship held.
"""

import json
import re
from pathlib import Path

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


def parse_case(jsonl, smaps, suite, parameters):
    records = []
    for line in Path(jsonl).read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if not isinstance(row, dict) or "kind" not in row:
            raise ValueError("each JSONL record must be an object with kind")
        records.append(row)
    samples = [r for r in records if r["kind"] == "sample"]
    expected = BASE_PHASES if suite == "baseline" else [(p, "parent") for p in ("untouched", "after_write")]
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
        condition = one(records, "environment")
        page = integer(condition, "page_bytes", 1)
        mib = integer(condition, "mib", 1)
        if mib != parameters["mib"] or condition["thp_policy"] != "MADV_NOHUGEPAGE":
            raise ValueError("baseline condition differs from execution plan")
        if mib * 1024 * 1024 % (4 * page):
            raise ValueError("baseline size not divisible by four pages")
        check = one(records, "isolation")
        if type(check["ok"]) is not bool:
            raise ValueError("isolation.ok is not boolean")
        integer(check, "parent_sum")
        integer(check, "child_sum")
        size = mib * 1024
    else:
        condition = one(records, "condition")
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
    return {"condition": condition, "samples": samples, "value_check": check}


def validate_measurements(suite, data):
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
        add("parent_checksum", data["value_check"]["parent_sum"], pages, category="correctness")
        add("child_checksum", data["value_check"]["child_sum"], pages * 5 // 4, category="correctness")
        add("no_hugepages", all(x["huge_kib"] == 0 for x in samples.values()), True)
        add("read_zero_rss", s("read_all")["rss_kib"], 0)
        add("quarter_write_rss", s("write_quarter")["rss_kib"], size // 4)
        add("full_write_rss", s("write_all")["rss_kib"], size)
        add("fork_rss_sum", sum(s("fork_shared", r)["rss_kib"] for r in ("parent", "child")), size * 2)
        add("fork_pss_sum", sum(s("fork_shared", r)["pss_kib"] for r in ("parent", "child")), size)
        add("cow_pss_sum", sum(s("child_write_quarter", r)["pss_kib"] for r in ("parent", "child")), size * 5 // 4)
        for role in ("parent", "child"):
            add("cow_private_dirty_" + role, s("child_write_quarter", role)["private_dirty_kib"], size // 4)
        for phase, role, expected in (("read_all", "parent", pages), ("write_quarter", "parent", pages // 4),
                                      ("write_all", "parent", pages * 3 // 4), ("child_write_quarter", "child", pages // 4)):
            add("faults_" + phase, s(phase, role)["action_minor"], expected, 8)
    else:
        c, after = data["condition"], s("after_write")
        add("write_checksum", data["value_check"]["sum"], c["writes"], category="correctness")
        if c["thp_requested"] == "off":
            add("thp_off_no_huge", after["huge_kib"], 0)
            add("thp_off_rss", after["rss_kib"], c["writes"] * c["page_bytes"] // 1024)
        # Requested-on with no THP is a valid observation, never a failed check.
    state = "passed" if all(c["status"] == "passed" for c in checks) else "deviation"
    if any(c["status"] != "passed" and c["category"] == "correctness" for c in checks):
        state = "failed"
    return {"status": state, "checks": checks}
