"""Keep diagnostics separate from the runner, server and report schema."""
from datetime import datetime, timezone
import json
from pathlib import Path

from .probe import Probe
from ..pagemap import cap_sys_admin

PROFILES = ("replay", "sequence", "group3", "thp", "vm")
WORK = Path(__file__).resolve().parents[2]


def summarize(checks):
    blocking = {"missing", "failed", "unsupported"}
    if any(c["required"] and c["status"] in blocking for c in checks):
        return "blocked"
    if any(c["required"] and c["status"] == "not_checked" for c in checks):
        return "incomplete"
    return "ready"


def diagnose(profile="replay", *, require_openeuler=False, connect=False, probe=None, root=None):
    if profile not in PROFILES:
        raise ValueError("unknown diagnostic profile")
    if connect and profile != "vm":
        raise ValueError("--connect 只适用于 --profile vm")
    if require_openeuler and profile in ("replay", "vm"):
        raise ValueError("--require-openeuler 只适用于本机 Linux 采集检查")
    probe = probe or Probe()
    project_work = Path(root) / "work" if root is not None else WORK
    root = project_work.parent
    checks = []

    def add(identifier, status, detail, advice="", required=True):
        checks.append(dict(id=identifier, status=status, required=required,
                           detail=detail, advice=advice))

    def read(path):
        try:
            return probe.read(path).strip()
        except (OSError, UnicodeError):
            return None

    def tool(name, args=("--version",)):
        result = probe.command([name, *args]) if probe.which(name) else {
            "status": "missing", "detail": "未在 PATH 中找到"}
        add("tool." + name, result["status"] if result["status"] != "timeout" else "failed",
            result["detail"], f"在目标 Linux 中安装或修复 {name}，再重新检查。")
        return result["status"] == "passed"

    add("python", "passed" if probe.python_version >= (3, 10) else "unsupported",
        ".".join(map(str, probe.python_version)), "需要 Python 3.10 或更高版本。")

    # Existing manifests are the source of truth for files copied by the runner.
    try:
        from ..runner import source_files
        files = [project_work / p.relative_to(WORK) for p in source_files()]
        files += [project_work / name for name in (
            "launch.py", "run_all.py", "vmobserve/server.py", "vmobserve/replay.py",
            "vmobserve/export.py", "vmobserve/web/index.html", "vmobserve/web/lesson.html",
            "vmobserve/web/app.js", "vmobserve/web/style.css")]
        missing = [str(p.relative_to(root)) for p in files if not probe.exists(p)]
        add("project.files", "missing" if missing else "passed",
            "缺少：" + ", ".join(missing) if missing else "运行器登记的源码与网页文件存在",
            "重新检出完整仓库；不要只复制入口脚本。")
    except (OSError, ValueError, ImportError, SyntaxError) as exc:
        add("project.files", "failed", str(exc), "检查项目代码是否完整。")

    if profile == "replay":
        _replay(root, add)
    elif profile == "vm":
        _vm(root, probe, add, connect)
    else:
        if probe.system != "Linux":
            add("linux", "unsupported", f"当前系统为 {probe.system}，不能直接进行 Linux 采集",
                "可先用 --profile replay 检查回放；采集检查请在目标 Linux 中执行。")
        else:
            add("linux", "passed", probe.kernel)
            release = read("/etc/os-release")
            distribution = {}
            for line in (release or "").splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    distribution[key] = value.strip('"\'')
            is_openeuler = distribution.get("ID", "").lower() == "openeuler" and "microsoft" not in probe.kernel.lower()
            add("distribution", "passed" if release else "warning",
                distribution.get("PRETTY_NAME", "发行版信息不可读"), required=False)
            if require_openeuler:
                add("openeuler", "passed" if is_openeuler else "unsupported",
                    "openEuler 用户态和非 WSL 内核" if is_openeuler else "不满足真正 openEuler 用户态与内核的条件",
                    "在 openEuler 客体内运行此检查；WSL 中的用户态名称不能证明内核来自 openEuler。")
            smaps = read("/proc/self/smaps")
            add("smaps", "passed" if smaps else "missing", "可读取自身映射" if smaps else "自身 smaps 不可读",
                "确认 /proc 已挂载且允许读取 /proc/self/smaps。")
            gcc = tool("gcc")
            if profile in ("sequence", "group3"):
                tool("strace")
            if profile == "group3":
                for name in ("file", "ldd", "readelf"):
                    tool(name)
                result = probe.command(["gcc", "-print-file-name=libc.a"]) if gcc else None
                value = result["detail"] if result and result["status"] == "passed" else ""
                found = bool(value and value != "libc.a" and probe.exists(value))
                add("static_libc", "passed" if found else "missing",
                    "GCC 可定位 libc.a；尚未验证静态链接" if found else "GCC 无法定位静态 libc 库",
                    "安装目标发行版的静态 libc 开发包；完整链接能力仍以实际编译为准。")
            _memory(probe, read, add, profile)
            try:
                free = probe.disk_free(root)
                add("disk", "warning" if free < 128 * 1024 ** 2 else "passed",
                    f"项目所在磁盘可用 {free // 1024 ** 2} MiB",
                    "采集会保存源码和原文，请为新记录预留空间。", required=False)
            except OSError as exc:
                add("disk", "not_checked", str(exc), required=False)

    return dict(schema_version="vmobserve.doctor/v1", profile=profile,
                checked_at=datetime.now(timezone.utc).isoformat(),
                host=dict(system=probe.system, kernel=probe.kernel),
                status=summarize(checks), checks=checks,
                scope="环境必要条件检查；未编译或运行实验，ready 不保证实验成功或观察到大页。")


def _replay(root, add):
    try:
        from ..replay import load_run
    except (ImportError, SyntaxError) as exc:
        add("replay.engine", "failed", str(exc), "恢复完整的回放模块和依赖后重试。")
        return
    reports = sorted((root / "examples").glob("*/report.json"))
    if not reports:
        add("examples", "missing", "没有内置实验记录", "完整检出 examples 目录。")
    for path in reports:
        try:
            report = load_run(path.parent)
            integrity = report["integrity"]["status"]
            passed = all(c.get("validation", {}).get("status") == "passed" for c in report["cases"])
            status = "failed" if integrity == "failed" or not passed or not report["cases"] else (
                "warning" if integrity != "verified" else "passed")
            add("example." + path.parent.name, status,
                f"{len(report['cases'])} 个案例，完整性 {integrity}，案例校验{'通过' if passed else '未全部通过'}",
                "失败时核对原始文件和哈希；不要修改报告以掩盖错误。" if status == "failed" else "")
        except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as exc:
            add("example." + path.parent.name, "failed", str(exc), "重新获取完整实测记录。")


def _memory(probe, read, add, profile):
    if profile in ("group3", "thp"):
        try:
            readable = probe.pagemap_readable()
        except OSError:
            readable = False
        admin = cap_sys_admin(read("/proc/self/status"))
        add("pagemap.present", "passed" if readable else "warning",
            "可读取自身页表项的 Present 位" if readable else "无法读取自身 pagemap，仍可采集 smaps",
            required=False)
        if admin is True and readable:
            detail = "具备 CAP_SYS_ADMIN，实采时按驻留页读到的非零 PFN 判定可见性"
        elif admin is True and not readable:
            detail = "无法读取自身 pagemap，因此无法读出 PFN"
        elif admin is False:
            detail = "没有 CAP_SYS_ADMIN，内核会屏蔽 PFN"
        else:
            detail = "未核实读取 PFN 的条件"
        add("pagemap.pfn", "passed" if admin and readable else "not_checked" if admin is None else "warning",
            detail, required=False)
    try:
        page = probe.page_size()
        add("page_size", "passed" if page > 0 else "failed", f"基础页 {page} 字节")
    except (OSError, ValueError, AttributeError) as exc:
        add("page_size", "failed", str(exc))
    thp = read("/sys/kernel/mm/transparent_hugepage/enabled")
    pmd = read("/sys/kernel/mm/transparent_hugepage/hpage_pmd_size")
    add("thp.policy", "not_checked" if not thp else "warning" if "[never]" in thp else "passed", thp or "无法读取全局大页策略",
        "策略只影响观测条件；实际大页驻留需查看本次 smaps 的 AnonHugePages。", required=False)
    if profile == "thp":
        add("thp.pmd", "passed" if pmd and pmd.isdigit() and int(pmd) > 0 else "missing",
            f"PMD 大页尺寸：{pmd or '未提供'}", "此大页探针需要内核提供 PMD THP 尺寸。")
    available = {}
    for line in (read("/proc/meminfo") or "").splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] in ("MemAvailable:", "SwapFree:") and parts[1].isdigit():
            available[parts[0][:-1]] = int(parts[1]) // 1024
    mem = available.get("MemAvailable")
    add("memory", "not_checked" if mem is None else "warning" if mem < 768 else "passed",
        "MemAvailable 未提供" if mem is None else f"系统可用内存 {mem} MiB；此数未扣除容器/cgroup 限制",
        "group3 会写入 512 MiB；可用内存较少时先关闭其他应用。" if profile == "group3" else
        "可用内存不是分配保证，容器限额、并发负载和交换均可能影响结果。", required=False)
    # Report only the current process's limit, not an assumed root cgroup limit.
    membership = read("/proc/self/cgroup")
    cgroup_path = next((line[3:] for line in (membership or "").splitlines() if line.startswith("0::")), None)
    limit = current = None
    if cgroup_path is not None and ".." not in Path(cgroup_path).parts:
        base = Path("/sys/fs/cgroup") / cgroup_path.lstrip("/")
        limit, current = read(base / "memory.max"), read(base / "memory.current")
    if limit == "max":
        add("memory.cgroup", "passed", "当前 cgroup v2 没有设置直接内存上限；祖先层级仍可能限制它", required=False)
    elif limit and limit.isdigit() and current and current.isdigit():
        headroom = max(0, int(limit) - int(current)) // 1024 ** 2
        add("memory.cgroup", "warning" if headroom < 768 else "passed",
            f"当前 cgroup v2 上限 {int(limit) // 1024 ** 2} MiB，当前用量之外约 {headroom} MiB",
            "这是当前层级的瞬时余量，未合并祖先限额，也不保证后续分配成功。", required=False)
    else:
        add("memory.cgroup", "not_checked", "未获得当前 cgroup v2 的内存上限和用量",
            "cgroup v1、自定义挂载和祖先限额请另外检查；不以系统 MemAvailable 代替容器余量。", required=False)


def _vm(root, probe, add, connect):
    vm = root / "work/openeuler-vm"
    for name in ("config.sh", "status.sh", "start.sh", "retest.sh"):
        add("vm.file." + name, "passed" if probe.exists(vm / name) else "missing", name,
            "完整检出 work/openeuler-vm 脚本。")
    image = probe.exists(vm / "verified-image.qcow2.xz")
    add("vm.image", "passed" if image else "warning",
        "启动脚本要求的压缩镜像存在；未校验镜像内容" if image else "未找到启动脚本要求的 verified-image.qcow2.xz",
        "仓库不附带镜像。已有运行中的 VM 仍可能可连接；新建/启动需另行准备镜像。", required=False)
    if probe.system == "Windows":
        if not probe.which("wsl"):
            add("wsl", "missing", "未找到 wsl.exe", "安装 WSL 和名为 Ubuntu 的发行版。")
            return
        result = probe.command(["wsl", "--list", "--quiet"])
        present = result["status"] == "passed" and "Ubuntu" in result["detail"].splitlines()
        add("wsl.ubuntu", "passed" if present else "failed", result["detail"],
            "现有 vm.ps1 固定调用 Ubuntu；确认该发行版已安装。")
        if not present:
            return
    elif probe.system == "Linux":
        for name in ("bash", "ssh", "scp", "qemu-system-x86_64", "qemu-img", "cloud-localds", "xz", "ssh-keygen"):
            if name == "cloud-localds":
                # cloud-localds has no reliable --version option on all releases.
                add("tool." + name, "passed" if probe.which(name) else "missing", "PATH 可定位" if probe.which(name) else "未安装",
                    "准备 VM 创建工具；不影响已经运行的客体连接。", required=False)
            else:
                # SSH uses -V; scp has no portable version flag.
                add("tool." + name, "passed" if probe.which(name) else "warning",
                    "PATH 可定位" if probe.which(name) else "PATH 中不存在", required=False)
    else:
        add("vm.host", "unsupported", f"既有脚本不支持 {probe.system}")
        return
    if not connect:
        add("vm.guest", "not_checked", "尚未连接客体；未读取客体工具、镜像状态、密钥或 SSH 信任记录",
            "需要验证既有客体时使用 --profile vm --connect；此选项可能启动 WSL Ubuntu。")
        return
    from .vm import inspect_guest
    result = inspect_guest(probe, vm)
    if result["status"] != "passed":
        add("vm.guest", "failed", result["detail"],
            "检查 WSL、SSH 密钥、已有主机信任记录和 VM 状态；本工具不启动 VM 或接受新主机密钥。")
        return
    try:
        guest = json.loads(result["detail"])
        if (not isinstance(guest, dict)
                or not all(isinstance(guest.get(k), str) for k in ("system", "kernel", "distribution"))
                or not isinstance(guest.get("tools"), dict)
                or type(guest.get("smaps")) is not bool
                or not isinstance(guest.get("python_version"), list)
                or len(guest["python_version"]) != 3
                or not all(type(v) is int for v in guest["python_version"])
                or not all(type(v) is bool for v in guest["tools"].values())):
            raise ValueError("客体诊断字段不完整")
        is_openeuler = guest["distribution"].lower() == "openeuler" and "microsoft" not in guest["kernel"].lower()
        add("vm.guest", "passed" if guest["system"] == "Linux" and is_openeuler else "unsupported",
            f"{guest['system']} / {guest['distribution']} / {guest['kernel']}", "既有 VM 运行要求真正的 openEuler。")
        version = guest["python_version"]
        add("vm.guest.python", "passed" if tuple(version) >= (3, 10) else "unsupported",
            ".".join(map(str, version)), "客体需要 Python 3.10 或更高版本。")
        for name in ("python3", "gcc", "strace", "file", "ldd", "readelf"):
            found = guest["tools"].get(name)
            add("vm.guest.tool." + name, "passed" if found else "missing", "可定位" if found else "未找到",
                "在客体中准备此工具，连接成功不代表采集依赖完整。")
        add("vm.guest.smaps", "passed" if guest["smaps"] else "missing", "可读" if guest["smaps"] else "不可读")
        add("vm.scope", "warning", "只检查工具可定位和自身 smaps；未验证编译、静态链接、THP 或传输", required=False)
    except (ValueError, TypeError, AttributeError) as exc:
        add("vm.guest", "failed", f"无法解析客体诊断：{exc}")
