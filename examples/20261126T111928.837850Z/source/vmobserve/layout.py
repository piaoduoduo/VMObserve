"""Resolve address landmarks against actual smaps and loaded ELF segments."""
import re

from .allocator import hex_address, number
from .smaps import FIELDS, parse_mappings

SYMBOLS = ("function", "readonly", "initialized", "uninitialized", "heap", "stack", "libc_malloc")
SYMBOL_LABELS = dict(zip(SYMBOLS, ("程序函数", "只读常量", "已初始化全局变量", "未初始化全局数组", "malloc 返回地址", "栈局部变量", "libc malloc 函数")))


def parse_layout(records, raw, parameters):
    conditions = [r for r in records if r.get("kind") == "condition"]
    if len(conditions) != 1:
        raise ValueError("expected one layout condition")
    condition = conditions[0]
    if number(condition, "probe_version", 1) != 1 or condition["method"] != "dl_iterate_phdr+smaps":
        raise ValueError("unsupported layout probe")
    pid, page = number(condition, "pid", 1), number(condition, "page_bytes", 1)
    if not isinstance(condition["executable"], str) or not condition["executable"].startswith("/"):
        raise ValueError("missing layout executable path")
    blocks = re.findall(r"BEGIN phase=layout role=parent pid=(\d+)\n(.*?)\nEND(?:\n|$)", raw, re.S)
    if len(blocks) != 1 or int(blocks[0][0]) != pid:
        raise ValueError("layout snapshot identity differs")
    mappings = parse_mappings(blocks[0][1])
    segments = []
    keys = set()
    for record in (r for r in records if r.get("kind") == "segment"):
        seg = dict(record)
        if not isinstance(seg["object"], str) or not seg["object"] or type(seg["is_main"]) is not bool:
            raise ValueError("invalid ELF object")
        key = (seg["object"], number(seg, "index"))
        if key in keys or seg["is_main"] != (seg["object"] == condition["executable"]):
            raise ValueError("duplicate or inconsistent ELF object")
        keys.add(key)
        base, vaddr = hex_address(seg["load_bias"]), hex_address(seg["vaddr"])
        start, end = base + vaddr, base + vaddr + number(seg, "memsz", 1)
        offset, filesz = number(seg, "offset"), number(seg, "filesz")
        if filesz > seg["memsz"] or vaddr % page != offset % page or not re.fullmatch(r"[r-][w-][x-]", seg["flags"]):
            raise ValueError("invalid ELF load segment")
        matches = [m for m in mappings if int(m["start"], 16) < end and int(m["end"], 16) > start]
        covered = sum(min(end, int(m["end"], 16)) - max(start, int(m["start"], 16)) for m in matches)
        if covered != seg["memsz"]:
            raise ValueError("ELF load range not fully mapped")
        # Compare file offsets wherever the segment's file-backed bytes overlap
        # a file VMA. BSS tails and the virtual DSO need no disk-backed mapping.
        for m in matches:
            address = max(start, int(m["start"], 16))
            if address < start + filesz and m["pathname"].startswith("/"):
                if m["file_offset"] + address - int(m["start"], 16) != offset + address - start:
                    raise ValueError("ELF and mapping file offsets disagree")
        seg.update(start=f"{start:x}", end=f"{end:x}", mappings=[m["header"] for m in matches])
        segments.append(seg)
    if not any(s["is_main"] for s in segments):
        raise ValueError("no executable PT_LOAD records")
    points = [r for r in records if r.get("kind") == "point"]
    if [p.get("symbol") for p in points] != list(SYMBOLS):
        raise ValueError("missing or reordered address landmarks")
    samples = []
    for point in points:
        address = hex_address(point["address"])
        matches = [m for m in mappings if int(m["start"], 16) <= address < int(m["end"], 16)]
        if len(matches) != 1:
            raise ValueError("landmark address is not in one mapping")
        m = matches[0]
        owners = [s for s in segments if int(s["start"], 16) <= address < int(s["end"], 16)]
        symbol = point["symbol"]
        if symbol not in ("heap", "stack"):
            expected_main = symbol != "libc_malloc"
            if len(owners) != 1 or owners[0]["is_main"] != expected_main:
                raise ValueError("landmark ELF ownership differs")
        owner = owners[0] if owners else None
        samples.append({"phase": "layout", "role": "parent", "pid": pid,
                        "symbol": symbol, "symbol_label": SYMBOL_LABELS[symbol], "address": point["address"],
                        "scope": "address_containing_vma", "mapping_start": m["start"], "mapping_end": m["end"],
                        "permissions": m["permissions"], "pathname": m["pathname"], "mapping_header": m["header"],
                        "elf_object": owner["object"] if owner else None,
                        "elf_segment_index": owner["index"] if owner else None,
                        **{field: m[field] for field in FIELDS}})
    return {"condition": condition, "samples": samples, "segments": segments, "mappings": mappings}


def validate_layout(data):
    checks = []
    for sample in data["samples"]:
        symbol, permissions = sample["symbol"], sample["permissions"]
        expected = "r-x" if symbol in ("function", "libc_malloc") else "r--" if symbol == "readonly" else "rw-"
        checks.append({"name": symbol + "_permissions", "observed": permissions[:3],
                       "expected": expected, "passed": permissions[:3] == expected, "category": "mechanism"})
    return {"status": "passed" if all(c["passed"] for c in checks) else "deviation", "checks": checks}


def layout_findings(case):
    data = case["data"]
    findings = [{"rule": "address_mapping", "confidence": "confirmed",
             "title": "七类程序地址已对应到真实映射与装载段",
             "explanation": "按地址所在区间关联原始 smaps；程序代码、全局数据和库函数进一步对应加载后的 ELF PT_LOAD。堆和栈按实际映射显示。",
             "evidence": [{"case_id": case["id"], "jsonl": case["artifacts"]["jsonl"], "smaps": case["artifacts"]["smaps"],
                           "points": [{k: s[k] for k in ("symbol", "address", "mapping_header", "elf_object", "elf_segment_index")} for s in data["samples"]]}],
             "limitations": "这些是虚拟地址；未采集物理页框。一个装载段可能跨多条映射，映射权限可受装载器调整。相同映射的驻留量不可按变量重复相加。",
             "next_steps": ["先预测函数、常量和变量所在区域，再逐项对照。", "再运行一次，比较地址和权限；绝对地址变化不等于程序行为变化。"]}]
    if case["validation"]["status"] == "deviation":
        findings.append({"rule": "layout_permissions", "confidence": "confirmed",
                         "title": "实际映射权限与本课例预期不同",
                         "explanation": "地址与映射关联完整，但权限检查出现偏差。请保留当前观测并检查构建和装载条件。",
                         "evidence": [{"case_id": case["id"], "checks": case["validation"]["checks"]}],
                         "limitations": "仅确认权限差异；没有据此确定编译、链接或系统设置中的具体原因。"})
    return findings
