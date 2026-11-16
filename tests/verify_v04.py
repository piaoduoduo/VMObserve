"""Read-only audit of explicitly supplied real v0.4 runs, not a new experiment."""
import argparse
import csv
import io
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.common import digest, read_json, write_json
from vmobserve.export import csv_text, html_text
from vmobserve.replay import load_run


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("runs", nargs="+", type=Path)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--history", type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    audit = {"kind": "historical_evidence_audit", "not_a_new_linux_run": True, "runs": []}
    for path in args.runs:
        before = digest(path / "report.json")
        r = load_run(path)
        assert r["data_origin"] == "real_execution" and r["integrity"]["status"] == "verified", path
        assert r["tool_version"] == "0.4.0" and all(c["status"] == "completed" for c in r["cases"]), path
        student = all(c["parameters"].get("course_code") == "student" for c in r["cases"])
        assert r["status"] == ("failed" if student else "completed"), path
        assert all(c["validation"]["status"] == ("failed" if student else "passed") for c in r["cases"]), path
        controls = r["diagnosis"].get("policy_comparisons", [])
        if any(c["parameters"].get("process_thp") in ("allow", "disable") for c in r["cases"]):
            assert len(controls) * 2 == len(r["cases"]) and all(c["control_valid"] for c in controls), path
            assert all(c["huge_kib"] == {"allow": 32768, "disable": 0} for c in controls), path
        if student:
            assert all(f["rule"] == "course_task_incomplete" for f in r["diagnosis"]["findings"]), path
            assert all(c["data"]["samples"][4]["written_positions"] == 0 for c in r["cases"]), path
        exported = args.output / r["run_id"]
        exported.mkdir(exist_ok=True)
        text = csv_text(r)
        rows = list(csv.DictReader(io.StringIO(text)))
        assert len(rows) == sum(len(c["data"]["samples"]) for c in r["cases"]), path
        for row in rows:
            assert row["data_origin"] == "real_execution" and row["view_mode"] == "historical_replay"
        (exported / "samples.csv").write_text(text, encoding="utf-8-sig", newline="")
        (exported / "report.html").write_text(html_text(r), encoding="utf-8")
        write_json(exported / "report.json", r)
        assert digest(path / "report.json") == before, path
        audit["runs"].append({"path": str(path), "run_id": r["run_id"], "report_sha256": before,
                              "status": r["status"], "integrity": r["integrity"]["status"],
                              "cases": len(r["cases"]), "samples": len(rows), "student_starter_negative_check": student,
                              "policy_comparisons": controls, "related_run": r["related_run"]})
    history = read_json(args.history)
    assert all(digest(ROOT / name) == sha for name, sha in history.items()), "historical file changed"
    audit["historical_files_unchanged"] = len(history)
    write_json(args.output / "audit.json", audit)
    print(f"Audited {len(audit['runs'])} real runs; {len(history)} historical hashes unchanged.")


if __name__ == "__main__":
    main()
