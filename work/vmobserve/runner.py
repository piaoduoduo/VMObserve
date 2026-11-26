"""The only execution pipeline: plan -> snapshot -> compile -> collect -> diagnose."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import sys

from . import SCHEMA_VERSION, __version__
from .common import digest, execute, read_json, run_id, timestamp, write_json
from .cow import COW_CHOICES, cow_fractions
from .diagnosis import diagnose
from .evidence import parse_case, validate_measurements
from .pagemap import cap_sys_admin
from .replay import recorded_environment
from . import group3, group4, systems

WORK = Path(__file__).resolve().parents[1]
SOURCES = {"baseline": "proj5-memory-pilot/memory_probe.c", "thp": "proj5-round2/thp_probe.c", "course": "proj5-course/allocator_probe.c", "layout": "proj5-course/layout_probe.c"}

SOURCES.update({"link-dynamic": "proj5-course/group3_link.c", "link-static": "proj5-course/group3_link.c",
                "sequence": "proj5-course/group3_sequence.c", "demand512": "proj5-course/group3_demand.c",
                "stack": "proj5-course/group3_stack.c"})
SOURCES.update(group4.SOURCES)
SOURCES.update(systems.SUITES)

def read_optional(path):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None


def environment():
    release = read_optional("/etc/os-release")
    parsed = {}
    for line in (release or "").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            parsed[key] = value.strip('"')
    thp = Path("/sys/kernel/mm/transparent_hugepage")
    return {"system": platform.system(), "kernel": platform.release(), "machine": platform.machine(),
            "effective_uid": os.geteuid() if hasattr(os, "geteuid") else None,
            "cap_sys_admin": cap_sys_admin(read_optional("/proc/self/status")),
            "os_release": release, "distribution": parsed, "python": platform.python_version(),
            "libc": list(platform.libc_ver()),
            "allocator_environment": {key: os.environ.get(key) for key in ("GLIBC_TUNABLES", "MALLOC_MMAP_THRESHOLD_", "MALLOC_TRIM_THRESHOLD_", "MALLOC_PERTURB_", "LD_PRELOAD")},
            "page_bytes": os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else None,
            "thp_enabled": read_optional(thp / "enabled"), "thp_defrag": read_optional(thp / "defrag"),
            "pmd_size": read_optional(thp / "hpage_pmd_size"),
            "thp_sizes": {p.parent.name: read_optional(p) for p in thp.glob("hugepages-*/enabled")},
            "meminfo": read_optional("/proc/meminfo"), "captured_at": timestamp(),
            "execution_context": os.environ.get("VMOBSERVE_CONTEXT", "linux-local" if platform.system() == "Linux" else "unsupported-host")}


def source_files():
    files = [WORK / "run_all.py", WORK / "launch.py", *(WORK / name for name in SOURCES.values())]
    files += sorted((WORK / "common").glob("*.h"))
    files += sorted((WORK / "proj5-course").glob("*.h"))
    files += sorted((WORK / "lessons").glob("*/*"))
    files += sorted((WORK / "vmobserve").glob("*.py"))
    files += sorted((WORK / "vmobserve/doctor").glob("*.py"))
    files += sorted((WORK / "vmobserve/web").glob("*"))
    files += [WORK / "package_sources.py", WORK / "vm.ps1"]
    files += sorted((WORK / "openeuler-vm").glob("*.sh"))
    files += [p for p in (WORK / "course-labs/group4").rglob("*") if p.is_file() and p.suffix in (".c", ".h", ".sh", ".py", ".md")]
    return files


def plan_cases(args):
    if args.suite == "demand512-thp":
        return group3.demand_thp_plan(args.repeats, args.thp_process)
    if args.suite == "systems":
        return systems.plan(args.repeats, args.lab)
    cases = group3.plan(args.repeats) if args.suite == "group3" else group4.plan(args.repeats, args.group4_task) if args.suite == "group4" else []
    if args.suite in ("sequence", "demand512", "stack"):
        cases = [c for c in group3.plan(args.repeats) if c["suite"] == args.suite]
    if args.suite in ("all", "layout", "group3"):
        for repeat in range(1, args.repeats + 1):
            cases.append({"id": f"layout-{repeat}", "suite": "layout",
                          "parameters": {"repeat": repeat}, "arguments": []})
    if args.suite in ("all", "course"):
        implementation = getattr(args, "course_code", "reference")
        for kib in (1, 256, 1024, 16384):
            for repeat in range(1, args.repeats + 1):
                cases.append({"id": f"course-{kib}KiB-{repeat}" + ("-student" if implementation == "student" else ""), "suite": "course",
                              "parameters": {"requested_kib": kib, "repeat": repeat, "course_code": implementation},
                              "arguments": [str(kib)]})
    if args.suite in ("all", "baseline"):
        sizes = (args.baseline_mib,) if args.baseline_mib else (16, 64)
        for mib in sizes:
            for repeat in range(1, args.repeats + 1):
                for fraction in cow_fractions(args.cow_fraction):
                    suffix = "" if fraction == "1/4" else "-cow-" + fraction.replace("/", "_")
                    cases.append({"id": f"baseline-{mib}MiB-{repeat}{suffix}", "suite": "baseline",
                                  "parameters": {"mib": mib, "repeat": repeat, "cow_fraction": fraction},
                                  "arguments": [str(mib), fraction]})
    if args.suite in ("all", "thp"):
        for pattern in ("sparse", "full") if args.pattern == "all" else (args.pattern,):
            for repeat in range(1, args.repeats + 1):
                modes = ("off", "on") if repeat % 2 else ("on", "off")
                for mode in modes if args.thp == "both" else (args.thp,):
                    policy = getattr(args, "thp_process", "inherit")
                    policies = ("allow", "disable") if repeat % 2 else ("disable", "allow")
                    for process in policies if policy == "pair" else (policy,):
                        suffix = "" if process == "inherit" else "-" + process
                        cases.append({"id": f"thp-{pattern}-{mode}-{repeat}{suffix}", "suite": "thp",
                                      "parameters": {"pattern": pattern, "thp": mode, "repeat": repeat, "process_thp": process},
                                      "arguments": [mode, pattern, process]})
    return cases


def compare_thp_environment(parent, current):
    keys = ("kernel", "machine", "os_release", "execution_context", "page_bytes",
            "pmd_size", "thp_enabled", "thp_defrag", "thp_sizes")
    missing = [k for k in keys if parent.get(k) is None or current.get(k) is None]
    changes = {k: {"parent": parent[k], "current": current[k]} for k in keys
               if k not in missing and parent[k] != current[k]}
    status = "cross_environment" if changes else "unknown" if missing else "matched_conditions"
    return {"status": status, "checked": list(keys), "differences": changes, "missing": missing}


def collection_environment_issue(env, require_openeuler):
    if env["system"] != "Linux":
        return "Experiments require Linux; Windows supports replay/export only."
    if require_openeuler and (env["distribution"].get("ID", "").lower() != "openeuler" or "microsoft" in env["kernel"].lower()):
        return "Target mismatch: real openEuler userland and kernel required."
    if read_optional("/proc/self/smaps") is None:
        return "Current process smaps is not readable."
    return None


def check_collection(args):
    env = environment()
    issue = collection_environment_issue(env, args.require_openeuler)
    suites = {"thp"} if args.recheck_from else {case["suite"] for case in plan_cases(args)}
    tool_names = []
    if suites - {"io"}:
        tool_names.append(args.compiler)
    if "sequence" in suites:
        tool_names.append("strace")
    if suites & {"link-static", "link-dynamic"}:
        tool_names.extend(name for name, _ in group3.LINK_INSPECTORS)
    tools = {name: shutil.which(name) for name in tool_names}
    missing = [name for name, path in tools.items() if path is None]
    issues = [issue] if issue else []
    if "thp" in suites and env["system"] == "Linux" and env["pmd_size"] is None:
        issues.append("PMD THP size unavailable.")
    return {
        "status": "blocked" if issues or missing else "ready", "mode": "collection_preflight",
        "system": env["system"], "kernel": env["kernel"], "suite": args.suite,
        "planned_suites": sorted(suites), "tools": tools, "missing_tools": missing, "issues": issues,
    }


def run(args):
    out = args.output.resolve() / run_id()
    out.mkdir(parents=True, exist_ok=False)
    report = {"schema_version": SCHEMA_VERSION, "tool_version": __version__, "run_id": out.name,
              "data_origin": "real_execution", "view_mode": "execution_record", "status": "running",
              "started_at": timestamp(), "environment": environment(), "sources": {}, "artifacts": {},
              "builds": {}, "cases": [], "error": None, "related_run": None,
              "scope": "Mechanism/function verification; no hardware performance inference, especially under QEMU TCG."}
    def checkpoint():
        write_json(out / "report.json", report)
    checkpoint()
    print(f"RUN_DIRECTORY={out}", flush=True)
    try:
        if args.recheck_from:
            previous = read_json(args.recheck_from / "report.json")
            if previous.get("schema_version") != SCHEMA_VERSION or previous.get("data_origin") != "real_execution" or not any(c.get("suite") == "thp" for c in previous.get("cases", [])):
                raise ValueError("recheck requires a v1 real THP execution record")
            parent_env, conflict = recorded_environment(args.recheck_from, previous)
            if conflict:
                raise ValueError(conflict)
            report["related_run"] = {"run_id": previous["run_id"], "report_sha256": digest(args.recheck_from / "report.json"),
                                     "environment_comparison": compare_thp_environment(parent_env, report["environment"]),
                                     "recipe": "thp_" + (args.pattern if args.pattern != "all" else "sparse") + ("_process_pair" if args.recheck_kind == "process" else "_pair"), "relation": "new_controlled_recheck"}
            args.suite, args.pattern, args.thp = "thp", args.pattern if args.pattern != "all" else "sparse", "both"
            if args.recheck_kind == "process":
                args.thp, args.thp_process = "on", "pair"
        for src in source_files():
            relative = src.relative_to(WORK)
            target = out / "source" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, target)
            try:
                shutil.copystat(src, target)
            except PermissionError:
                # WSL's Windows mount can allow the copy but reject restoring mtime.
                # The source manifest records a hash of the copied bytes.
                pass
            report["sources"][relative.as_posix()] = digest(target)
        write_json(out / "environment.json", report["environment"])
        env = report["environment"]
        reason = collection_environment_issue(env, args.require_openeuler)
        if reason:
            report.update(status="unsupported", error={"code": "preflight_failed", "message": reason})
            return 2, out
        planned = plan_cases(args)
        report["plan"] = planned
        report["cases"] = [{**c, "status": "not_run", "validation": {"status": "insufficient_evidence", "checks": []}, "data": None} for c in planned]
        checkpoint()
        (out / "build").mkdir()
        report["compiler_check"] = execute([args.compiler, "--version"], out / "build/compiler.stdout.log", out / "build/compiler.stderr.log", 10)
        if any(c["suite"] == "g4-fork" for c in planned):
            report["builds"]["child_prog"] = group4.build_child(out, args.compiler, execute)
            if report["builds"]["child_prog"]["status"] != "completed":
                raise ValueError("child_prog compilation failed; see build logs")
        if any(c["suite"] == "sequence" for c in planned):
            report["trace_tool"] = execute(["strace", "--version"], out / "build/strace.stdout.log", out / "build/strace.stderr.log", 10)
            report["trace_tool"]["version"] = read_optional(out / "build/strace.stdout.log")
        for suite in dict.fromkeys(c["suite"] for c in planned):
            command = [args.compiler, "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                       str(out / "source" / SOURCES[suite]), "-o", str(out / "build" / suite)]
            if suite in group4.SOURCES:
                command += ["-pthread", "-g"]
            if suite == "sync":
                command.append("-pthread")
            if suite == "io":
                command = [sys.executable, "-m", "py_compile", str(out / "source" / SOURCES[suite])]
            if suite == "course" and args.course_code == "student":
                command += ['-DVMOBSERVE_ACCESS_HEADER="../lessons/demand/student.h"', '-DVMOBSERVE_ACCESS_NAME="student"']
            if suite == "layout":
                command += ["-fPIE", "-pie", "-ldl"]
            if suite == "link-dynamic":
                command += ["-fPIE", "-pie"]
            elif suite == "link-static":
                command += ["-static", "-no-pie", '-DLINK_MODE="static"']
            elif suite == "stack":
                command += ["-O0", "-fno-optimize-sibling-calls", "-fno-omit-frame-pointer"]
            build = execute(command, out / "build" / f"{suite}.stdout.log", out / "build" / f"{suite}.stderr.log", 30)
            report["builds"][suite] = build
            for case in (c for c in report["cases"] if c["suite"] == suite):
                if build["status"] != "completed":
                    case.update(error={"code": "compile_failed", "message": "See build logs", "build_status": build["status"]})
                    continue
                if suite == "thp" and env["pmd_size"] is None:
                    case.update(status="unsupported", error={"code": "thp_unavailable", "message": "PMD THP size unavailable"})
                    continue
                if suite == "sequence" and report["trace_tool"]["status"] != "completed":
                    case.update(status="unsupported", error={"code": "trace_tool_unavailable", "message": "strace version check failed; see build/strace.*.log"})
                    continue
                folder = out / "cases" / case["id"]
                folder.mkdir(parents=True)
                stream = "stderr" if suite in systems.SUITES else "kernel" if suite in group4.SOURCES else "smaps"
                raw, smaps = folder / "stdout.jsonl", folder / ("stderr.txt" if stream == "stderr" else stream + ".stderr.txt")
                case["artifacts"] = {"jsonl": raw.relative_to(out).as_posix(), stream: smaps.relative_to(out).as_posix()}
                case["status"] = "running"
                checkpoint()
                command = group3.prepare(case, folder, out / "build" / suite, execute, args.timeout) if suite in group3.SUITES else group4.command(case, out / "build" / suite) if suite in group4.SOURCES else [str(out / "build" / suite), *case["arguments"]]
                if suite == "io":
                    command = [sys.executable, str(out / "source" / SOURCES[suite]), *case["arguments"]]
                case["execution"] = execute(command, raw, smaps, args.timeout)
                case["status"] = case["execution"]["status"]
                case["error"] = case["execution"]["error"]
                if case["status"] == "completed":
                    try:
                        case["data"] = parse_case(raw, smaps, suite, case["parameters"])
                        case["validation"] = validate_measurements(suite, case["data"])
                        case["integrity"] = "verified"
                    except (ValueError, KeyError, TypeError, OSError) as exc:
                        case.update(status="failed", error={"code": "evidence_invalid", "message": str(exc)}, integrity="failed")
                for relative in case["artifacts"].values():
                    p = out / relative
                    if p.is_file():
                        report["artifacts"][relative] = digest(p)
                checkpoint()
                if case["status"] == "cancelled":
                    report["status"] = "cancelled"
                    return 130, out
        statuses = [c["status"] for c in report["cases"]]
        validations = [c["validation"]["status"] for c in report["cases"]]
        if all(s == "completed" for s in statuses) and "failed" not in validations:
            report["status"] = "completed_with_deviations" if "deviation" in validations else "completed"
        else:
            report["status"] = "failed"
        return (0 if report["status"] == "completed" else 3 if report["status"] == "completed_with_deviations" else 1), out
    except KeyboardInterrupt:
        report.update(status="cancelled", error={"code": "interrupted", "message": "Interrupted; partial evidence retained"})
        return 130, out
    except Exception as exc:
        report.update(status="failed", error={"code": "runner_error", "message": f"{type(exc).__name__}: {exc}"})
        return 1, out
    finally:
        report["finished_at"] = timestamp()
        report["completed"] = report["status"] in ("completed", "completed_with_deviations")
        report["diagnosis"] = diagnose(report)
        for p in (out / "environment.json", *(out / "build").glob("*.log")):
            if p.exists():
                report["artifacts"][p.relative_to(out).as_posix()] = digest(p)
        checkpoint()
        print(f"STATUS={report['status']}", flush=True)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--require-openeuler", action="store_true")
    p.add_argument("--output", type=Path, default=WORK / "runs")
    p.add_argument("--suite", choices=("all", "baseline", "thp", "course", "layout", "group3", "group4", "sequence", "demand512", "demand512-thp", "stack", "systems"), default="all")
    p.add_argument("--baseline-mib", type=int, choices=(16, 64))
    p.add_argument("--lab", choices=("all", *systems.LABS), default="all")
    p.add_argument("--group4-task", choices=("all", "4.1", "4.2", "4.3", "4.4"), default="all")
    p.add_argument("--repeats", type=int, choices=range(1, 6), default=3)
    p.add_argument("--cow-fraction", choices=COW_CHOICES, default="1/4",
                   help="child write fraction; all runs 0, 1/8, 1/4, 1/2, 1 (baseline only)")
    p.add_argument("--pattern", choices=("all", "sparse", "full"), default="all")
    p.add_argument("--thp", choices=("both", "on", "off"), default="both")
    p.add_argument("--thp-process", choices=("inherit", "allow", "disable", "pair"), default="inherit")
    p.add_argument("--course-code", choices=("reference", "student"), default="reference")
    p.add_argument("--recheck-kind", choices=("advice", "process"), default="advice")
    p.add_argument("--timeout", type=float, default=20)
    p.add_argument("--compiler", default="gcc")
    p.add_argument("--check-tools", action="store_true", help="report collection tool paths and environment without running experiments")
    p.add_argument("--recheck-from", type=Path, help="v1 real run directory; execute a new sparse THP off/on control")
    return p


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    if not 0 < args.timeout <= 120:
        p.error("timeout must be > 0 and <= 120 seconds")
    if args.suite == "demand512-thp" and args.thp_process == "pair":
        p.error("use --thp-process allow or disable for separate demand512-thp records")
    if args.check_tools:
        result = check_collection(args)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "ready" else 2
    code, _ = run(args)
    return code
