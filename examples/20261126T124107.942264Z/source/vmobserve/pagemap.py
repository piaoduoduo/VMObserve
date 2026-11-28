"""Reconcile the probes' fixed page samples with raw pagemap words and program actions."""
import re

PFN_MASK = (1 << 55) - 1
FLAG_BITS = {"present": 63, "swapped": 62, "file_shared": 61, "soft_dirty": 55}

def cap_sys_admin(proc_status):
    caps = re.search(r"^CapEff:\s*([0-9a-fA-F]+)$", proc_status or "", re.M)
    return bool(int(caps[1], 16) & (1 << 21)) if caps else None


def _require(condition, detail):
    if not condition:
        raise ValueError("pagemap: " + detail)


def _sampling_plan(suite, condition, sample, address):
    page = condition["page_bytes"]
    _require(type(page) is int and page > 0, "invalid base page size")
    phase = sample["phase"]
    if suite == "baseline":
        size = condition["mib"] * 1024 ** 2
        stride = {"write_all": 1, "write_quarter": 4,
                  "child_write": condition["cow_stride_pages"]}.get(phase, 0)
        written = {i: bool(stride and i % stride == 0) for i in range(8)}
    elif suite == "thp":
        size = condition["region_bytes"]
        block = condition["huge_bytes"] // page
        indices = (0, 1, block // 2, block - 1, block, block + 1)
        written = {i: phase == "after_write" and i * page % condition["stride_bytes"] == 0 for i in indices}
    else:
        size, stride = condition["bytes"], condition["stride"]
        n = size // page
        indices = (0, 1, 2 * 1024 ** 2 // page - 1, n//4 - 1, n//4, n//2 - 1, n//2, n - 1)
        written = {}
        offset = address % page
        for i in indices:
            first_write = max(0, (i * page - offset + stride - 1) // stride)
            written[i] = first_write < sample["count"] and offset + first_write * stride < (i + 1) * page
    base = address - address % page
    return base, (address - base + size + page - 1) // page, written


def _verify(event, sample, condition, suite, address):
    pid = sample["pid"]
    sources = {f"/proc/{pid}/pagemap"}
    if sample["role"] == "parent":
        sources.add("/proc/self/pagemap")
    _require(event["source"] in sources, "source does not match sampled process")
    page = event["page_bytes"]
    _require(type(page) is int and page == condition["page_bytes"], "wrong page size")
    base, pages, written = _sampling_plan(suite, condition, sample, address)
    status, access, entries = event["status"], event["pfn_access"], event["entries"]
    live = sample["phase"] not in ("before_alloc", "freed")
    _require(status in (("available", "unavailable", "error") if live else ("unmapped",)), "wrong capture status")
    _require(event["region_start"] == (format(base, "x") if live else None)
             and event["region_pages"] == (pages if live else None), "region differs from experiment mapping")
    _require(isinstance(entries, list) and type(event["sampled_count"]) is int
             and event["sampled_count"] == len(entries), "wrong sample count")
    _require([e["page_index"] for e in entries] == (list(written) if status == "available" else []),
             "missing, duplicate or unexpected sentinel page")
    admin = event.get("cap_sys_admin")
    _require(admin is None or type(admin) is bool, "invalid capability bit")
    frames, swapped = [], 0
    for entry in entries:
        i = entry["page_index"]
        _require(type(i) is int and 0 <= i < pages and entry["vaddr"] == format(base + i * page, "x"),
                 "sentinel address differs from page index")
        _require(entry.get("expected_written") is written[i], "write mask differs from program action")
        word = entry["raw_hex"]
        _require(isinstance(word, str) and re.fullmatch(r"[0-9a-f]{16}", word), "invalid 64-bit raw word")
        raw = int(word, 16)
        for key, bit in FLAG_BITS.items():
            _require(entry[key] is bool((raw >> bit) & 1), key + " differs from raw word")
        _require(not (entry["present"] and entry["swapped"]), "present and swapped simultaneously")
        swapped += entry["swapped"]
        frame = raw & PFN_MASK
        if entry["present"]:
            frames.append(frame)
        if entry["present"] and access == "visible":
            _require(frame > 0 and entry["pfn"] == format(frame, "x"), "PFN differs from raw word")
        else:
            _require(entry["pfn"] is None, "unavailable PFN must be null")
    for key, value in (("present_count", len(frames)), ("swapped_count", swapped)):
        _require(type(event[key]) is int and event[key] == value, "incorrect " + key)
    if not frames:
        _require(access == "not_applicable", "no present page has a PFN")
    elif access == "visible":
        _require(admin is not False and all(frames), "PFN visibility conflicts with capability or raw word")
    else:
        _require(access == "masked" and (admin is None or not all(frames)), "incorrect masked status")
        if admin is False:
            _require(not any(frames) and event.get("reason") == "requires_cap_sys_admin",
                     "nonprivileged PFN mask disagrees with raw evidence")
    if status != "available" or access == "masked":
        _require(bool(event.get("reason")), "missing reason")


def attach_pagemaps(records, samples, condition, suite, addresses):
    """Old probes have neither a version marker nor events. New probes emit one event per snapshot."""
    events = [r for r in records if r["kind"] == "pagemap"]
    _require(not any("pagemap" in s for s in samples), "expected separate raw events")
    if not events and "pagemap_version" not in condition:
        return
    if "pagemap_version" in condition:
        _require(type(condition["pagemap_version"]) is int and condition["pagemap_version"] == 1,
                 "unknown capture version")
    def identity(r):
        return (r["phase"], r["role"], r["pid"])
    by_key = {identity(r): r for r in events}
    _require(len(by_key) == len(events) == len(samples) and set(by_key) == {identity(s) for s in samples},
             "phase, role or PID missing or duplicated")
    if suite == "baseline":
        parent = {s["pid"] for s in samples if s["role"] == "parent"}
        child = {s["pid"] for s in samples if s["role"] == "child"}
        _require(len(parent) == len(child) == 1 and parent != child and len(set(addresses)) == 1,
                 "parent and child must describe the same fork region in distinct processes")
    for sample, address in zip(samples, addresses, strict=True):
        event = by_key[identity(sample)]
        _verify(event, sample, condition, suite, address)
        sample["pagemap"] = {k: v for k, v in event.items() if k not in ("kind", "phase", "role", "pid")}
