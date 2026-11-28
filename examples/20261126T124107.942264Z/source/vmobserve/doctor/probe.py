"""Bounded host inspection; no installation, configuration or experiment runs."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys


def decode(raw):
    if raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16", errors="replace").strip()
    # wsl.exe writes UTF-16LE to redirected pipes, often without a BOM.
    # Its own warnings can precede the Linux command's UTF-8 stderr in the
    # same pipe. Decode UTF-16 lines separately so SSH errors stay readable.
    remaining = raw.removeprefix(b"\xff\xfe")
    parts = []
    while b"\x00" in remaining:
        end = remaining.find(b"\n\x00")
        if end < 0:
            parts.append(remaining.decode("utf-16-le", errors="replace"))
            remaining = b""
            break
        parts.append(remaining[:end + 2].decode("utf-16-le", errors="replace"))
        remaining = remaining[end + 2:]
    parts.append(remaining.decode("utf-8", errors="replace"))
    return "".join(parts).strip()


class Probe:
    system = platform.system()
    kernel = platform.release()
    python_version = tuple(sys.version_info[:3])

    def read(self, path):
        return Path(path).read_text(encoding="utf-8")

    def pagemap_readable(self):
        with open("/proc/self/pagemap", "rb", buffering=0) as stream:
            return len(stream.read(8)) == 8

    def exists(self, path):
        return Path(path).is_file()

    def which(self, name):
        return shutil.which(name)

    def disk_free(self, path):
        return shutil.disk_usage(path).free

    def page_size(self):
        return os.sysconf("SC_PAGE_SIZE")

    def command(self, argv, timeout=5, input_text=None):
        try:
            stream = {"stdin": subprocess.DEVNULL} if input_text is None else {"input": input_text.encode("utf-8")}
            result = subprocess.run(argv, **stream, capture_output=True,
                                    timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            return {"status": "timeout", "detail": f"命令超过 {timeout} 秒，已停止等待"}
        except FileNotFoundError:
            return {"status": "missing", "detail": "命令不存在"}
        except OSError as exc:
            return {"status": "failed", "detail": str(exc)}
        output = decode(result.stdout) or decode(result.stderr)
        return {"status": "passed" if result.returncode == 0 else "failed",
                "detail": output[:2000], "exit_code": result.returncode}
