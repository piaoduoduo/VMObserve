"""Original group-3 actions, with replayable raw evidence and course findings."""
import re
from pathlib import Path
from .smaps import parse_mappings, FIELDS
from .sequence import trace_actions, attach_mappings, describe_allocations, allocation_overview

SUITES = ("link-dynamic", "link-static", "sequence", "demand512", "stack")
DEMAND_PHASES = ("before_alloc", "allocated", "write_quarter", "write_half", "write_all", "freed")
TITLES = {"link-dynamic": "3.1 动态链接与装入", "link-static": "3.1 静态链接对照",
          "sequence": "3.2 同进程连续 malloc", "demand512": "3.3 原尺寸按需调页", "stack": "3.3 栈增长与溢出"}


def plan(repeats):
    cases = []
    for repeat in range(1, repeats + 1):
        for suite in SUITES[:-1]:
            cases.append(dict(id=f"{suite}-{repeat}", suite=suite, parameters={"repeat": repeat}, arguments=[]))
        for mode, limit in (("normal", 8192), ("overflow", 512), ("overflow", 2048)):
            cases.append(dict(id=f"stack-{mode}-{limit}-{repeat}", suite="stack",
                              parameters={"repeat": repeat, "mode": mode, "limit_kib": limit}, arguments=[mode, str(limit)]))
    return cases


def demand_thp_plan(repeats, process="inherit"):
    extra = {} if process == "inherit" else {"process_thp": process}
    return [
        dict(id=f"demand512-thp-{policy}-{repeat}", suite="demand512",
             parameters={"repeat": repeat, "thp_advice": policy, **extra},
             arguments=[policy, *extra.values()])
        for repeat in range(1, repeats + 1)
        for policy in (("off", "on") if repeat % 2 else ("on", "off"))
    ]


def prepare(case, folder, binary, execute, timeout):
    """Collect tools from our freshly built binary; never run historical source."""
    command = [str(binary), *case["arguments"]]
    if case["suite"] == "sequence":
        case["artifacts"]["syscalls"] = (folder / "syscalls.txt").relative_to(folder.parents[1]).as_posix()
        command = ["strace", "-qq", "-s", "256", "-e", "trace=brk,mmap,munmap,mremap,write",
                   "-o", str(folder / "syscalls.txt"), *command]
    if case["suite"].startswith("link-"):
        case["inspection"] = {}
        for name, options in (("file", []), ("ldd", []), ("readelf", ["-W", "-h", "-l", "-d"])):
            stdout, stderr = folder / (name + ".txt"), folder / (name + ".stderr.txt")
            result = execute([name, *options, str(binary)], stdout, stderr, timeout)
            case["inspection"][name] = result
            for key, path in ((name, stdout), (name + "_stderr", stderr)):
                case["artifacts"][key] = path.relative_to(folder.parents[1]).as_posix()
            # ldd conventionally returns 1 for static executables.
            if result["exit_code"] != 0 and not (name == "ldd" and case["suite"] == "link-static" and result["exit_code"] == 1):
                raise ValueError(f"{name} inspection failed: {result}")
    return command


def exactly(records, kind):
    rows = [r for r in records if r["kind"] == kind]
    if len(rows) != 1:
        raise ValueError(f"expected one {kind}, got {len(rows)}")
    return rows[0]


def containing(mappings, address):
    return next((m for m in mappings if int(m["start"], 16) <= int(address, 16) < int(m["end"], 16)), None)


def parse(records, raw, suite, parameters, folder):
    condition = exactly(records, "condition")
    controlled = suite == "demand512" and "thp_advice" in parameters
    source = [r for r in records if r["kind"] == "sample"]
    blocks = re.findall(r"BEGIN phase=(\S+) pid=(\d+)\n(.*?)\nEND(?:\n|$)", raw, re.S)
    if not source or len(source) != len(blocks):
        raise ValueError("incomplete group3 snapshots")
    samples, mappings = [], []
    for row, (phase, pid, body) in zip(source, blocks):
        if (phase, int(pid)) != (row["phase"], row["pid"]) or row["pid"] != condition["pid"]:
            raise ValueError("snapshot phase/PID mismatch")
        for key in ("count", "action_minor", "action_major", "total_minor", "total_major"):
            if type(row[key]) is not int or row[key] < 0:
                raise ValueError("invalid sample count " + key)
        maps = parse_mappings(body, include_flags=controlled)
        mappings.append(maps)
        mapping = containing(maps, row["address"])
        sample = {**row, "role": "child" if suite == "stack" else "parent",
                  "scope": "address_containing_vma", "mapping_present": mapping is not None,
                  "pathname": mapping["pathname"] if mapping else "", "mapping_header": mapping["header"] if mapping else ""}
        sample.update({key: mapping[key] if mapping else 0 for key in FIELDS})
        if controlled and mapping:
            sample["vm_flags"] = mapping["vm_flags"]
        sample["process_rss_kib"] = sum(m["rss_kib"] for m in maps)
        sample["process_size_kib"] = sum(m["size_kib"] for m in maps)
        samples.append(sample)
    phases = [s["phase"] for s in samples]
    result = dict(condition=condition, samples=samples)
    if suite.startswith("link-"):
        mode = suite.removeprefix("link-")
        if condition["mode"] != mode or phases != ["loaded"]:
            raise ValueError("link plan mismatch")
        elf = (folder / "readelf.txt").read_text()
        result["file"] = (folder / "file.txt").read_text()
        result["ldd"] = (folder / "ldd.txt").read_text() + (folder / "ldd.stderr.txt").read_text()
        result["interpreter"] = bool(re.search(r"^\s*INTERP\s", elf, re.M))
        result["needed"] = re.findall(r"\(NEEDED\).*?\[(.*?)\]", elf)
        symbols = [r for r in records if r["kind"] == "symbol"]
        if [s["name"] for s in symbols] != ["function", "readonly", "initialized", "uninitialized", "heap", "stack"]:
            raise ValueError("missing symbols")
        result["symbols"] = [{**s, "mapping": containing(mappings[0], s["address"])} for s in symbols]
        if any(s["mapping"] is None for s in result["symbols"]):
            raise ValueError("symbol not found in raw mappings")
        paths = sorted({m["pathname"] for m in mappings[0] if m["pathname"].startswith("/")})
        result["library_mappings"] = [p for p in paths if "/libc.so" in p or "/ld-linux" in p]
        exe = result["symbols"][0]["mapping"]["pathname"]
        exe_maps = [m for m in mappings[0] if m["pathname"] == exe]
        bias = min(int(m["start"], 16)-m["file_offset"] for m in exe_maps) if re.search(r"Type:\s+DYN", elf) else 0
        loads = re.findall(r"^\s*LOAD\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+0x[0-9a-f]+\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+([RWE ]+)\s+0x[0-9a-f]+", elf, re.M)
        result["segments"] = []
        for offset, address, filesz, memsz, flags in loads:
            start = bias + int(address, 16); end = start + int(memsz, 16)
            matches = [m["header"] for m in mappings[0] if int(m["start"], 16) < end and int(m["end"], 16) > start]
            result["segments"].append(dict(offset=offset, vaddr=address, filesz=int(filesz,16), memsz=int(memsz,16),
                                           flags=flags.strip(), start=hex(start), end=hex(end), mappings=matches))
        if not loads or any(not s["mappings"] for s in result["segments"]):
            raise ValueError("ELF LOAD not matched to runtime mappings")
    elif suite == "sequence":
        if condition["mode"] != "sequence" or phases != ["before_alloc", "alloc_1KiB", "alloc_256KiB", "alloc_1MiB", "freed"] or condition["sizes"] != [1024,262144,1048576]:
            raise ValueError("sequential allocation actions differ from original task")
        addresses = exactly(records, "allocations")["addresses"]
        if addresses != [s["address"] for s in samples[1:4]] or len(set(addresses)) != 3:
            raise ValueError("allocation addresses disagree")
        result["allocations"] = addresses
        attach_mappings(samples, mappings, addresses, condition["sizes"])
        result["overview"] = allocation_overview(samples[3])
        trace = (folder / "syscalls.txt").read_text()
        result["actions"] = trace_actions(trace)
        describe_allocations(result["actions"], samples, addresses, condition["sizes"])
    elif suite == "demand512":
        if tuple(phases) != DEMAND_PHASES:
            raise ValueError("demand phases missing")
        allocated_address = samples[1]["address"]
        if (condition["mode"] != "demand512" or int(allocated_address, 16) == 0
                or any(row["address"] != allocated_address for row in samples[2:])
                or any(not row["mapping_present"] for row in samples[1:5])):
            raise ValueError("demand samples must follow the same live allocation through the writes")
        if condition["bytes"] != 512*1024*1024 or condition["stride"] != 4096:
            raise ValueError("original demand size/stride changed")
        if [s["count"] for s in samples] != [0,0,32768,65536,131072,0]:
            raise ValueError("original demand write counts changed")
        result["values"] = exactly(records, "values")
        process = parameters.get("process_thp")
        recorded_process = condition.get("process_thp")
        disabled = condition.get("process_thp_disabled")
        if process is not None:
            if (not controlled or process not in ("allow", "disable") or recorded_process != process
                    or type(disabled) is not int or disabled not in (0, 1)):
                raise ValueError("process THP setting does not match the demand experiment plan")
        elif recorded_process is not None or disabled is not None:
            raise ValueError("unexpected process THP setting in demand snapshot")
        if controlled:
            policy = exactly(records, "policy")
            if (policy["policy"] not in ("on", "off") or policy["policy"] != parameters["thp_advice"]
                    or policy["pid"] != condition["pid"] or policy["address"] != allocated_address
                    or policy["bytes"] != condition["bytes"]
                    or type(policy["result"]) is not int or policy["result"] not in (0, -1)
                    or type(policy["errno"]) is not int
                    or (policy["errno"] != 0 if policy["result"] == 0 else policy["errno"] <= 0)):
                raise ValueError("THP advice record does not match the planned allocation")
            address = int(allocated_address, 16)
            if address % (2 * 1024 * 1024):
                raise ValueError("controlled mapping is not aligned to 2 MiB")
            for maps in mappings[1:5]:
                mapping = containing(maps, allocated_address)
                if (int(mapping["start"], 16) != address
                        or int(mapping["end"], 16) != address + condition["bytes"]
                        or mapping["permissions"] != "rw-p" or mapping["pathname"]):
                    raise ValueError("controlled snapshot does not describe the exact private anonymous allocation")
            result["policy"] = policy
        elif any(row["kind"] == "policy" for row in records):
            raise ValueError("unplanned THP advice in original demand run")
    elif suite == "stack":
        if condition["mode"] != parameters["mode"] or condition["limit_kib"] != parameters["limit_kib"]:
            raise ValueError("stack conditions differ from plan")
        if phases[0] != "before_stack" or any(p != "stack" for p in phases[1:]) or len(samples)<2:
            raise ValueError("missing stack growth evidence")
        if any(s["pathname"] != "[stack]" for s in samples):
            raise ValueError("recursive object outside stack mapping")
        result["outcome"] = exactly(records, "outcome")
        if result["outcome"]["child_pid"] != condition["pid"]:
            raise ValueError("parent waited for different child")
        result["returned"] = [r for r in records if r["kind"] == "returned"]
    return result


def validate(suite, data):
    checks = []
    def check(name, value, expected):
        checks.append(dict(id=name, observed=value, expected=expected, status="passed" if value == expected else "failed", category="correctness"))
    s = data["samples"]
    if suite.startswith("link-"):
        dynamic = suite == "link-dynamic"
        check("ELF_interpreter", data["interpreter"], dynamic)
        check("ELF_dependencies", bool(data["needed"]), dynamic)
        check("runtime_shared_libraries", bool(data["library_mappings"]), dynamic)
        permissions = {x["name"]:x["mapping"]["permissions"] for x in data["symbols"]}
        check("code_executable", "x" in permissions["function"], True)
        check("readonly_not_writable", "w" in permissions["readonly"], False)
        check("data_heap_stack_writable", all("w" in permissions[k] for k in ("initialized","uninitialized","heap","stack")), True)
    elif suite == "sequence":
        check("three_live_blocks", all(b["mapping"] is not None for b in s[3]["blocks"]), True)
        check("sequence_counts", [r["count"] for r in s], [0,1,2,3,0])
        check("trace_completed", len(data["actions"]), 4)
    elif suite == "demand512":
        check("original_values", data["values"], {"kind":"values","checked":131072,"mismatches":0})
        check("resident_growth", s[1]["rss_kib"] < s[2]["rss_kib"] <= s[3]["rss_kib"] <= s[4]["rss_kib"], True)
        check("full_residency", s[4]["rss_kib"] >= 512*1024, True)
        if "policy" in data:
            policy = data["policy"]
            wanted, opposite = ("hg", "nh") if policy["policy"] == "on" else ("nh", "hg")
            check("thp_advice_result", policy["result"], 0)
            check("thp_vma_flags", all(wanted in row["vm_flags"] and opposite not in row["vm_flags"]
                                       for row in s[1:5]), True)
            check("controlled_region_released", s[-1]["mapping_present"], False)
            process = data["condition"].get("process_thp") if "condition" in data else None
            if process:
                check("thp_process_readback", data["condition"]["process_thp_disabled"], int(process == "disable"))
            if policy["policy"] == "off" or process == "disable":
                check("thp_disabled_observation", [row["huge_kib"] for row in s[1:5]], [0] * 4)
    elif suite == "stack":
        o=data["outcome"]; overflow=data["condition"]["mode"]=="overflow"
        check("termination_signal", o["signal"], 11 if overflow else 0)
        check("termination_exit", o["exit_code"], -1 if overflow else 0)
        check("normal_return", len(data["returned"]), 0 if overflow else 1)
        check("stack_grew", s[-1]["size_kib"] > s[0]["size_kib"], True)
        check("stack_faults", o["minor"] > 0, True)
        if not overflow: check("recursion_depth", s[-1]["count"], 64)
    return {"status":"passed" if all(c["status"]=="passed" for c in checks) else "failed", "checks":checks}


def findings(case):
    d=case["data"]; suite=case["suite"]
    if suite.startswith("link-"):
        explanation=f"ELF解释器：{d['interpreter']}；依赖：{', '.join(d['needed']) or '无'}；已将装载段和六类地址关联到实际映射。"
    elif suite=="sequence":
        explanation="；".join(a["action"]+"："+(" / ".join(x.split('(')[0] for x in a["syscalls"]) or "该动作区间无内存管理系统调用") for a in d["actions"])
    elif suite=="demand512":
        explanation="512 MiB、4096字节步长，按A/B/C分批写入；映射RSS依次为 "+" / ".join(str(s["rss_kib"])+" KiB" for s in d["samples"][1:5])+"。"
    else:
        explanation=f"栈限制{d['condition']['limit_kib']} KiB，最后采样深度{d['samples'][-1]['count']}，子进程终止信号{d['outcome']['signal']}；父进程保存了退出状态。"
    return [dict(rule="group3",confidence="confirmed",title=TITLES[suite],explanation=explanation,
                 evidence=[{"case_id":case["id"],"artifacts":case["artifacts"],"checks":case["validation"]["checks"]}],
                 limitations=("系统调用仅统计动作标记之间的 brk/mmap/munmap/mremap；包含返回值和原始行号。相关 VMA 按地址范围去重，指标包含管理信息及同区其他对象。释放后只查原地址范围，不读写旧指针；保留映射不等于泄漏。" if suite=="sequence" else "映射指标包含整个区域；栈深度为最后采样点。缺页数受分配器、大页与采样影响，不按一写一次缺页推断。"))]
