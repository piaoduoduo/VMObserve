"""Loopback-only workbench. Read-only replay and one bounded live job at a time."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlparse

from .common import execute, read_json, run_id, timestamp, write_json
from .export import csv_text, html_text
from .replay import load_run, safe_child
from .runner import WORK

WEB = Path(__file__).parent / "web"


class Workbench:
    def __init__(self, executor, roots=None):
        self.executor = executor
        self.roots = roots or {"openeuler": WORK / "openeuler-vm/guest-runs", "local": WORK / "runs"}
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.job = None

    def catalog(self):
        items = []
        for group, root in self.roots.items():
            for path in sorted(root.glob("*/report.json"), reverse=True):
                try:
                    data = read_json(path)
                    env = data.get("environment", {})
                    items.append({"id": f"{group}--{path.parent.name}", "run_id": path.parent.name,
                                  "group": group, "kernel": env.get("kernel", "unknown"),
                                  "distribution": env.get("distribution", {}).get("PRETTY_NAME") or ("openEuler 24.03" if "openEuler" in env.get("os_release", "") else "Ubuntu WSL"),
                                  "status": data.get("status", "completed" if data.get("completed") else "failed"),
                                  "count": len(data["cases"]) if "cases" in data else 18,
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

    def command(self, parent=None, pattern="sparse"):
        if self.executor == "openeuler-vm":
            script = WORK / "openeuler-vm/retest.sh"
            if os.name == "nt":
                def linux_path(path):
                    return subprocess.check_output(["wsl", "-d", "Ubuntu", "--", "wslpath", "-a", Path(path).as_posix()], text=True, timeout=10).strip()
                cmd = ["wsl", "-d", "Ubuntu", "--", "bash", linux_path(script)]
                if parent:
                    cmd += ["--recheck-from", linux_path(parent)]
            else:
                cmd = ["bash", str(script)]
                if parent:
                    cmd += ["--recheck-from", str(parent)]
        else:
            cmd = [sys.executable, str(WORK / "run_all.py")]
            if parent:
                cmd += ["--recheck-from", str(parent)]
        if parent:
            cmd += ["--pattern", pattern]
        return cmd

    def start(self, mode, identifier=None, pattern="sparse"):
        if mode not in ("complete", "recheck") or pattern not in ("sparse", "full"):
            raise ValueError("unknown execution mode")
        parent = self.directory(identifier or "") if mode == "recheck" else None
        if parent:
            report = load_run(parent)
            if report["integrity"]["status"] != "verified" or report["data_origin"] != "real_execution" or report.get("original_schema"):
                raise ValueError("recheck requires a verified v1 real execution; run a full experiment first")
        with self.lock:
            if self.job and self.job["status"] == "running":
                raise RuntimeError("An experiment is already running")
            folder = WORK.parent / "output/server-jobs" / run_id()
            folder.mkdir(parents=True)
            self.job = {"id": folder.name, "status": "running", "mode": mode,
                        "started_at": timestamp(), "target": self.executor, "parent": identifier,
                        "pattern": pattern, "previous_run_ids": [r["id"] for r in self.catalog()]}
            write_json(folder / "job.json", self.job)
            threading.Thread(target=self._worker, args=(folder, parent, pattern), daemon=True).start()
            return dict(self.job)

    def _worker(self, folder, parent, pattern):
        try:
            result = execute(self.command(parent, pattern), folder / "stdout.log", folder / "stderr.log", 1200)
        except Exception as exc:
            result = {"status": "failed", "error": {"code": "job_start_failed", "message": str(exc)}}
        with self.lock:
            self.job.update(result)
            self.job["finished_at"] = timestamp()
            self.job["new_run_ids"] = [r["id"] for r in self.catalog() if r["id"] not in self.job["previous_run_ids"]]
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
                if path in ("/", "/app.js", "/style.css"):
                    file = WEB / {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}[path]
                    mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}[file.suffix]
                    return self.send(file.read_bytes(), mime + "; charset=utf-8")
                if path == "/api/config":
                    return self.send({"token": app.token, "executor": app.executor})
                if path == "/api/runs":
                    return self.send(app.catalog())
                if path == "/api/job":
                    with app.lock:
                        return self.send(app.job)
                if path not in ("/api/report", "/api/evidence", "/api/export"):
                    return self.send({"error": "not found"}, code=404)
                directory = app.directory(query.get("id", [""])[0])
                report = load_run(directory)
                if path == "/api/report":
                    return self.send(report)
                if path == "/api/evidence":
                    case = next(c for c in report["cases"] if c["id"] == query.get("case", [""])[0])
                    kind = query.get("kind", ["jsonl"])[0]
                    if kind not in ("jsonl", "smaps"):
                        raise ValueError("invalid evidence type")
                    raw = safe_child(directory, case["artifacts"][kind])
                    if raw.stat().st_size > 2 * 1024 * 1024:
                        raise ValueError("evidence exceeds viewer size limit")
                    return self.send(raw.read_bytes(), "text/plain; charset=utf-8")
                format_ = query.get("format", ["html"])[0]
                if format_ == "html":
                    return self.send(html_text(report), "text/html; charset=utf-8", attachment="memory-report.html")
                if format_ == "csv":
                    return self.send("\ufeff" + csv_text(report), "text/csv; charset=utf-8", attachment="memory-samples.csv")
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
                return self.send(app.start(data.get("mode"), data.get("id"), data.get("pattern", "sparse")), code=202)
            except RuntimeError as exc:
                return self.send({"error": str(exc)}, code=409)
            except (ValueError, OSError, KeyError, TypeError, AttributeError) as exc:
                return self.send({"error": str(exc)}, code=400)
    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--executor", choices=("local", "openeuler-vm"), default="openeuler-vm" if os.name == "nt" else "local")
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
