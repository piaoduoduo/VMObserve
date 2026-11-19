"""Run one course observation in an isolated scratch directory on Linux."""
import errno
import json
import os
from pathlib import Path
import select
import stat
import subprocess
import sys
import tempfile


def offsets():
    path = Path("offset.txt")
    with path.open("w+b", buffering=0) as f:
        f.write(b"abc")
        yield "顺序写入", path.read_text()
        f.seek(1)
        f.write(b"X")
        yield "定位到偏移 1 后覆盖", path.read_text()
        with path.open("ab", buffering=0) as append:
            append.seek(0)
            append.write(b"!")
        yield "追加模式下先定位到 0 再写", path.read_text()
        f.seek(0)
        with os.fdopen(os.dup(f.fileno()), "rb", buffering=0) as alias, path.open("rb", buffering=0) as other:
            alias.read(1)
            yield "dup 读一字节后原描述符的偏移", f.tell()
            yield "独立 open 的偏移", other.tell()


def links():
    path, hard, soft = map(Path, ("original", "hard", "soft"))
    path.write_text("hello")
    os.link(path, hard)
    soft.symlink_to(path)
    yield "原文件、硬链接、符号链接自身的 inode", [p.lstat().st_ino for p in (path, hard, soft)]
    yield "原文件的硬链接数", path.stat().st_nlink
    path.chmod(0o600)
    yield "从硬链接看到的权限", oct(stat.S_IMODE(hard.stat().st_mode))
    path.unlink()
    yield "删除原路径后从硬链接读取", hard.read_text()
    yield "符号链接还在、目标还在", [soft.is_symlink(), soft.exists()]


def mounts():
    devices = {}
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        left, right = line.split(" - ", 1)
        devices[left.split()[4]] = right.split()[0]
    for point in ("/", "/proc", "/sys", "/dev/shm"):
        yield point + " 的文件系统", devices[point]
    yield "从 procfs 读到的内核版本", Path("/proc/sys/kernel/osrelease").read_text().strip()
    yield "从 sysfs 读到的回环接口类型", int(Path("/sys/class/net/lo/type").read_text())


def char_devices():
    for name in ("null", "zero", "random", "urandom"):
        path = Path("/dev") / name
        device = path.stat()
        yield name + " 的文件类型、主次设备号", [stat.S_ISCHR(device.st_mode), os.major(device.st_rdev), os.minor(device.st_rdev)]
        with path.open("rb", buffering=0) as f:
            data = f.read(8)
            yield name + " 读取 8 字节的结果", data.hex() if name == "zero" else len(data)
    with open("/dev/null", "wb", buffering=0) as f:
        yield "写入 null 的返回字节数", f.write(b"test")


def fifo():
    os.mkfifo("fifo")
    with os.fdopen(os.open("fifo", os.O_RDONLY | os.O_NONBLOCK), "rb", buffering=0) as stream:
        fd = stream.fileno()
        yield "无写端时 read 的字节数", len(os.read(fd, 1))
        with open("fifo", "wb", buffering=0) as writer:
            try:
                os.read(fd, 1)
            except BlockingIOError as exc:
                yield "有写端但无数据时 read 的结果", errno.errorcode[exc.errno]
            yield "写入前 select 就绪数", len(select.select([fd], [], [], 0)[0])
            writer.write(b"A")
            yield "写入后 select 就绪数", len(select.select([fd], [], [], 0)[0])
            yield "读到的内容", os.read(fd, 1).decode()
        yield "最后一个写端关闭后 read 的字节数", len(os.read(fd, 1))


def disk_net():
    yield "块设备、类型与挂载点", subprocess.check_output(
        ["lsblk", "-n", "-o", "NAME,TYPE,MOUNTPOINT"], text=True).strip()
    yield "系统中的网络接口", sorted(p.name for p in Path("/sys/class/net").iterdir())
    yield "回环接口累计收发字节", [int((Path("/sys/class/net/lo/statistics") / key).read_text())
                                   for key in ("rx_bytes", "tx_bytes")]


if __name__ == "__main__":
    lab = sys.argv[1]
    run = {"6.1": offsets, "6.2": links, "6.3": mounts, "7.1": char_devices, "7.2": fifo, "7.3": disk_net}[lab]
    with tempfile.TemporaryDirectory() as scratch:
        os.chdir(scratch)
        for phase, value in run():
            print(json.dumps(dict(kind="observation", lab=lab, phase=phase, observed=value), ensure_ascii=False), flush=True)
