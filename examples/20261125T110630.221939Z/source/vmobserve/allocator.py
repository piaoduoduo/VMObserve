"""Course malloc records: derive whole-VMA metrics from full raw smaps."""
import re
from .smaps import FIELDS, parse_mappings

PHASES = ("before_alloc", "allocated", "write_quarter", "write_half", "write_all", "freed")


def number(record, field, minimum=0):
    value = record[field]
    if type(value) is not int or value < minimum:
        raise ValueError("invalid allocator integer: " + field)
    return value


def hex_address(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]+", value):
        raise ValueError("invalid allocator address")
    return int(value, 16)


def parse_allocator(records, raw, parameters):
    def one(kind):
        matches = [r for r in records if r.get("kind") == kind]
        if len(matches) != 1:
            raise ValueError("expected one allocator " + kind)
        return matches[0]
    condition, values = one("condition"), one("values")
    size = number(condition, "requested_kib", 1)
    page = number(condition, "page_bytes", 1)
    positions = (size * 1024 + page - 1) // page
    version = number(condition, "probe_version", 1)
    if (version not in (1, 2) or condition["allocator"] != "malloc" or
            size != parameters["requested_kib"] or size not in (1, 256, 1024, 16384) or
            number(condition, "positions", 1) != positions or
            condition["thp_policy"] != "system_default" or
            condition["allocation_sequence"] != "fresh_process_single_block"):
        raise ValueError("allocator condition differs from plan")
    if version == 2:
        if condition["course_code"] not in ("reference", "student") or condition["course_code"] != parameters.get("course_code"):
            raise ValueError("course implementation differs from plan")
    elif "course_code" in parameters:
        raise ValueError("course plan requires version 2 metadata")
    samples = [dict(r) for r in records if r["kind"] == "sample"]
    if [s.get("phase") for s in samples] != list(PHASES):
        raise ValueError("missing or reordered allocator phases")
    blocks = re.findall(r"BEGIN phase=(\S+) role=(\S+) pid=(\d+)\n(.*?)\nEND(?:\n|$)", raw, re.S)
    if len(blocks) != len(samples):
        raise ValueError("incomplete allocator smaps")
    address = hex_address(samples[1]["address"])
    if not address:
        raise ValueError("null successful allocation")
    expected_writes = (0, 0, (positions + 3) // 4, (positions + 1) // 2, positions, 0)
    pid = number(samples[0], "pid", 1)
    for index, (sample, block) in enumerate(zip(samples, blocks)):
        phase, role, raw_pid, body = block
        if (phase, role, int(raw_pid)) != (sample["phase"], "parent", pid) or sample["role"] != role or sample["pid"] != pid:
            raise ValueError("allocator smaps identity differs")
        if hex_address(sample["address"]) != (0 if index == 0 else address):
            raise ValueError("allocator target address changed")
        hex_address(sample["program_break"])
        count = number(sample, "written_positions")
        if version == 1 and count != expected_writes[index]:
            raise ValueError("allocator actual writes differ from plan")
        if version == 2 and (count > positions or (index in (0, 1, 5) and count != 0)):
            raise ValueError("invalid course position count")
        for field in ("action_minor", "action_major"):
            number(sample, field)
        mappings = [m for m in parse_mappings(body)
                    if int(m["end"], 16) > address and int(m["start"], 16) < address + size * 1024]
        if 1 <= index <= 4:
            covered = sum(min(int(m["end"], 16), address + size * 1024) - max(int(m["start"], 16), address) for m in mappings)
            if covered != size * 1024:
                raise ValueError("live allocation range not fully mapped")
        sample.update({field: sum(m[field] for m in mappings) for field in FIELDS})
        sample.update(scope="overlapping_vmas", requested_kib=size, mappings=mappings,
                      mapping_present=bool(mappings), kernel_page_kib=None,
                      mapping_kind="heap" if any("[heap]" in m["header"] for m in mappings) else "other" if mappings else "absent")
    if number(values, "checked_positions", 1) != positions or type(values["ok"]) is not bool:
        raise ValueError("invalid allocator value check")
    number(values, "mismatches")
    return {"condition": condition, "samples": samples, "value_check": values}


def validate_allocator(data):
    values = data["value_check"]
    passed = values["ok"] and values["mismatches"] == 0
    checks = [
        {"id": "allocator_written_values", "status": "passed" if passed else "deviation",
         "category": "correctness", "observed": values["mismatches"], "expected": 0}]
    positions = data["condition"]["positions"]
    for sample, expected in zip(data["samples"][2:5], ((positions + 3) // 4, (positions + 1) // 2, positions)):
        checks.append({"id": "positions_" + sample["phase"], "category": "correctness",
                       "status": "passed" if sample["written_positions"] == expected else "deviation",
                       "observed": sample["written_positions"], "expected": expected})
    return {"status": "passed" if all(c["status"] == "passed" for c in checks) else "failed", "checks": checks}


def allocator_findings(case):
    samples = case["data"]["samples"]
    before, allocated, quarter, half, full, freed = samples
    scope = "指标合计了与申请地址范围相交的整个 VMA，其中可能包含分配器元数据和其他对象。缺页数属于进程。"
    def finding(rule, confidence, title, explanation, selected):
        return {"rule": rule, "confidence": confidence, "title": title, "explanation": explanation,
                "limitations": scope, "evidence": [{"case_id": case["id"], "phase": s["phase"],
                    "jsonl": case["artifacts"]["jsonl"], "smaps": case["artifacts"]["smaps"],
                    "rss_kib": s["rss_kib"], "mappings": s["mappings"],
                    "program_break": s["program_break"], "action_minor": s["action_minor"]} for s in selected]}
    result = [finding("malloc_mapping", "confirmed", "已定位申请地址所在映射",
        f"申请 {allocated['requested_kib']} KiB，返回地址 0x{allocated['address']}。该地址位于"
        + ("标注为 [heap] 的映射。" if allocated["mapping_kind"] == "heap" else "未标注为 [heap] 的映射。")
        + f"申请前后 program break 为 0x{before['program_break']} 和 0x{allocated['program_break']}。", [before, allocated])]
    growth = full["rss_kib"] - allocated["rss_kib"]
    faults = sum(s["action_minor"] for s in (quarter, half, full))
    same_mapping = [(m["start"], m["end"]) for m in allocated["mappings"]] == [(m["start"], m["end"]) for m in full["mappings"]]
    result.append(finding("malloc_demand", "probable" if growth > 0 and faults > 0 and same_mapping else "insufficient_evidence",
        "逐步写入与按需分配" if growth > 0 and faults > 0 and same_mapping else "本样本不足以显示新增驻留",
        f"申请后相关映射 RSS 为 {allocated['rss_kib']} KiB，写完为 {full['rss_kib']} KiB，写入阶段次缺页合计 {faults}。"
        + ("驻留增加并伴随次缺页，支持首次访问触发按需分配的解释。" if growth > 0 and faults > 0 and same_mapping else "页面可能已驻留，或映射范围发生变化，需要结合其他尺寸对照。"), [allocated, quarter, half, full]))
    result.append(finding("malloc_free", "confirmed", "释放后的地址范围仍有映射" if freed["mapping_present"] else "释放后的地址范围已无映射",
        f"free 后检查保存的原地址范围，相关映射 RSS 合计 {freed['rss_kib']} KiB。"
        + ("映射仍存在，分配器可能保留空间供后续使用。此处只确认映射状态，保留原因属于可能解释。" if freed["mapping_present"] else "原地址范围在本次 smaps 中已经没有映射。"), [full, freed]))
    return result
