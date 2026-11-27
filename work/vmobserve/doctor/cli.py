"""Human-readable and JSON interfaces for the standalone diagnostic."""
import argparse
import json
from pathlib import Path
import sys

from .checks import PROFILES, diagnose

LABELS = {"passed": "通过", "missing": "缺失", "failed": "失败", "unsupported": "不支持",
          "warning": "提示", "not_checked": "未检查"}
EXIT_CODES = {"ready": 0, "blocked": 1, "incomplete": 2}


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="VMObserve 环境诊断；不安装依赖、不运行实验")
    parser.add_argument("--profile", choices=PROFILES, default="replay")
    parser.add_argument("--require-openeuler", action="store_true", help="要求真正 openEuler 用户态及内核")
    parser.add_argument("--connect", action="store_true", help="显式连接已有 VM；可能启动配置的 WSL 发行版")
    parser.add_argument("--json", action="store_true", help="向标准输出写 JSON")
    parser.add_argument("--output", type=Path, help="另存 JSON；拒绝覆盖已有文件")
    args = parser.parse_args(argv)
    if args.connect and args.profile != "vm":
        parser.error("--connect 只适用于 --profile vm")
    if args.require_openeuler and args.profile in ("replay", "vm"):
        parser.error("--require-openeuler 只适用于 student/sequence/group3/thp")
    report = diagnose(args.profile, require_openeuler=args.require_openeuler, connect=args.connect)
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.json:
        print(payload, end="")
    else:
        print(f"VMObserve 环境诊断：{args.profile} / {report['status']}")
        for c in report["checks"]:
            print(f"[{LABELS[c['status']]}] {c['id']}: {c['detail']}")
            if c["advice"] and c["status"] != "passed":
                print(f"  建议：{c['advice']}")
        print(report["scope"])
    if args.output:
        try:
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(payload)
        except OSError as exc:
            print(f"无法写入诊断文件：{exc}", file=sys.stderr)
            return 1
    return EXIT_CODES[report["status"]]
