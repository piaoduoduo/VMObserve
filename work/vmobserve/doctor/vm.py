"""Explicit opt-in connection to an existing VM, with strict SSH host checks."""
import shlex
from ..common import configured_wsl_distro

GUEST_CODE = '''import json, os, platform, shutil, sys
from pathlib import Path
release = {}
for line in Path('/etc/os-release').read_text().splitlines():
    if '=' in line:
        k, v = line.split('=', 1)
        release[k] = v.strip(chr(34))
try:
    smaps = bool(Path('/proc/self/smaps').read_text())
except OSError:
    smaps = False
print(json.dumps(dict(system=platform.system(), kernel=platform.release(),
    distribution=release.get('ID', ''), smaps=smaps, python_version=list(sys.version_info[:3]),
    page_bytes=os.sysconf('SC_PAGE_SIZE'),
    tools={name: bool(shutil.which(name)) for name in
           ('python3', 'gcc', 'strace', 'file', 'ldd', 'readelf')})))
'''


def inspect_guest(probe, vm):
    if probe.system == "Windows":
        result = probe.command(["wsl", "-d", configured_wsl_distro(), "--exec", "wslpath", "-a", vm.as_posix()])
        if result["status"] != "passed" or not result["detail"].startswith("/"):
            return {"status": "failed", "detail": "无法将项目目录转换成 WSL 路径"}
        prefix, directory = ["wsl", "-d", configured_wsl_distro(), "--exec", "bash"], result["detail"]
    else:
        prefix, directory = ["bash"], str(vm)
    # Options before SSH_OPTS take priority over its accept-new default.
    command = "python3 -c " + shlex.quote(GUEST_CODE)
    # Feed shell source via stdin: passing a quoted multiline -c argument
    # through wsl.exe can expand $1/$2 in an intermediate shell on Windows.
    script = "set -eu\nsource " + shlex.quote(directory + "/config.sh") + "\n" + '''
ssh -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o BatchMode=yes -o ConnectionAttempts=1 \\
    "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 ''' + shlex.quote(command) + "\n"
    return probe.command([*prefix, "-s"], timeout=20, input_text=script)
