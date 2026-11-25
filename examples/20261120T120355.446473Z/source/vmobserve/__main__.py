import argparse
from pathlib import Path
import sys
from .common import run_id
from .export import export_run
from .replay import load_run


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        from .server import main as serve
        return serve(sys.argv[2:])
    parser = argparse.ArgumentParser(description="Verify/replay/export existing real evidence without executing saved code")
    parser.add_argument("action", choices=("replay", "export"))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "export":
            target = args.output or Path("replays") / run_id()
            report = export_run(args.directory, target)
            print(f"EXPORT_DIRECTORY={target.resolve()}")
        else:
            report = load_run(args.directory)
        print(f"VIEW_MODE={report['view_mode']} SOURCE={report['data_origin']} CASES={len(report['cases'])} INTEGRITY={report['integrity']['status']}")
        return 1 if report["integrity"]["status"] == "failed" else 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f"Cannot replay evidence: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
