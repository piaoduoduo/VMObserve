"""Filesystem and subprocess primitives shared by every experiment."""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def configured_wsl_distro():
    return os.getenv("VMOBSERVE_WSL_DISTRO", "").strip() or "Ubuntu"


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def run_id():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    """A viewer never sees a half-written JSON report."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def execute(argv, stdout, stderr, timeout, cwd=None):
    """Stream raw bytes to disk; kill the complete Linux process group on timeout.

    This matters for the fork probe: killing only its parent leaves a blocked
    child and inherited pipe descriptors. Partial stdout/smaps survive failures.
    """
    result = {"command": [str(x) for x in argv], "started_at": timestamp(),
              "status": "running", "exit_code": None, "error": None}
    start = time.monotonic()
    with Path(stdout).open("wb") as out, Path(stderr).open("wb") as err:
        try:
            proc = subprocess.Popen(argv, stdout=out, stderr=err, cwd=cwd,
                                    start_new_session=(os.name == "posix"))
        except OSError as exc:
            result.update(status="failed", error={"code": "spawn_failed", "message": str(exc)})
        else:
            try:
                code = proc.wait(timeout=timeout)
                result.update(status="completed" if code == 0 else "failed", exit_code=code)
                if code:
                    result["error"] = {"code": "process_exit", "message": f"exit status {code}"}
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
                if os.name == "posix":
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    proc.kill()
                proc.wait()
                state = "timeout" if isinstance(exc, subprocess.TimeoutExpired) else "cancelled"
                result.update(status=state, exit_code=proc.returncode,
                              error={"code": state, "message": f"process {state}; partial evidence retained"})
    result.update(finished_at=timestamp(), duration_seconds=round(time.monotonic() - start, 3))
    return result
