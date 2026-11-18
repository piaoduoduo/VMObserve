"""Associate the three malloc actions with raw trace lines and unique VMAs."""
import re
from .smaps import FIELDS

NAMES = ("malloc_1", "malloc_2", "malloc_3", "free_all")
PHASES = ("alloc_1KiB", "alloc_256KiB", "alloc_1MiB", "freed")
MARKER = re.compile(r'^write\(2, "ACTION (\w+) (BEGIN|END)\\n(\\0)?", (\d+)\)\s+=\s+(\d+)$')
MEMORY = re.compile(r'^(brk|mmap|munmap|mremap)\(')


def trace_actions(trace):
    """Accept complete ordered markers; observer/startup calls stay outside."""
    lines = trace.splitlines()
    markers = []
    for number, line in enumerate(lines, 1):
        if line.startswith('write(2, "ACTION '):
            match = MARKER.fullmatch(line)
            if not match:
                raise ValueError(f"incomplete syscall action marker at line {number}")
            name, edge, nul, requested, written = match.groups()
            length = len(f"ACTION {name} {edge}\n") + bool(nul)
            if int(requested) != length or int(written) != length:
                raise ValueError(f"incomplete marker write at line {number}")
            markers.append((name, edge, number))
    expected = [(name, edge) for name in NAMES for edge in ("BEGIN", "END")]
    if [(name, edge) for name, edge, _ in markers] != expected:
        raise ValueError("missing, duplicate or out-of-order syscall action markers")
    actions = []
    for i, name in enumerate(NAMES):
        begin, end = markers[2*i][2], markers[2*i+1][2]
        events = []
        for number in range(begin+1, end):
            line = lines[number-1]
            call = MEMORY.match(line)
            if call or re.match(r'^<\.\.\. (brk|mmap|munmap|mremap) resumed>', line):
                result = re.search(r'\)\s+=\s+(\S+)(?:\s+.*)?$', line)
                if not call or not result or "<unfinished ...>" in line:
                    raise ValueError(f"incomplete memory syscall at line {number}")
                events.append(dict(line=number, text=line, name=call[1], result=result[1], success=result[1] != "-1"))
        actions.append(dict(action=name, phase=PHASES[i], begin_line=begin, end_line=end,
                            events=events, syscalls=[e["text"] for e in events]))
    return actions


def attach_mappings(samples, mappings, addresses, sizes):
    """A VMA can contain several malloc blocks: sum each VMA once per stage."""
    for i, sample in enumerate(samples):
        blocks, unique = [], {}
        for j, address in enumerate(addresses[:min(i, 3)]):
            start, end = int(address, 16), int(address, 16) + sizes[j]
            related = [m for m in mappings[i] if int(m["start"], 16) < end and int(m["end"], 16) > start]
            covered = start
            for mapping in related:
                if int(mapping["start"], 16) > covered:
                    break
                covered = max(covered, int(mapping["end"], 16))
            alive = i != 4
            if alive and covered < end:
                raise ValueError("live allocation range not fully covered by smaps")
            blocks.append(dict(address=address, requested_bytes=sizes[j], alive=alive,
                               mapping=next((m for m in related if int(m["start"],16) <= start < int(m["end"],16)), None),
                               mappings=related))
            unique.update({(m["start"], m["end"]): m for m in related})
        sample["blocks"] = blocks
        sample["related_vma_count"] = len(unique)
        sample["related_scope"] = "whole_vmas_intersecting_live_or_former_blocks"
        for field in FIELDS:
            sample["related_" + field] = sum(m[field] for m in unique.values())


def describe_allocations(actions, samples, addresses, sizes):
    for i, action in enumerate(actions[:3]):
        start, end = int(addresses[i], 16), int(addresses[i], 16) + sizes[i]
        action.update(requested_bytes=sizes[i], returned_address=addresses[i], allocation_source="unresolved")
        for event in action["events"]:
            if not event["success"]:
                continue
            if event["name"] == "mmap" and event["result"].startswith("0x"):
                length = re.match(r'mmap\([^,]+, (\d+),', event["text"])
                base = int(event["result"], 16)
                if length and base <= start and end <= base + int(length[1]):
                    action.update(allocation_source="new_mmap_range", source_line=event["line"])
            elif event["name"] == "brk" and event["result"].startswith("0x"):
                old = int(samples[i]["program_break"], 16)
                if old <= start and end <= int(event["result"], 16):
                    action.update(allocation_source="new_brk_range", source_line=event["line"])
        if not action["events"]:
            action["allocation_source"] = "no_memory_syscall"
