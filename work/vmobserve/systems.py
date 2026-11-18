"""Course probes for synchronization, files and devices. Replay checks raw observations."""
SUITES = {"sync": "course-labs/systems/sync.c", "io": "course-labs/systems/io_observe.py"}
LABS = {lab: "sync" if lab.startswith("5.") else "io"
        for lab in ("5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "7.1", "7.2", "7.3")}


def plan(repeats, lab):
    return [{"id": f"lab-{number}-{repeat}", "suite": suite, "parameters": {"lab": number, "repeat": repeat},
             "arguments": [number]} for number, suite in LABS.items() if lab in ("all", number)
            for repeat in range(1, repeats + 1)]


def parse(records, suite, lab):
    if LABS.get(lab) != suite or not records:
        raise ValueError("missing course observations")
    for r in records:
        if r.get("lab") != lab or r.get("kind") != "observation" or "observed" not in r or not r.get("phase"):
            raise ValueError("observation does not match the planned experiment")
    if len({r["phase"] for r in records}) != len(records):
        raise ValueError("duplicate observation")
    return {"condition": {"lab": lab}, "samples": records}


def validate(data):
    lab = data["condition"]["lab"]
    values = {row["phase"]: row["observed"] for row in data["samples"]}
    checks = []

    def check(key, expected, transform=None):
        observed = values[key]
        actual = transform(observed) if transform else observed
        checks.append(dict(id=key, expected=expected, observed=actual,
                           status="passed" if actual == expected else "failed", category="correctness"))

    if lab == "5.1":
        check("放入单槽缓冲区的次数", 32)
        check("消费者取出的次数", 32)
        check("取出顺序与写入顺序不符的次数", 0)
    elif lab == "5.2":
        check("反向持锁时第二把锁返回 EBUSY 的线程数", 2)
        check("统一顺序后完成双锁操作的线程数", 2)
    elif lab == "5.3":
        check("发布端写入的值", 42)
        check("读端看到标志后读出的值", values["发布端写入的值"])
    elif lab == "6.1":
        check("顺序写入", "abc")
        check("定位到偏移 1 后覆盖", "aXc")
        check("追加模式下先定位到 0 再写", "aXc!")
        check("dup 读一字节后原描述符的偏移", 1)
        check("独立 open 的偏移", 0)
    elif lab == "6.2":
        check("原文件、硬链接、符号链接自身的 inode", True, lambda v: len(v) == 3 and v[0] == v[1] != v[2])
        check("原文件的硬链接数", 2)
        check("从硬链接看到的权限", "0o600")
        check("删除原路径后从硬链接读取", "hello")
        check("符号链接还在、目标还在", [True, False])
    elif lab == "6.3":
        check("/ 的文件系统", True, bool)
        check("/proc 的文件系统", "proc")
        check("/sys 的文件系统", "sysfs")
        check("/dev/shm 的文件系统", "tmpfs")
        check("从 procfs 读到的内核版本", True, bool)
        check("从 sysfs 读到的回环接口类型", 772)
    elif lab == "7.1":
        for name, size in (("null", 0), ("zero", "00" * 8), ("random", 8), ("urandom", 8)):
            check(name + " 的文件类型、主次设备号", True, lambda v: len(v) == 3 and v[0] is True)
            check(name + " 读取 8 字节的结果", size)
        check("写入 null 的返回字节数", 4)
    elif lab == "7.2":
        check("无写端时 read 的字节数", 0)
        check("有写端但无数据时 read 的结果", "EAGAIN")
        check("写入前 select 就绪数", 0)
        check("写入后 select 就绪数", 1)
        check("读到的内容", "A")
        check("最后一个写端关闭后 read 的字节数", 0)
    elif lab == "7.3":
        check("块设备、类型与挂载点", True, bool)
        check("系统中的网络接口", True, lambda v: "lo" in v)
        check("回环接口累计收发字节", True, lambda v: len(v) == 2 and all(isinstance(n, int) and n >= 0 for n in v))
    return {"status": "passed" if all(c["status"] == "passed" for c in checks) else "failed", "checks": checks}
