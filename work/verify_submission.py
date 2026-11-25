"""Verify the contest's bundled samples through a temporary local workbench."""
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

from vmobserve.group3 import DEMAND_PHASES
from vmobserve.server import Workbench, handler_for
from vmobserve.smaps import parse_mappings

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
BASELINE = "20261118T013159.221864Z"
PAIRED = ("20261120T120355.446473Z", "20261120T113225.827429Z")
REPORT_HASHES = {
    BASELINE: "7471631ce89130bfcf0caef4bacb0ef6de291ce11405d17279d76ac922c880a8",
    PAIRED[0]: "53118ce1664fbc55b7884aac42794065de71a22cee14cd39649b319ec4f9fea0",
    PAIRED[1]: "9d7aa036cd908c7bbd110dc8f4755a594486e0a07d4073a2be3d43bcd5f9110e",
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


def verify_demand(get, run):
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
            sample = next(event for event in events if event["kind"] == "sample" and event["phase"] == quarter)
            address = int(sample["address"], 16)
            vma = next(m for m in raw_mappings(raw, quarter) if int(m["start"], 16) <= address < int(m["end"], 16))
            observed = sample["count"], vma["rss_kib"], vma["huge_kib"], sample["action_minor"]
            expected = (32768, 131072, 0, 32768) if advice == "off" else (32768, 131072, 131072, 64)
            exported = tuple(int(row[key]) for key in
                             ("written_positions", "rss_kib", "anon_huge_kib", "process_minor_delta"))
            require(observed == expected == exported, f"{label}: raw observations and CSV disagree")
        count += len(rows)
    return {"run_id": run, "report_sha256": REPORT_HASHES[run],
            "execution_context": report["environment"]["execution_context"], "paired_rows_checked": count,
            "phase_checked_against_raw": quarter,
            "off": {"rss_kib": 131072, "anon_huge_kib": 0, "process_minor_delta": 32768},
            "on": {"rss_kib": 131072, "anon_huge_kib": 131072, "process_minor_delta": 64}}


def main():
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
                      "demand": [verify_demand(get, run) for run in PAIRED]}
        except (OSError, ValueError, KeyError, StopIteration) as exc:
            print(f"Verification failed: {exc}", file=sys.stderr)
            return 1
        finally:
            server.shutdown()
            thread.join()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
