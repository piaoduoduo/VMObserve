"""Run bounded real-Linux experiments and retain unmodified outputs.

Codex-assisted feasibility tooling; not a final contest implementation.
Uses Python standard library and gcc; no privileged kernel settings are changed.
"""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)
compile_result = subprocess.run(
    ["gcc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
     str(ROOT / "memory_probe.c"), "-o", str(ROOT / "memory_probe")],
    text=True, capture_output=True, timeout=30,
)
(OUT / "compile.log").write_text(compile_result.stdout + compile_result.stderr)
compile_result.check_returncode()
all_samples, verdicts = [], []
for mib in (16, 64):
    for repeat in range(1, 4):
        name = f"{mib}MiB-run{repeat}"
        run = subprocess.run([str(ROOT / "memory_probe"), str(mib)],
                             text=True, capture_output=True, timeout=20)
        (OUT / f"{name}.jsonl").write_text(run.stdout)
        (OUT / f"{name}.smaps.txt").write_text(run.stderr)
        run.check_returncode()
        records = [json.loads(line) for line in run.stdout.splitlines()]
        environment = next(r for r in records if r["kind"] == "environment")
        samples = {(r["phase"], r["role"]): r for r in records if r["kind"] == "sample"}
        def sample(phase, role="parent"):
            return samples[(phase, role)]
        size = mib * 1024
        pages = size * 1024 // environment["page_bytes"]
        checks = {
            "all_eight_snapshots": len(samples) == 8,
            "no_hugepages_or_swap": all(s["huge_kib"] == 0 and s["swap_kib"] == 0 for s in samples.values()),
            "untouched_no_resident_private_pages": sample("untouched")["rss_kib"] == 0,
            "read_zero_without_private_allocation": sample("read_all")["rss_kib"] == 0 and sample("read_all")["private_dirty_kib"] == 0,
            "quarter_write_allocates_quarter": sample("write_quarter")["rss_kib"] == size // 4,
            "full_write_allocates_full": sample("write_all")["rss_kib"] == size,
            "fork_rss_double_counts_shared_pages": sum(sample("fork_shared", r)["rss_kib"] for r in ("parent", "child")) == 2 * size,
            "fork_combined_pss_equals_original": sum(sample("fork_shared", r)["pss_kib"] for r in ("parent", "child")) == size,
            "cow_combined_pss_increases_quarter": sum(sample("child_write_quarter", r)["pss_kib"] for r in ("parent", "child")) == 5 * size // 4,
            "cow_private_dirty_quarter_in_each": all(sample("child_write_quarter", r)["private_dirty_kib"] == size // 4 for r in ("parent", "child")),
            "parent_child_values_isolated": next(r for r in records if r["kind"] == "isolation")["ok"],
            "no_major_faults": all(s["action_major"] == 0 for s in samples.values()),
        }
        # getrusage is process-wide; allow a few faults outside the target VMA.
        # Fault deltas are supporting evidence, not exact per-page event tracing.
        for phase, role, expected in (("read_all", "parent", pages),
                                      ("write_quarter", "parent", pages // 4),
                                      ("write_all", "parent", 3 * pages // 4),
                                      ("child_write_quarter", "child", pages // 4)):
            checks[f"faults_{phase}"] = abs(sample(phase, role)["action_minor"] - expected) <= 8
        for s in samples.values():
            all_samples.append({"run": name, **s})
        verdicts.append({"run": name, "environment": environment, "checks": checks,
                         "passed": all(checks.values())})

with (OUT / "samples.csv").open("w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=all_samples[0].keys())
    writer.writeheader()
    writer.writerows(all_samples)
summary = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "source_sha256": hashlib.sha256((ROOT / "memory_probe.c").read_bytes()).hexdigest(),
    "compiler": subprocess.check_output(["gcc", "--version"], text=True).splitlines()[0],
    "scope": "WSL2 Ubuntu feasibility only; target openEuler not yet tested",
    "runs": verdicts,
    "all_passed": all(v["passed"] for v in verdicts),
}
(OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
sys.exit(0 if summary["all_passed"] else 1)
