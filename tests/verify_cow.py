"""Audit a real five-fraction run against explicit predictions; never execute it."""
import argparse
import csv
import io
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.common import digest, write_json
from vmobserve.export import csv_text, export_run
from vmobserve.replay import load_run

# Independent explicit predictions for a 4 KiB base page; not fitted to observations.
EXPECTED = {
    16: {"0": (0, 16384), "1/8": (512, 18432), "1/4": (1024, 20480), "1/2": (2048, 24576), "1": (4096, 32768)},
    64: {"0": (0, 65536), "1/8": (2048, 73728), "1/4": (4096, 81920), "1/2": (8192, 98304), "1": (16384, 131072)},
}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("run", type=Path)
    p.add_argument("output", type=Path, help="new directory for audit and exports")
    args = p.parse_args()
    before = digest(args.run / "report.json")
    report = load_run(args.run)
    assert report["data_origin"] == "real_execution"
    assert report["integrity"]["status"] == "verified", report["integrity"]
    assert report["status"] == "completed", report["status"]
    assert report["environment"]["page_bytes"] == 4096
    baseline = [c for c in report["cases"] if c["suite"] == "baseline"]
    assert len(baseline) == 30, len(baseline)
    seen, rows = set(), []
    for c in baseline:
        mib, repeat = c["parameters"]["mib"], c["parameters"]["repeat"]
        fraction = c["parameters"]["cow_fraction"]
        key = (mib, repeat, fraction)
        assert key not in seen
        seen.add(key)
        pages, expected = EXPECTED[mib][fraction]
        cow = c["data"]["cow"]
        assert cow["condition_origin"] == "recorded" and cow["written_pages"] == pages
        assert c["validation"]["status"] == "passed", c["validation"]
        samples = [s for s in c["data"]["samples"] if s["phase"] == "child_write"]
        assert len(samples) == 2
        actual = sum(s["pss_kib"] for s in samples)
        assert actual == expected, (key, actual, expected)
        assert all(s["private_dirty_kib"] == pages * 4 for s in samples)
        assert all(s["shared_dirty_kib"] == mib * 1024 - pages * 4 for s in samples)
        values = c["data"]["value_check"]
        assert values["cow_written_pages"] == pages
        assert values["parent_mismatches"] == values["child_mismatches"] == 0
        rows.append({"case_id": c["id"], "mib": mib, "repeat": repeat, "fraction": fraction,
                     "written_pages": pages, "predicted_pss_kib": expected, "observed_pss_kib": actual})
    assert seen == {(m, r, f) for m in EXPECTED for r in (1, 2, 3) for f in EXPECTED[m]}
    assert len(report["diagnosis"]["cow_observations"]) == 30
    assert all(x["confirmed"] for x in report["diagnosis"]["cow_observations"])
    exports = list(csv.DictReader(io.StringIO(csv_text(report))))
    assert {x["cow_fraction"] for x in exports if x["suite"] == "baseline"} == set(EXPECTED[16])
    args.output.mkdir(parents=True, exist_ok=False)
    export_run(args.run, args.output / "report")
    assert digest(args.run / "report.json") == before
    write_json(args.output / "audit.json", {"status": "passed", "verification_mode": "historical_replay",
        "data_origin": report["data_origin"], "run_id": report["run_id"], "source_report_sha256": before,
        "environment": report["environment"], "rule_version": report["diagnosis"]["rule_version"],
        "cases": rows, "note": "Audited stored real execution; this audit did not run experiments. No hardware performance claim."})
    print(f"AUDIT_PASSED={report['run_id']} cases=30 output={args.output}")


if __name__ == "__main__":
    main()
