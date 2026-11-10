"""The only execution pipeline: plan -> snapshot -> compile -> collect -> diagnose."""
import argparse
import os
from pathlib import Path
import platform
import shutil

from . import SCHEMA_VERSION, __version__
from .common import digest, execute, read_json, run_id, timestamp, write_json
from .diagnosis import diagnose
from .evidence import parse_case, validate_measurements

WORK = Path(__file__).resolve().parents[1]
SOURCES = {"baseline": "proj5-memory-pilot/memory_probe.c", "thp": "proj5-round2/thp_probe.c"}


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
            "os_release": release, "distribution": parsed, "python": platform.python_version(),
            "libc": list(platform.libc_ver()), "page_bytes": os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else None,
            "thp_enabled": read_optional(thp / "enabled"), "thp_defrag": read_optional(thp / "defrag"),
            "pmd_size": read_optional(thp / "hpage_pmd_size"),
            "thp_sizes": {p.parent.name: read_optional(p) for p in thp.glob("hugepages-*/enabled")},
            "meminfo": read_optional("/proc/meminfo"), "captured_at": timestamp(),
            "execution_context": os.environ.get("VMOBSERVE_CONTEXT", "linux-local" if platform.system() == "Linux" else "unsupported-host")}


def source_files():
    files = [WORK / "run_all.py", WORK / "launch.py", *(WORK / name for name in SOURCES.values())]
    files += sorted((WORK / "common").glob("*.h"))
    files += sorted((WORK / "vmobserve").glob("*.py"))
    files += sorted((WORK / "vmobserve/web").glob("*"))
    files += [WORK / "package_sources.py", WORK / "vm.ps1"]
    files += sorted((WORK / "openeuler-vm").glob("*.sh"))
    return files


def plan_cases(args):
    cases = []
    if args.suite in ("all", "baseline"):
        for mib in (16, 64):
            for repeat in range(1, args.repeats + 1):
                cases.append({"id": f"baseline-{mib}MiB-{repeat}", "suite": "baseline",
                              "parameters": {"mib": mib, "repeat": repeat}, "arguments": [str(mib)]})
    if args.suite in ("all", "thp"):
        for pattern in ("sparse", "full") if args.pattern == "all" else (args.pattern,):
            for repeat in range(1, args.repeats + 1):
                modes = ("off", "on") if repeat % 2 else ("on", "off")
                for mode in modes if args.thp == "both" else (args.thp,):
                    cases.append({"id": f"thp-{pattern}-{mode}-{repeat}", "suite": "thp",
                                  "parameters": {"pattern": pattern, "thp": mode, "repeat": repeat},
                                  "arguments": [mode, pattern]})
    return cases


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
            if previous.get("data_origin") != "real_execution" or not any(c.get("suite") == "thp" for c in previous.get("cases", [])):
                raise ValueError("recheck requires a v1 real THP execution record")
            report["related_run"] = {"run_id": previous["run_id"], "report_sha256": digest(args.recheck_from / "report.json"),
                                     "recipe": "thp_" + (args.pattern if args.pattern != "all" else "sparse") + "_pair", "relation": "new_controlled_recheck"}
            args.suite, args.pattern, args.thp = "thp", args.pattern if args.pattern != "all" else "sparse", "both"
        for src in source_files():
            relative = src.relative_to(WORK)
            target = out / "source" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            report["sources"][relative.as_posix()] = digest(target)
        write_json(out / "environment.json", report["environment"])
        env = report["environment"]
        reason = None
        if env["system"] != "Linux":
            reason = "Experiments require Linux; Windows supports replay/export only."
        elif args.require_openeuler and (env["distribution"].get("ID", "").lower() != "openeuler" or "microsoft" in env["kernel"].lower()):
            reason = "Target mismatch: real openEuler userland and kernel required."
        elif read_optional("/proc/self/smaps") is None:
            reason = "Current process smaps is not readable."
        if reason:
            report.update(status="unsupported", error={"code": "preflight_failed", "message": reason})
            return 2, out
        planned = plan_cases(args)
        report["plan"] = planned
        report["cases"] = [{**c, "status": "not_run", "validation": {"status": "insufficient_evidence", "checks": []}, "data": None} for c in planned]
        checkpoint()
        (out / "build").mkdir()
        report["compiler_check"] = execute([args.compiler, "--version"], out / "build/compiler.stdout.log", out / "build/compiler.stderr.log", 10)
        for suite in dict.fromkeys(c["suite"] for c in planned):
            command = [args.compiler, "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                       str(out / "source" / SOURCES[suite]), "-o", str(out / "build" / suite)]
            build = execute(command, out / "build" / f"{suite}.stdout.log", out / "build" / f"{suite}.stderr.log", 30)
            report["builds"][suite] = build
            for case in (c for c in report["cases"] if c["suite"] == suite):
                if build["status"] != "completed":
                    case.update(error={"code": "compile_failed", "message": "See build logs", "build_status": build["status"]})
                    continue
                if suite == "thp" and env["pmd_size"] is None:
                    case.update(status="unsupported", error={"code": "thp_unavailable", "message": "PMD THP size unavailable"})
                    continue
                folder = out / "cases" / case["id"]
                folder.mkdir(parents=True)
                raw, smaps = folder / "stdout.jsonl", folder / "smaps.stderr.txt"
                case["artifacts"] = {"jsonl": raw.relative_to(out).as_posix(), "smaps": smaps.relative_to(out).as_posix()}
                case["status"] = "running"
                checkpoint()
                case["execution"] = execute([str(out / "build" / suite), *case["arguments"]], raw, smaps, args.timeout)
                case["status"] = case["execution"]["status"]
                case["error"] = case["execution"]["error"]
                if case["status"] == "completed":
                    try:
                        case["data"] = parse_case(raw, smaps, suite, case["parameters"])
                        case["validation"] = validate_measurements(suite, case["data"])
                        case["integrity"] = "verified"
                    except (ValueError, KeyError, TypeError, OSError) as exc:
                        case.update(status="failed", error={"code": "evidence_invalid", "message": str(exc)}, integrity="failed")
                for p in (raw, smaps):
                    report["artifacts"][p.relative_to(out).as_posix()] = digest(p)
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
    p.add_argument("--suite", choices=("all", "baseline", "thp"), default="all")
    p.add_argument("--repeats", type=int, choices=range(1, 6), default=3)
    p.add_argument("--pattern", choices=("all", "sparse", "full"), default="all")
    p.add_argument("--thp", choices=("both", "on", "off"), default="both")
    p.add_argument("--timeout", type=float, default=20)
    p.add_argument("--compiler", default="gcc")
    p.add_argument("--recheck-from", type=Path, help="v1 real run directory; execute a new sparse THP off/on control")
    return p


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    if not 0 < args.timeout <= 120:
        p.error("timeout must be > 0 and <= 120 seconds")
    code, _ = run(args)
    return code
