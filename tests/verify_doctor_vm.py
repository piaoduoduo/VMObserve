"""Opt-in real SSH checks on the Ubuntu/Linux host of an existing QEMU VM.

Never starts a VM, installs packages or runs an experiment. Results are saved
separately from unit tests, including a real rejection of an unknown host key.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def verify(output):
    if platform.system() != "Linux":
        raise ValueError("请在运行 QEMU 的 Ubuntu/Linux 中执行此验证")
    state = Path(os.environ.get("PROJ5_VM_STATE_DIR", "/root/proj5-vm"))
    key = Path(os.environ.get("PROJ5_VM_KEY", str(state / "id_ed25519")))
    known_hosts = state / "known_hosts"
    if not key.is_file() or not known_hosts.is_file():
        raise ValueError("请先准备已有 VM 的密钥和经过核对的 known_hosts")
    before = hashlib.sha256(known_hosts.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=False)
    observations = []

    def run(name, expected, connect=False, environment=None):
        command = [sys.executable, "-B", str(ROOT / "work/doctor.py"), "--profile", "vm", "--json"]
        if connect:
            command.append("--connect")
        result = subprocess.run(command, capture_output=True, timeout=40, env=environment)
        (output / (name + ".stderr.log")).write_bytes(result.stderr)
        report = json.loads(result.stdout.decode("utf-8"))
        (output / (name + ".json")).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        code = {"ready": 0, "blocked": 1, "incomplete": 2}[expected]
        passed = report["status"] == expected and result.returncode == code
        observations.append(dict(check=name, expected=expected, actual=report["status"],
                                 exit_code=result.returncode, passed=passed))
        return report

    run("without-connect", "incomplete")
    with tempfile.TemporaryDirectory(prefix="vmobserve-untrusted-") as temporary:
        environment = {**os.environ, "PROJ5_VM_STATE_DIR": temporary,
                       "PROJ5_VM_KEY": str(key), "LC_ALL": "C"}
        rejected = run("untrusted-host", "blocked", connect=True, environment=environment)
        detail = next(c["detail"] for c in rejected["checks"] if c["id"] == "vm.guest")
        observations.append(dict(check="strict-host-rejection", passed="host key verification failed" in detail.lower()))
        observations.append(dict(check="no-new-trust-record", passed=not (Path(temporary) / "known_hosts").exists()))
    run("connected", "ready", connect=True)
    after = hashlib.sha256(known_hosts.read_bytes()).hexdigest()
    observations.append(dict(check="existing-trust-record-unchanged", passed=before == after))
    passed = all(c["passed"] for c in observations)
    summary = dict(status="passed" if passed else "failed", checks=observations,
                   known_hosts_sha256=after, scope="Real read-only VM diagnostics; no experiment executed")
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="新的结果目录，拒绝覆盖")
    args = parser.parse_args()
    try:
        summary = verify(args.output)
    except (OSError, ValueError, StopIteration, subprocess.TimeoutExpired) as exc:
        print(f"VM verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
