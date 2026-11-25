"""Synthetic host failures and real bundled replay; never start an experiment."""
from contextlib import redirect_stdout, redirect_stderr
import io
import json
import shlex
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from vmobserve.doctor.checks import diagnose, summarize
from vmobserve.doctor.cli import main
from vmobserve.doctor.probe import Probe, decode
from vmobserve.doctor.vm import inspect_guest


class Host:
    system = "Linux"
    kernel = "6.6.0-test"
    python_version = (3, 10, 0)

    def __init__(self):
        self.calls = []
        self.absent = set()
        self.results = {}
        self.inputs = []
        self.files = {
            "/etc/os-release": 'ID=openeuler\nPRETTY_NAME="openEuler test"',
            "/proc/self/smaps": "1000-2000 rw-p test\nRss: 4 kB",
            "/sys/kernel/mm/transparent_hugepage/enabled": "always [madvise] never",
            "/sys/kernel/mm/transparent_hugepage/hpage_pmd_size": "2097152",
            "/proc/meminfo": "MemAvailable: 1048576 kB\nSwapFree: 0 kB",
        }

    def read(self, path):
        if str(path) not in self.files:
            raise FileNotFoundError(str(path))
        return self.files[str(path)]

    def exists(self, path):
        if str(path) in self.absent:
            return False
        return str(path) == "/usr/lib/libc.a" or Path(path).is_file()

    def which(self, name):
        return None if name in self.absent else "/usr/bin/" + name

    def command(self, argv, timeout=5, input_text=None):
        self.calls.append((argv, timeout))
        self.inputs.append(input_text)
        key = tuple(argv)
        if key in self.results:
            return self.results[key]
        if argv == ["gcc", "-print-file-name=libc.a"]:
            return {"status": "passed", "detail": "/usr/lib/libc.a"}
        if argv == ["wsl", "--list", "--quiet"]:
            return {"status": "passed", "detail": "Ubuntu\nDebian"}
        return {"status": "passed", "detail": "test version"}

    def disk_free(self, path):
        return 1024 ** 3

    def page_size(self):
        return 4096


def item(report, identifier):
    return next(c for c in report["checks"] if c["id"] == identifier)


class DoctorTests(unittest.TestCase):
    def test_bundled_examples_replay_without_executing_commands(self):
        host = Host()
        report = diagnose("replay", probe=host)
        self.assertEqual(report["status"], "ready")
        self.assertTrue(any(c["id"].startswith("example.") for c in report["checks"]))
        self.assertEqual(host.calls, [])

    def test_missing_and_corrupt_examples_are_blocking(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(item(diagnose("replay", root=root, probe=Host()), "examples")["status"], "missing")
            p = root / "examples/broken"
            p.mkdir(parents=True)
            (p / "report.json").write_text("{}", encoding="utf-8")
            r = diagnose("replay", root=root, probe=Host())
            self.assertEqual(item(r, "example.broken")["status"], "failed")

    def test_windows_can_replay_but_cannot_collect_directly(self):
        host = Host()
        host.system = "Windows"
        self.assertEqual(diagnose("replay", probe=host)["status"], "ready")
        report = diagnose("sequence", probe=host)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(item(report, "linux")["status"], "unsupported")
        self.assertEqual(host.calls, [])

    def test_missing_strace_is_specific_to_relevant_profiles(self):
        host = Host()
        host.absent.add("strace")
        report = diagnose("sequence", probe=host)
        self.assertEqual(item(report, "tool.strace")["status"], "missing")
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(diagnose("thp", probe=host)["status"], "ready")

    def test_command_timeout_keeps_remaining_checks(self):
        host = Host()
        host.results[("gcc", "--version")] = {"status": "timeout", "detail": "timed out"}
        r = diagnose("sequence", probe=host)
        self.assertEqual(item(r, "tool.gcc")["status"], "failed")
        self.assertEqual(item(r, "tool.strace")["status"], "passed")
        self.assertEqual(item(r, "page_size")["status"], "passed")

    def test_openeuler_needs_both_distribution_and_kernel(self):
        for kernel, release in (("6.6.0-microsoft-standard-WSL2", "ID=openeuler"),
                                ("6.6.0-test", "ID=ubuntu")):
            host = Host()
            host.kernel = kernel
            host.files["/etc/os-release"] = release
            self.assertEqual(item(diagnose("sequence", probe=host, require_openeuler=True), "openeuler")["status"], "unsupported")
        self.assertEqual(diagnose("sequence", probe=Host(), require_openeuler=True)["status"], "ready")

    def test_missing_proc_or_static_libc_blocks_group3(self):
        host = Host()
        del host.files["/proc/self/smaps"]
        host.results[("gcc", "-print-file-name=libc.a")] = {"status": "passed", "detail": "libc.a"}
        r = diagnose("group3", probe=host)
        self.assertEqual(item(r, "smaps")["status"], "missing")
        self.assertEqual(item(r, "static_libc")["status"], "missing")
        self.assertEqual(r["status"], "blocked")

    def test_group3_checks_link_tools_and_existing_libc_path(self):
        r = diagnose("group3", probe=Host())
        for name in ("gcc", "strace", "file", "ldd", "readelf"):
            self.assertEqual(item(r, "tool." + name)["status"], "passed")
        self.assertEqual(item(r, "static_libc")["status"], "passed")
        self.assertIn("尚未验证静态链接", item(r, "static_libc")["detail"])

    def test_thp_requires_pmd_but_never_claims_huge_page_residency(self):
        host = Host()
        del host.files["/sys/kernel/mm/transparent_hugepage/hpage_pmd_size"]
        r = diagnose("thp", probe=host)
        self.assertEqual(r["status"], "blocked")
        self.assertEqual(item(r, "thp.pmd")["status"], "missing")
        self.assertIn("不保证", r["scope"])

    def test_low_resources_are_warnings_missing_values_are_not_zero(self):
        host = Host()
        host.files["/proc/meminfo"] = "MemAvailable: 1024 kB"
        host.disk_free = lambda path: 100
        r = diagnose("group3", probe=host)
        self.assertEqual(item(r, "memory")["status"], "warning")
        self.assertEqual(item(r, "disk")["status"], "warning")
        self.assertEqual(r["status"], "ready")
        del host.files["/proc/meminfo"]
        self.assertEqual(item(diagnose("sequence", probe=host), "memory")["status"], "not_checked")

    def test_unreadable_page_size_is_a_failure(self):
        host = Host()
        host.page_size = lambda: (_ for _ in ()).throw(OSError("unavailable"))
        r = diagnose("sequence", probe=host)
        self.assertEqual(item(r, "page_size")["status"], "failed")

    def test_cgroup_limit_uses_process_membership_and_keeps_unknown_distinct(self):
        host = Host()
        host.files.update({"/proc/self/cgroup": "0::/my-group",
                           str(Path("/sys/fs/cgroup/my-group/memory.max")): str(512 * 1024 ** 2),
                           str(Path("/sys/fs/cgroup/my-group/memory.current")): str(128 * 1024 ** 2)})
        check = item(diagnose("group3", probe=host), "memory.cgroup")
        self.assertEqual(check["status"], "warning")
        self.assertIn("384 MiB", check["detail"])
        host.files[str(Path("/sys/fs/cgroup/my-group/memory.max"))] = "max"
        self.assertEqual(item(diagnose("group3", probe=host), "memory.cgroup")["status"], "passed")
        del host.files["/proc/self/cgroup"]
        self.assertEqual(item(diagnose("group3", probe=host), "memory.cgroup")["status"], "not_checked")

    def test_python_version_and_missing_project_file(self):
        host = Host()
        host.python_version = (3, 9, 9)
        host.absent.add(str(ROOT / "work/launch.py"))
        r = diagnose("sequence", probe=host)
        self.assertEqual(item(r, "python")["status"], "unsupported")
        self.assertEqual(item(r, "project.files")["status"], "missing")

    def test_vm_default_does_not_start_distro_or_connect(self):
        host = Host()
        host.system = "Windows"
        r = diagnose("vm", probe=host)
        self.assertEqual(r["status"], "incomplete")
        self.assertEqual(host.calls, [(["wsl", "--list", "--quiet"], 5)])
        self.assertEqual(item(r, "vm.guest")["status"], "not_checked")

    def test_missing_wsl_and_missing_ubuntu_are_reported(self):
        host = Host()
        host.system = "Windows"
        host.absent.add("wsl")
        self.assertEqual(item(diagnose("vm", probe=host), "wsl")["status"], "missing")
        host.absent.clear()
        host.results[("wsl", "--list", "--quiet")] = {"status": "passed", "detail": "Ubuntu-24.04"}
        self.assertEqual(item(diagnose("vm", probe=host), "wsl.ubuntu")["status"], "failed")

    def test_guest_failure_and_invalid_json_do_not_crash(self):
        for response in ({"status": "timeout", "detail": "SSH timeout"},
                         {"status": "passed", "detail": "not JSON"},
                         {"status": "passed", "detail": '{"smaps":"true"}'}):
            with patch("vmobserve.doctor.vm.inspect_guest", return_value=response):
                r = diagnose("vm", probe=Host(), connect=True)
                self.assertEqual(item(r, "vm.guest")["status"], "failed")

    def test_guest_dependencies_and_real_openeuler_are_required(self):
        guest = dict(system="Linux", kernel="6.6.0-test", distribution="openeuler", smaps=True,
                     python_version=[3, 10, 0],
                     tools={n: True for n in ("gcc", "python3", "strace", "file", "ldd", "readelf")})
        def report(value):
            with patch("vmobserve.doctor.vm.inspect_guest", return_value={"status": "passed", "detail": json.dumps(value)}):
                return diagnose("vm", probe=Host(), connect=True)
        self.assertEqual(report(guest)["status"], "ready")
        guest["tools"]["strace"] = False
        self.assertEqual(item(report(guest), "vm.guest.tool.strace")["status"], "missing")
        guest["distribution"] = "ubuntu"
        self.assertEqual(item(report(guest), "vm.guest")["status"], "unsupported")
        guest["python_version"] = [3, 9, 9]
        self.assertEqual(item(report(guest), "vm.guest.python")["status"], "unsupported")

    def test_ssh_connection_is_strict_bounded_and_paths_are_quoted(self):
        host = Host()
        inspect_guest(host, PurePosixPath("/tmp/VM Observe/$test"))
        argv, timeout = host.calls[-1]
        self.assertEqual(timeout, 20)
        self.assertEqual(argv, ["bash", "-s"])
        script = host.inputs[-1]
        self.assertIn(shlex.quote("/tmp/VM Observe/$test/config.sh"), script)
        self.assertIn("StrictHostKeyChecking=yes", script)
        self.assertIn("UpdateHostKeys=no", script)
        self.assertNotIn("accept-new", script)
        self.assertNotIn("start.sh", script)

    def test_windows_shell_source_is_sent_over_stdin(self):
        host = Host()
        host.system = "Windows"
        path = Path("C:/VM Observe/$test")
        host.results[("wsl", "-d", "Ubuntu", "--exec", "wslpath", "-a", path.as_posix())] = {
            "status": "passed", "detail": "/mnt/c/VM Observe/$test"}
        inspect_guest(host, path)
        self.assertEqual(host.calls[-1][0], ["wsl", "-d", "Ubuntu", "--exec", "bash", "-s"])
        self.assertIn(shlex.quote("/mnt/c/VM Observe/$test/config.sh"), host.inputs[-1])

    def test_script_input_uses_utf8_without_a_second_stdin_argument(self):
        result = subprocess.CompletedProcess(["bash", "-s"], 0, stdout=b"ok", stderr=b"")
        with patch("vmobserve.doctor.probe.subprocess.run", return_value=result) as run:
            Probe().command(["bash", "-s"], input_text="echo 中文")
            self.assertEqual(run.call_args.kwargs["input"], "echo 中文".encode("utf-8"))
            self.assertNotIn("stdin", run.call_args.kwargs)

    def test_invalid_options_fail_before_checks(self):
        for kwargs in (dict(profile="unknown"), dict(profile="replay", connect=True),
                       dict(profile="vm", require_openeuler=True)):
            with self.assertRaises(ValueError):
                diagnose(**kwargs)

    def test_status_prioritizes_blockers_then_unchecked_requirements(self):
        checks = [dict(required=True, status="not_checked"), dict(required=False, status="warning")]
        self.assertEqual(summarize(checks), "incomplete")
        checks.append(dict(required=True, status="failed"))
        self.assertEqual(summarize(checks), "blocked")


class InterfaceTests(unittest.TestCase):
    def test_utf16_wsl_output_and_unicode_output(self):
        value = "Ubuntu\nDebian"
        for encoded in (value.encode("utf-16"), value.encode("utf-16-le"), value.encode("utf-8")):
            self.assertEqual(decode(encoded), value)

    def test_wsl_warning_and_linux_error_can_share_a_pipe(self):
        warning = "wsl: 检测到 localhost 代理配置。\r\n"
        error = "Host key verification failed.\r\n"
        for prefix in (b"", b"\xff\xfe"):
            raw = prefix + warning.encode("utf-16-le") + error.encode("utf-8")
            self.assertEqual(decode(raw), (warning + error).strip())

    def test_command_errors_are_results(self):
        for error, expected in ((FileNotFoundError(), "missing"), (PermissionError(), "failed"),
                                (subprocess.TimeoutExpired(["gcc"], 5), "timeout")):
            with patch("vmobserve.doctor.probe.subprocess.run", side_effect=error):
                self.assertEqual(Probe().command(["gcc", "--version"])["status"], expected)

    def test_json_exit_codes_and_refusal_to_overwrite(self):
        report = dict(status="incomplete", checks=[], scope="test")
        with tempfile.TemporaryDirectory() as tmp, patch("vmobserve.doctor.cli.diagnose", return_value=report):
            p = Path(tmp) / "diagnosis.json"
            with redirect_stdout(io.StringIO()) as output:
                self.assertEqual(main(["--json", "--output", str(p)]), 2)
            self.assertEqual(json.loads(output.getvalue())["status"], "incomplete")
            original = p.read_bytes()
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--output", str(p)]), 1)
            self.assertEqual(p.read_bytes(), original)
            for status, code in (("ready", 0), ("blocked", 1)):
                report["status"] = status
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(main(["--json"]), code)

    def test_invalid_cli_combination_does_not_diagnose(self):
        with patch("vmobserve.doctor.cli.diagnose") as check, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                main(["--connect"])
            self.assertEqual(error.exception.code, 2)
            check.assert_not_called()


if __name__ == "__main__":
    unittest.main()
