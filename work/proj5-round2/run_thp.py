"""Legacy entry. Unique outputs are saved under work/runs/."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vmobserve.runner import main

if __name__ == "__main__":
    raise SystemExit(main(["--suite", "thp", *sys.argv[1:]]))
