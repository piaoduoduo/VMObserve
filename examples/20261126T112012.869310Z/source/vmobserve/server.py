"""Loopback-only workbench. Read-only replay and one bounded live job at a time."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import platform
from pathlib import Path
import secrets
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlparse

from .common import execute, read_json, run_id, timestamp, write_json
from .cow import COW_CHOICES
from .export import csv_text, demand_pair_csv, demand_process_evidence, html_text
from .replay import load_run, read_evidence, recorded_environment, safe_child
from .runner import WORK
from .systems import LABS

WEB = Path(__file__).parent / "web"


WEB_PAGES = {
    "/": "index.html", "/lesson": "lesson.html", "/practice-review": "practice-review.html", "/favicon.svg": "favicon.svg",
    **{"/" + name: name for name in (
        "app.js", "ui.js", "course-views.js", "memory-views.js",
        "sequence-view.js", "evidence-view.js", "curriculum.js",
        "experiment-flow.js", "replay-notes.js", "notes-store.js",
        "notes-library.js", "learning-report.js", "comparison-data.js", "replay-comparison.js",
        "lesson.js", "practice-data.js", "practice-review.js", "style.css",
    )},
}


def default_executor():
    if platform.system() == "Windows" and (WORK / "openeuler-vm/experiment.qcow2").is_file():
        return "openeuler-vm"
    return "local"


def experiment_args(mode, pattern="sparse", cow_fraction="all", group4_task="all", mib=16):
    if isinstance(mode, str) and mode.startswith("lab-") and mode[4:] in LABS:
        return ["--suite", "systems", "--lab", mode[4:], "--repeats", "1"]
    if pattern not in ("sparse", "full") or cow_fraction not in COW_CHOICES:
        raise ValueError("unknown access pattern or COW fraction")
    if group4_task not in ("all", "4.1", "4.2", "4.3", "4.4"):
        raise ValueError("unknown group4 task")
    if mode == "sequence":
        return ["--suite", "sequence", "--repeats", "1"]
    if mode in ("demand512", "stack"):
        return ["--suite", mode, "--repeats", "1", "--timeout", "120"]
    if mode == "lesson-cow":
        if mib not in (16, 64) or cow_fraction == "all":
            raise ValueError("请选择一个区域大小和一个改写比例")
        return ["--suite", "baseline", "--baseline-mib", str(mib), "--cow-fraction", cow_fraction, "--repeats", "1"]
    if mode in ("layout", "course"):
        return ["--suite", mode]
    options = {
        "complete": [],
        "student": ["--suite", "course", "--course-code", "student"],
        "cow": ["--suite", "baseline", "--cow-fraction", cow_fraction],
        "group3": ["--suite", "group3", "--timeout", "120"],
        "demand512-thp": ["--suite", "demand512-thp", "--timeout", "120"],
        "demand512-thp-allow": ["--suite", "demand512-thp", "--thp-process", "allow", "--timeout", "120"],
        "demand512-thp-disable": ["--suite", "demand512-thp", "--thp-process", "disable", "--timeout", "120"],
        "group4": ["--suite", "group4", "--group4-task", group4_task, "--timeout", "120"],
        "lesson-thp": ["--suite", "thp", "--pattern", pattern, "--repeats", "1"],
        "policy": ["--suite", "thp", "--thp", "on", "--thp-process", "pair", "--pattern", pattern, "--repeats", "1"],
        "recheck": ["--repeats", "1", "--pattern", pattern],
        "policy-recheck": ["--repeats", "1", "--pattern", pattern, "--recheck-kind", "process"],
    }
    if mode not in options:
        raise ValueError("unknown execution mode")
    return options[mode]


class Workbench:
    def __init__(self, executor, roots=None):
        self.executor = executor
        self.roots = roots if roots is not None else {"openeuler": WORK / "openeuler-vm/guest-runs", "local": WORK / "runs",
                                                       "example": WORK.parent / "examples"}
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.job = None

    def catalog(self):
        items = []
        for group, root in self.roots.items():
            for path in sorted(root.glob("*/report.json"), reverse=True):
                try:
                    data = read_json(path)
                    env, issue = recorded_environment(path.parent, data)
                    items.append({"id": f"{group}--{path.parent.name}", "run_id": path.parent.name,
                                  "group": group, "kernel": env.get("kernel", "unknown"),
                                  "distribution": env.get("distribution", {}).get("PRETTY_NAME") or env.get("system") or "环境未核验",
                                  "execution_context": env.get("execution_context"),
                                  "environment_issue": issue,
                                  "status": data.get("status", "completed" if data.get("completed") else "failed"),
                                  "count": len(data["cases"]) if "cases" in data else 18,
                                  "case_keys": [
                                      [c["suite"], c.get("parameters", {}).get("lab"),
                                       c.get("parameters", {}).get("thp_advice"), c.get("parameters", {}).get("repeat"),
                                       c.get("parameters", {}).get("process_thp")]
                                      for c in data.get("cases", [])
                                  ],
                                  "suites": sorted({c["suite"] for c in data["cases"]}) if "cases" in data else ["baseline", "thp"],
                                  "data_origin": data.get("data_origin", "real_execution"),
                                  "legacy": "schema_version" not in data})
                except (OSError, ValueError, TypeError):
                    items.append({"id": f"{group}--{path.parent.name}", "run_id": path.parent.name,
                                  "group": group, "distribution": "记录损坏", "status": "unreadable", "count": 0})
        return items

    def directory(self, identifier):
        group, sep, name = identifier.partition("--")
        if not sep or group not in self.roots or not name or "/" in name or "\\" in name:
            raise ValueError("unknown run")
        path = safe_child(self.roots[group], name)
        if not (path / "report.json").is_file():
            raise ValueError("unknown run")
        return path

    def command(self, options, parent=None):
        if self.executor == "openeuler-vm":
            script = WORK / "openeuler-vm/retest.sh"
            if os.name == "nt":
                def linux_path(path):
                    return subprocess.check_output(["wsl", "-d", "Ubuntu", "--", "wslpath", "-a", Path(path).as_posix()], text=True, timeout=10).strip()
                cmd = ["wsl", "-d", "Ubuntu", "--", "bash", linux_path(script)]
                if parent:
                    parent = linux_path(parent)
            else:
                cmd = ["bash", str(script)]
        else:
            cmd = [sys.executable, str(WORK / "run_all.py")]
        if parent:
            cmd += ["--recheck-from", str(parent)]
        return cmd + options

    def start(self, mode, identifier=None, pattern="sparse", cow_fraction="all", group4_task="all", mib=16):
        options = experiment_args(mode, pattern, cow_fraction, group4_task, mib)
        if self.executor == "local" and platform.system() != "Linux":
            raise ValueError("本机提供回放与导出。请在 Linux 或已配置的 openEuler 虚拟机中采集。")
        parent = self.directory(identifier or "") if mode in ("recheck", "policy-recheck") else None
        if parent:
            report = load_run(parent)
            if (report["integrity"]["status"] != "verified" or report["data_origin"] != "real_execution"
                    or not any(c["suite"] == "thp" for c in report["cases"])):
                raise ValueError("recheck requires a verified v1 real execution; run a full experiment first")
        with self.lock:
            if self.job and self.job["status"] == "running":
                raise RuntimeError("An experiment is already running")
            folder = WORK.parent / "output/server-jobs" / run_id()
            folder.mkdir(parents=True)
            self.job = {"id": folder.name, "status": "running", "mode": mode,
                        "started_at": timestamp(), "target": self.executor, "parent": identifier,
                        "pattern": pattern, "cow_fraction": cow_fraction if mode == "cow" else None}
            write_json(folder / "job.json", self.job)
            threading.Thread(target=self._worker, args=(folder, options, parent), daemon=True).start()
            return dict(self.job)

    def _worker(self, folder, options, parent=None):
        try:
            result = execute(self.command(options, parent), folder / "stdout.log", folder / "stderr.log", 1200)
        except Exception as exc:
            result = {"status": "failed", "error": {"code": "job_start_failed", "message": str(exc)}}
        with self.lock:
            self.job.update(result)
            self.job["finished_at"] = timestamp()
            # Both runners print the path of their own result; another terminal can run in parallel.
            vm = self.executor == "openeuler-vm"
            prefix = "EVIDENCE_DIRECTORY=" if vm else "RUN_DIRECTORY="
            stdout = folder / "stdout.log"
            names = [Path(line[len(prefix):]).name for line in stdout.read_text(encoding="utf-8", errors="replace").splitlines()
                     if line.startswith(prefix)] if stdout.exists() else []
            group = "openeuler" if vm else "local"
            ids = [f"{group}--{name}" for name in names if (self.roots[group] / name / "report.json").is_file()]
            self.job["new_run_ids"] = ids
            # Exit 3 is the runner's completed-with-deviations result. Require
            # its saved report as well, so an unrelated transport exit stays failed.
            if (result.get("status") == "failed" and result.get("exit_code") == 3 and
                    len(ids) == 1 and read_json(self.directory(ids[0]) / "report.json").get("status") == "completed_with_deviations"):
                self.job.update(status="completed_with_deviations", error=None)
            # Failed transport stdout/stderr are visible as errors, never substituted with old success.
            self.job["log"] = "\n".join(p.read_text(encoding="utf-8", errors="replace")[-10000:] for p in (folder / "stdout.log", folder / "stderr.log") if p.exists())
            write_json(folder / "job.json", self.job)


def handler_for(app):
    class Handler(BaseHTTPRequestHandler):
        def allowed_host(self):
            return self.headers.get("Host") in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

        def send(self, value, content_type="application/json; charset=utf-8", code=200, attachment=None):
            payload = value if isinstance(value, bytes) else value.encode("utf-8") if isinstance(value, str) else json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            if attachment:
                self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if not self.allowed_host():
                return self.send({"error": "invalid host"}, code=403)
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            try:
                path = parsed.path
                page = "index.html" if path.startswith("/labs/") and path.count("/") == 2 else WEB_PAGES.get(path)
                if page:
                    file = WEB / page
                    mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}[file.suffix]
                    return self.send(file.read_bytes(), mime + "; charset=utf-8")
                if path == "/api/course-basics":
                    return self.send(read_json(WORK / "lessons/catalog/basics.json"))
                if path == "/api/lesson":
                    original_ps = read_json(WORK / "lessons/demand/original-ps.json")
                    if query.get("view") == ["observations"]:
                        return self.send({"original_ps": original_ps})
                    return self.send({"original_ps": original_ps,
                                      "student_path": str(WORK / "lessons/demand/student.h"),
                                      "student": (WORK / "lessons/demand/student.h").read_text(encoding="utf-8"),
                                      "reference": (WORK / "proj5-course/access_pattern.h").read_text(encoding="utf-8"),
                                      "worksheet": (WORK / "lessons/demand/WORKSHEET.md").read_text(encoding="utf-8")})
                if path == "/api/config":
                    return self.send({"token": app.token, "executor": app.executor, "host_system": platform.system()})
                if path == "/api/runs":
                    return self.send(app.catalog())
                if path == "/api/job":
                    with app.lock:
                        return self.send(app.job)
                if path == "/api/demand-process-comparison":
                    ids = [query.get(key, [""])[0] for key in ("id", "other")]
                    repeat = int(query.get("repeat", ["0"])[0])
                    phase = query.get("phase", [""])[0]
                    comparison = demand_process_evidence(ids, [load_run(app.directory(id_)) for id_ in ids], repeat, phase)
                    attachment = "demand-process-evidence.json" if query.get("download") == ["1"] else None
                    return self.send(comparison, attachment=attachment)
                if path not in ("/api/report", "/api/evidence", "/api/export"):
                    return self.send({"error": "not found"}, code=404)
                directory = app.directory(query.get("id", [""])[0])
                if path == "/api/evidence":
                    payload = read_evidence(directory, query.get("case", [""])[0], query.get("kind", ["jsonl"])[0])
                    return self.send(payload, "text/plain; charset=utf-8")
                report = load_run(directory)
                if path == "/api/report":
                    return self.send(report)
                format_ = query.get("format", ["html"])[0]
                if format_ == "html":
                    return self.send(html_text(report), "text/html; charset=utf-8", attachment="memory-report.html")
                if format_ == "csv":
                    return self.send("\ufeff" + csv_text(report), "text/csv; charset=utf-8", attachment="memory-samples.csv")
                if format_ == "demand-pair-csv":
                    paired = demand_pair_csv(report, query.get("case", [""])[0])
                    return self.send("\ufeff" + paired, "text/csv; charset=utf-8", attachment="demand-pair-samples.csv")
                if format_ == "json":
                    return self.send(report, attachment="memory-report.json")
                raise ValueError("unsupported export format")
            except (ValueError, OSError, KeyError, TypeError, StopIteration) as exc:
                return self.send({"error": str(exc) or "record not found"}, code=400)

        def do_POST(self):
            if not self.allowed_host() or self.headers.get("X-VMObserve-Token") != app.token:
                return self.send({"error": "invalid host or action token"}, code=403)
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{self.headers['Host']}":
                return self.send({"error": "cross-origin actions prohibited"}, code=403)
            if self.path != "/api/run":
                return self.send({"error": "not found"}, code=404)
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size < 4096:
                    raise ValueError("invalid request length")
                data = json.loads(self.rfile.read(size))
                return self.send(app.start(data.get("mode"), data.get("id"), data.get("pattern", "sparse"),
                                           data.get("cow_fraction", "all"), data.get("group4_task", "all"), data.get("mib", 16)), code=202)
            except RuntimeError as exc:
                return self.send({"error": str(exc)}, code=409)
            except (ValueError, OSError, KeyError, TypeError, AttributeError) as exc:
                return self.send({"error": str(exc)}, code=400)
    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--executor", choices=("local", "openeuler-vm"), default=default_executor())
    args = parser.parse_args(argv)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(Workbench(args.executor)))
    print(f"Local workbench: http://127.0.0.1:{server.server_port} (executor: {args.executor})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
