"""Collect 2x2 conditions, three repeats each, without changing machine policy."""
from pathlib import Path
import json
import hashlib
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'results'
OUT.mkdir(exist_ok=True)
cmd = ['gcc', '-O2', '-std=c11', '-Wall', '-Wextra', '-Werror',
       str(ROOT / 'thp_probe.c'), '-o', str(ROOT / 'thp_probe')]
build = subprocess.run(cmd, text=True, capture_output=True, timeout=30)
(OUT / 'compile.log').write_text(build.stdout + build.stderr)
build.check_returncode()
environment = {
    'kernel': subprocess.check_output(['uname', '-r'], text=True).strip(),
    'thp_enabled': Path('/sys/kernel/mm/transparent_hugepage/enabled').read_text().strip(),
    'thp_defrag': Path('/sys/kernel/mm/transparent_hugepage/defrag').read_text().strip(),
    'glibc': subprocess.check_output(['getconf', 'GNU_LIBC_VERSION'], text=True).strip(),
}
runs = []
for pattern in ('sparse', 'full'):
    for mode in ('off', 'on'):
        for repeat in range(1, 4):
            name = f'{pattern}-{mode}-{repeat}'
            proc = subprocess.run([str(ROOT / 'thp_probe'), mode, pattern],
                                  text=True, capture_output=True, timeout=20)
            (OUT / f'{name}.jsonl').write_text(proc.stdout)
            (OUT / f'{name}.smaps.txt').write_text(proc.stderr)
            proc.check_returncode()
            data = [json.loads(line) for line in proc.stdout.splitlines()]
            condition = data[0]
            sample = next(r for r in data if r.get('phase') == 'after_write')
            values = next(r for r in data if r['kind'] == 'values')
            # Describe observed THP backing; do not equate requested-on with success.
            backing = ('fully_huge' if sample['huge_kib'] == condition['region_bytes'] // 1024
                       else 'partially_huge' if sample['huge_kib'] else 'no_observed_huge')
            runs.append({'run': name, 'condition': condition, 'sample': sample,
                         'backing': backing, 'values_ok': values['ok']})
summary = {
    'timestamp_utc': datetime.now(timezone.utc).isoformat(),
    'environment': environment,
    'scope': 'WSL2 Ubuntu controlled VMA experiment; not openEuler validation or speed benchmark',
    'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in
                      (ROOT / 'thp_probe.c', ROOT.parent / 'proj5-memory-pilot' / 'memory_probe.c')},
    'runs': runs,
}
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'environment': environment, 'runs': [
    {k: r[k] for k in ('run', 'backing', 'values_ok')} | {'rss_kib': r['sample']['rss_kib'],
      'minor_faults': r['sample']['action_minor'], 'huge_kib': r['sample']['huge_kib']} for r in runs
]}, indent=2))
