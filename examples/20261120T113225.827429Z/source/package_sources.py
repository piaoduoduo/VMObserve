"""Allowlist-only source package: no runs, credentials, VM images or references."""
import argparse
from pathlib import Path
import tarfile
from vmobserve.runner import source_files, WORK

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    files = source_files()
    with tarfile.open(args.output, "w:gz") as archive:
        for path in files:
            if path.is_file():
                info = archive.gettarinfo(str(path), arcname=path.relative_to(WORK).as_posix())
                info.mtime = 0
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                with path.open("rb") as stream:
                    archive.addfile(info, stream)

if __name__ == "__main__":
    main()
