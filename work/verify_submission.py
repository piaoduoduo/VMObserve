"""Verify bundled samples or recheck a downloaded process comparison offline."""
import argparse
import csv
import hashlib
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import platform
import re
import sys
from threading import Thread
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, build_opener

from vmobserve.common import digest
from vmobserve.export import PROCESS_EVIDENCE_SCHEMA, demand_process_evidence
from vmobserve.group3 import DEMAND_PHASES
from vmobserve.replay import load_run, safe_child
from vmobserve.server import Workbench, handler_for
from vmobserve.smaps import parse_mappings

WORK = Path(__file__).resolve().parent
EXAMPLES = WORK.parent / "examples"
RECORD_ROOTS = (EXAMPLES, WORK / "runs", WORK / "openeuler-vm" / "guest-runs")
BASELINE = "20261118T013159.221864Z"
PAIRED = ("20261120T120355.446473Z", "20261120T113225.827429Z")
PROCESS_PAIRED = {"allow": "20261125T110630.221939Z", "disable": "20261125T110657.478995Z"}
REPORT_HASHES = {
    BASELINE: "7471631ce89130bfcf0caef4bacb0ef6de291ce11405d17279d76ac922c880a8",
    PAIRED[0]: "53118ce1664fbc55b7884aac42794065de71a22cee14cd39649b319ec4f9fea0",
    PAIRED[1]: "9d7aa036cd908c7bbd110dc8f4755a594486e0a07d4073a2be3d43bcd5f9110e",
    PROCESS_PAIRED["allow"]: "b36c7e88bfa7f64e7c7013c26f5a3c9961e476a36cb0d90f2a60b942bea5c525",
    PROCESS_PAIRED["disable"]: "7ece2455ac84c941f6a8eb2ae8b1b4c4c3635060987c8e1570cb2737202123ff",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def report_for(get, run):
    report = json.loads(get("report", run))
    require(report["run_id"] == run and report["data_origin"] == "real_execution"
            and report["original_report_sha256"] == REPORT_HASHES[run],
            f"{run}: bundled report identity or SHA-256 mismatch")
    integrity = report["integrity"]
    reason = (integrity.get("errors") or [integrity["status"]])[0]
    require(integrity["status"] == "verified", f"{run}: {reason}")
    return report


def raw_mappings(raw, phase):
    pattern = rf"^BEGIN phase={phase} [^\n]+\n(.*?)^END\s*$"
    snapshots = re.findall(pattern, raw.decode(), re.M | re.S)
    require(len(snapshots) == 1, f"{phase}: expected one smaps snapshot")
    return parse_mappings(snapshots[0])


def verify_sequence(get):
    report = report_for(get, BASELINE)
    case = next(item for item in report["cases"] if item["id"] == "sequence-1")
    require(case["validation"]["status"] == "passed", "sequence-1 did not pass validation")
    phase = "alloc_1MiB"
    sample = next(row for row in case["data"]["samples"] if row["phase"] == phase)
    blocks = [(int(block["address"], 16), block["requested_bytes"]) for block in sample["blocks"]]
    raw = get("evidence", BASELINE, case=case["id"], kind="smaps")
    mappings = [mapping for mapping in raw_mappings(raw, phase) if any(
        int(mapping["start"], 16) < address + size and address < int(mapping["end"], 16)
        for address, size in blocks)]
    rss = [mapping["rss_kib"] for mapping in mappings]
    require(sorted(rss) == [4, 12] and sum(rss) == sample["related_rss_kib"],
            f"sequence-1 {phase}: raw VMA RSS and replay disagree")
    html = get("export", BASELINE, format="html").decode()
    require(f"<td>sequence-1</td><td>{phase}</td><td>parent</td>"
            "<td>相关 VMA 去重合计</td><td>16</td>" in html,
            "sequence-1 HTML is missing the deduplicated RSS")
    return {"run_id": BASELINE, "report_sha256": REPORT_HASHES[BASELINE],
            "case_id": case["id"], "phase": phase, "vma_rss_kib": rss, "rss_kib": sum(rss)}


def csv_rows(payload):
    return list(csv.DictReader(io.StringIO(payload.decode("utf-8-sig"))))


def verify_demand(get, run, process=None):
    report = report_for(get, run)
    general = {(r["case_id"], r["phase"]): r for r in csv_rows(get("export", run, format="csv"))}
    expected_order = [(phase, advice) for phase in DEMAND_PHASES for advice in ("off", "on")]
    cases = {case["id"]: case for case in report["cases"]}
    quarter = "write_quarter"
    count = 0
    for repeat in range(1, 4):
        rows = csv_rows(get("export", run, format="demand-pair-csv", case=f"demand512-thp-on-{repeat}"))
        require([(r["phase"], r["thp_advice"]) for r in rows] == expected_order,
                f"{run} repeat {repeat}: unexpected phase or policy order")
        for row in rows:
            phase, advice = row["phase"], row["thp_advice"]
            case_id = f"demand512-thp-{advice}-{repeat}"
            label = f"{run} {case_id} {phase}"
            require(row["case_id"] == case_id and row["repeat"] == str(repeat)
                    and row["report_sha256"] == REPORT_HASHES[run], f"{label}: CSV identity mismatch")
            other = general[case_id, phase]
            for paired, ordinary in (("written_positions", "written_positions"), ("rss_kib", "rss_kib"),
                                     ("anon_huge_kib", "huge_kib"), ("process_minor_delta", "action_minor")):
                require(row[paired] == other[ordinary], f"{label}: CSV fields disagree on {paired}")
            if phase in ("before_alloc", "freed"):
                require(not row["rss_kib"] and not row["anon_huge_kib"],
                        f"{label}: absent mapping must have empty readings")
            if phase == "freed":
                require(not row["written_positions"] and row["process_minor_delta"].isdigit(),
                        f"{label}: release count and process faults were conflated")
            if phase != quarter:
                continue
            require(cases[case_id]["validation"]["status"] == "passed", f"{label}: validation failed")
            raw = get("evidence", run, case=case_id, kind="smaps")
            require(hashlib.sha256(raw).hexdigest() == row["smaps_sha256"],
                    f"{label}: original smaps hash differs from CSV")
            events = [json.loads(line) for line in get("evidence", run, case=case_id, kind="jsonl").splitlines()]
            policy = next(event for event in events if event["kind"] == "policy")
            require(policy["result"] == 0, f"{label}: madvise did not succeed")
            if process:
                condition = next(event for event in events if event["kind"] == "condition")
                disabled = int(process == "disable")
                require(condition["process_thp"] == process and condition["process_thp_disabled"] == disabled
                        and row["process_thp"] == process and row["process_thp_disabled"] == str(disabled),
                        f"{label}: process THP readback differs from the expected setting")
            sample = next(event for event in events if event["kind"] == "sample" and event["phase"] == quarter)
            address = int(sample["address"], 16)
            vma = next(m for m in raw_mappings(raw, quarter) if int(m["start"], 16) <= address < int(m["end"], 16))
            observed = sample["count"], vma["rss_kib"], vma["huge_kib"], sample["action_minor"]
            uses_huge_pages = advice == "on" and process != "disable"
            expected = (32768, 131072, 131072, 64) if uses_huge_pages else (32768, 131072, 0, 32768)
            exported = tuple(int(row[key]) for key in
                             ("written_positions", "rss_kib", "anon_huge_kib", "process_minor_delta"))
            require(observed == expected == exported, f"{label}: raw observations and CSV disagree")
        count += len(rows)
    return {"run_id": run, "report_sha256": REPORT_HASHES[run],
            "execution_context": report["environment"]["execution_context"], "paired_rows_checked": count,
            "phase_checked_against_raw": quarter, "process_thp": process, "madvise_result": 0,
            "off": {"rss_kib": 131072, "anon_huge_kib": 0, "process_minor_delta": 32768},
            "on": {"rss_kib": 131072, "anon_huge_kib": 0 if process == "disable" else 131072,
                   "process_minor_delta": 32768 if process == "disable" else 64}}


def verify_process_controls(get):
    allow, disable = [report_for(get, run) for run in PROCESS_PAIRED.values()]
    for key in ("kernel", "machine", "execution_context", "page_bytes", "thp_enabled", "thp_defrag",
                "thp_sizes", "pmd_size", "allocator_environment"):
        require(allow["environment"].get(key) == disable["environment"].get(key),
                f"process controls: environment differed for {key}")
    for path in ("proj5-course/group3_demand.c", "proj5-course/group3_snapshot.h"):
        require(allow["sources"][path] == disable["sources"][path],
                f"process controls: probe source differed for {path}")
    params = {"other": "example--" + PROCESS_PAIRED["disable"], "repeat": 3, "download": 1}
    for phase in ("write_quarter", "freed"):
        evidence = json.loads(get("demand-process-comparison", PROCESS_PAIRED["allow"], phase=phase, **params))
        cases = evidence["cases"]
        require([row["run_id"] for row in cases] == list(PROCESS_PAIRED.values())
                and evidence["phase"] == phase and evidence["repeat"] == 3,
                "process evidence export points to the wrong run or stage")
        expected = [(131072, 131072), (131072, 0)] if phase == "write_quarter" else [(None, None)] * 2
        require([(row["rss_kib"], row["huge_kib"]) for row in cases] == expected,
                "process evidence export disagrees with the replay")
        for row in cases:
            require(row["report_sha256"] == REPORT_HASHES[row["run_id"]], "process evidence report hash mismatch")
            for kind, artifact in row["artifacts"].items():
                raw = get("evidence", row["run_id"], case=row["case_id"], kind=kind)
                require(hashlib.sha256(raw).hexdigest() == artifact["sha256"],
                        f"{row['case_id']}: {kind} hash mismatch in process evidence export")
    return [verify_demand(get, run, mode) for mode, run in PROCESS_PAIRED.items()]


def unique_json_object(pairs):
    value = dict(pairs)
    require(len(value) == len(pairs), "comparison file contains duplicate JSON fields")
    return value


def find_original_report(run, expected, roots):
    require(isinstance(run, str) and run not in ("", ".", "..") and "/" not in run and "\\" not in run
            and ":" not in run, "invalid run id in comparison file")
    failed_integrity = None
    for root in roots:
        candidate = safe_child(root, run)
        path = candidate / "report.json"
        if not path.is_file() or digest(path) != expected:
            continue
        report = load_run(candidate)
        if report["original_report_sha256"] == expected and report["run_id"] == run:
            if report["integrity"]["status"] == "verified":
                return report
            failures = report["integrity"]["errors"]
            failed_integrity = failures[0] if failures else "original archive integrity did not pass"
    reason = failed_integrity or "no matching original report SHA-256 in the record directories"
    raise ValueError(f"{run}: {reason}")


def verify_process_file(path, roots):
    saved = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_json_object)
    require(isinstance(saved, dict) and saved.get("schema_version") == PROCESS_EVIDENCE_SCHEMA,
            "unsupported process comparison file")
    cases = saved.get("cases")
    repeat, phase = saved.get("repeat"), saved.get("phase")
    require(isinstance(cases, list) and len(cases) == 2 and type(repeat) is int and phase in DEMAND_PHASES,
            "comparison file must specify two cases, one repeat and one phase")
    ids, reports = [], []
    for row in cases:
        require(isinstance(row, dict) and isinstance(row.get("record_id"), str),
                "comparison case is missing its record id")
        name, sep, run = row["record_id"].partition("--")
        require(name and sep and run == row.get("run_id"), "record id does not match its run id")
        sha = row.get("report_sha256")
        require(isinstance(sha, str) and re.fullmatch("[0-9a-f]{64}", sha), "invalid original report SHA-256")
        ids.append(row["record_id"])
        reports.append(find_original_report(run, sha, roots))
    rebuilt = demand_process_evidence(ids, reports, repeat, phase)

    # JSON can be reformatted, but numeric zero and boolean false must stay distinct.
    def canonical(value):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    def changed_fields(left, right):
        return [key for key in sorted(set(left) | set(right))
                if key not in left or key not in right or canonical(left[key]) != canonical(right[key])]

    different = changed_fields(saved, rebuilt)
    if "cases" in different:
        different.remove("cases")
        for index, (left, right) in enumerate(zip(saved["cases"], rebuilt["cases"]), 1):
            different.extend(f"cases[{index}].{key}" for key in changed_fields(left, right))
    if different:
        raise ValueError("comparison file differs from the rebuilt evidence: " + ", ".join(different))
    return {"status": "passed", "mode": "downloaded_evidence", "phase": phase, "repeat": repeat,
            "runs": [{"run_id": row["run_id"], "case_id": row["case_id"], "report_sha256": row["report_sha256"]}
                     for row in rebuilt["cases"]]}


def verify_bundled():
    handler = handler_for(Workbench("local", {"example": EXAMPLES}))
    handler.log_message = lambda *_: None
    opener = build_opener(ProxyHandler({}))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def get(route, run, **params):
            query = urlencode({"id": f"example--{run}", **params})
            try:
                with opener.open(f"http://127.0.0.1:{server.server_port}/api/{route}?{query}", timeout=10) as response:
                    return response.read()
            except HTTPError as exc:
                with exc:
                    detail = exc.read().decode("utf-8", errors="replace")
                raise ValueError(f"{run} {route}: HTTP {exc.code} {detail}") from exc

        try:
            result = {"status": "passed", "mode": "historical_replay", "host": platform.system(),
                      "python": platform.python_version(), "sequence": verify_sequence(get),
                      "demand": [verify_demand(get, run) for run in PAIRED],
                      "process_demand": verify_process_controls(get)}
        except (OSError, ValueError, KeyError, StopIteration) as exc:
            print(f"Verification failed: {exc}", file=sys.stderr)
            return 1
        finally:
            server.shutdown()
            thread.join()
    print(json.dumps(result, indent=2))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--process-evidence", type=Path, help="downloaded process comparison JSON to recheck offline")
    parser.add_argument("--records", type=Path, action="append", default=[],
                        help="additional directory containing original run folders")
    args = parser.parse_args(argv)
    if args.process_evidence is None:
        if args.records:
            parser.error("--records is only used with --process-evidence")
        return verify_bundled()
    try:
        result = verify_process_file(args.process_evidence, (*args.records, *RECORD_ROOTS))
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
        print(f"Verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
