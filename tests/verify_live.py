"""Linux-only real failure-injection checks, kept out of ordinary experiment history."""
import json
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.common import run_id, write_json
from vmobserve.replay import load_run


def main():
    if platform.system() != "Linux":
        raise SystemExit("Run this verification in Linux")
    folder = ROOT / "output/verification" / ("failure-injection-" + run_id())
    folder.mkdir(parents=True)
    cases = [
        ("compile-failed", ["--suite", "baseline", "--repeats", "1", "--compiler", "/nonexistent/vmobserve-gcc"], 1, "failed"),
        ("probe-timeout", ["--suite", "baseline", "--repeats", "1", "--timeout", "0.00001"], 1, "failed"),
    ]
    if "microsoft" in platform.release().lower():
        cases.append(("target-mismatch", ["--require-openeuler"], 2, "unsupported"))
    results = []
    for name, options, code, status in cases:
        output = folder / name
        proc = subprocess.run([sys.executable, str(ROOT / "work/run_all.py"), "--output", str(output), *options], capture_output=True, text=True, timeout=90)
        (folder / f"{name}.stdout.log").write_text(proc.stdout)
        (folder / f"{name}.stderr.log").write_text(proc.stderr)
        saved = next(output.glob("*/report.json"))
        report = json.loads(saved.read_text())
        assert proc.returncode == code, (name, proc.returncode)
        assert report["status"] == status, (name, report["status"])
        assert all(f["confidence"] == "insufficient_evidence" for f in report["diagnosis"]["findings"])
        assert load_run(saved.parent)["integrity"]["status"] == "verified"
        if name == "probe-timeout":
            assert any(c["status"] == "timeout" for c in report["cases"])
        results.append({"name": name, "report": str(saved.relative_to(ROOT)), "exit_code": proc.returncode, "status": status, "passed": True})
    write_json(folder / "verification.json", {"kind": "real_failure_injection", "not_successful_mechanism_evidence": True, "results": results})
    print(json.dumps({"verification": str(folder), "results": results}, indent=2))

if __name__ == "__main__":
    main()
