"""Contract grading and cross-device verification for the local C exercise."""
from collections import Counter
import json

from .common import execute
from .replay import load_run, safe_child

CONTRACT = "lessons/demand/contract.c"
STUDENT = "lessons/demand/student.h"
PROBE = "proj5-course/allocator_probe.c"
CONTRACT_LOG = "build/student-contract.stdout.log"
CONTRACT_CASES = {
    "empty_stage": (4096, 1, 1),
    "first_position": (4096, 0, 1),
    "extend_prefix": (4096, 1, 3),
    "different_stride": (65536, 2, 5),
}
CONDITIONS = ("system", "kernel", "machine", "libc", "page_bytes", "execution_context",
              "distribution", "allocator_environment", "thp_enabled", "thp_defrag", "pmd_size", "thp_sizes")


def contract_checks(text):
    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    if len(rows) != len(CONTRACT_CASES):
        raise ValueError("incomplete student contract checks")
    for row, (name, scenario) in zip(rows, CONTRACT_CASES.items()):
        if (row["check"] != name or tuple(row[key] for key in ("stride", "previous", "limit")) != scenario
                or type(row["memory_ok"]) is not bool or type(row["returned"]) is not int):
            raise ValueError("student contract data does not match the planned checks")
        row["status"] = "passed" if row["memory_ok"] and row["returned"] == row["limit"] else "failed"
    return rows


def grade_contract(folder, compiler, timeout):
    build = folder / "build"
    binary = build / "student-contract"
    source = folder / "source" / CONTRACT
    compile_log = build / "student-contract-compile.stderr.log"
    result = execute([compiler, "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", str(source), "-o", str(binary)],
                     build / "student-contract-compile.stdout.log", compile_log, 30)
    if result["status"] != "completed":
        status = "cancelled" if result["status"] == "cancelled" else "compile_failed"
        diagnostics = compile_log.read_text(encoding="utf-8", errors="replace")[-4000:]
        return {"status": status, "checks": [], "diagnostics": diagnostics or result["error"]["message"]}
    output = folder / CONTRACT_LOG
    errors = build / "student-contract.stderr.log"
    result = execute([str(binary)], output, errors, min(timeout, 10))
    if result["status"] != "completed":
        diagnostics = errors.read_text(encoding="utf-8", errors="replace")[-4000:]
        return {"status": result["status"], "checks": [], "diagnostics": diagnostics or result["error"]["message"]}
    try:
        checks = contract_checks(output.read_text(encoding="utf-8"))
    except (ValueError, TypeError, KeyError) as exc:
        return {"status": "failed", "checks": [], "evidence": CONTRACT_LOG, "diagnostics": str(exc)}
    return {"status": "passed" if all(row["status"] == "passed" for row in checks) else "failed",
            "checks": checks, "evidence": CONTRACT_LOG}


def verify_student_run(folder):
    folder = folder.resolve()
    report = load_run(folder)
    if (report["data_origin"] != "real_execution" or report["integrity"]["status"] != "verified"
            or report["status"] != "completed"):
        raise ValueError("student run is incomplete or has unverified origin or artifacts")
    if not report.get("student_contract"):
        raise ValueError("this run predates stage-based student grading")
    if any(type(case["parameters"].get("repeat")) is not int or
           not 1 <= case["parameters"]["repeat"] <= 5 for case in report["cases"]):
        raise ValueError("student repeat count is outside the supported range")
    sources = report["sources"]
    if not all(sources.get(path) for path in (STUDENT, CONTRACT, PROBE)):
        raise ValueError("student source, grader or measurement probe is missing")
    if CONTRACT_LOG not in report["artifacts"]:
        raise ValueError("student contract evidence is missing")
    checks = contract_checks(safe_child(folder, CONTRACT_LOG).read_text(encoding="utf-8"))
    if any(row["status"] != "passed" for row in checks):
        raise ValueError("student contract checks did not pass")
    cases = report["cases"]
    if not cases or any(case["suite"] != "course" or case["parameters"].get("course_code") != "student"
                        or case["status"] != "completed" or case["validation"]["status"] != "passed" for case in cases):
        raise ValueError("one or more student measurement cases did not pass")
    repeats = max(case["parameters"]["repeat"] for case in cases)
    expected = Counter((size, repeat) for size in (1, 256, 1024, 16384) for repeat in range(1, repeats + 1))
    actual = Counter((case["parameters"]["requested_kib"], case["parameters"]["repeat"]) for case in cases)
    if not expected or actual != expected:
        raise ValueError("student run does not contain the complete exercise matrix")
    environment = {key: report["environment"].get(key) for key in CONDITIONS}
    compiler_log = "build/compiler.stdout.log"
    compiler = None
    if compiler_log in report["artifacts"]:
        lines = safe_child(folder, compiler_log).read_text(encoding="utf-8", errors="replace").splitlines()
        compiler = lines[0] if lines else None
    return {"run_id": report["run_id"], "report_sha256": report["original_report_sha256"],
            "source_sha256": {path: sources[path] for path in (STUDENT, CONTRACT, PROBE)},
            "environment": environment, "compiler": compiler, "contract_checks": len(checks),
            "measurement_cases": len(cases), "repeats": repeats}


def compare_student_runs(left, right):
    different = [key for key in CONDITIONS if left["environment"].get(key) != right["environment"].get(key)]
    unrecorded = [key for key in CONDITIONS if left["environment"].get(key) is None or right["environment"].get(key) is None]
    return {"environment_differences": different, "environment_unrecorded": unrecorded,
            "recorded_environment_matches": not different and not unrecorded,
            "same_compiler": left["compiler"] == right["compiler"] if left["compiler"] and right["compiler"] else None,
            "same_sources": left["source_sha256"] == right["source_sha256"],
            "same_case_matrix": left["repeats"] == right["repeats"],
            "same_run": left["report_sha256"] == right["report_sha256"]}
