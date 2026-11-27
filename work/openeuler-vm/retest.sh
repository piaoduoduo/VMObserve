#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
caller_dir="$PWD"
cd -- "$VM_DIR"
stamp="$(date -u +%Y%m%dT%H%M%S)-$$"
transport="$VM_DIR/transfers/$stamp"
remote="/root/proj5-transfers/$stamp"
mkdir -p "$transport" "$VM_DIR/guest-runs"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stage=package
finish_transfer() {
 local final_rc=$?
 python3 - "$transport" "$final_rc" "$stage" "$started_at" <<'PYEND'
import datetime,json,sys
from pathlib import Path
p=Path(sys.argv[1])
old=json.loads((p/'transfer.json').read_text()) if (p/'transfer.json').exists() else {}
old.update(kind='real_vm_transport',status='completed' if int(sys.argv[2])==0 else 'failed',exit_code=int(sys.argv[2]),stage=sys.argv[3],host_started_at=sys.argv[4],host_finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),clock_note='Guest timestamps may differ from host; use per-run identifiers and hashes, not cross-host chronological ordering.')
(p/'transfer.json').write_text(json.dumps(old,indent=2)+'\n')
PYEND
}
trap finish_transfer EXIT
python3 "$WORK_DIR/package_sources.py" "$transport/experiments.tar.gz"
# No package-manager changes during ordinary verification.
stage=preflight
ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 "set -e; mkdir -p '$remote'; command -v gcc; command -v python3; uname -r; date -u +GUEST_UTC=%Y-%m-%dT%H:%M:%SZ" > "$transport/preflight.log" 2>&1
stage=upload
scp "${SSH_OPTS[@]}" -P "$VM_PORT" "$transport/experiments.tar.gz" "root@127.0.0.1:$remote/source.tar.gz" > "$transport/upload.log" 2>&1
# Local paths that the runner needs are staged under fixed names in the guest.
runner_args=()
student_source=''
while (( $# )); do
 if [[ "$1" == --recheck-from ]]; then
  test "$#" -ge 2
  PYTHONPATH="$WORK_DIR" python3 - "$2" "$transport/parent" <<'CHECK'
import sys
from pathlib import Path
from shutil import copyfile
from vmobserve.common import digest
from vmobserve.replay import load_run, safe_child

parent, staging = map(Path, sys.argv[1:])
report = load_run(parent)
if report["integrity"]["status"] != "verified" or report["data_origin"] != "real_execution":
    raise SystemExit("Recheck needs a verified real v1 record")
staging.mkdir()
for name, expected in (("report.json", report["original_report_sha256"]),
                       ("environment.json", report["artifacts"]["environment.json"])):
    target = staging / name
    copyfile(safe_child(parent, name), target)
    if digest(target) != expected:
        raise SystemExit(f"Parent record changed while preparing {name}")
CHECK
  ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 "mkdir -p '$remote/parent'"
  scp "${SSH_OPTS[@]}" -P "$VM_PORT" "$transport/parent/report.json" "$transport/parent/environment.json" "root@127.0.0.1:$remote/parent/" >> "$transport/upload.log" 2>&1
  runner_args+=(--recheck-from "$remote/parent")
  shift 2
 elif [[ "$1" == --student-source || "$1" == --student-source=* ]]; then
  if [[ -n "$student_source" ]]; then echo 'Supply --student-source only once' >&2; exit 2; fi
  if [[ "$1" == --student-source ]]; then
   if (( $# < 2 )); then echo '--student-source requires a file' >&2; exit 2; fi
   student_source="$2"
   shift 2
  else
   student_source="${1#*=}"
   shift
  fi
  if [[ -z "$student_source" ]]; then echo '--student-source requires a file' >&2; exit 2; fi
  if [[ "$student_source" != /* ]]; then student_source="$caller_dir/$student_source"; fi
  if [[ ! -f "$student_source" ]]; then echo 'Student source file does not exist' >&2; exit 2; fi
  runner_args+=(--student-source "$remote/student.c")
 elif [[ "$1" == --output || "$1" == --output=* ]]; then
  echo "retest.sh owns output placement to guarantee retrieval" >&2; exit 2
 else
  runner_args+=("$1")
  shift
 fi
done
source_check=''
if [[ -n "$student_source" ]]; then
 cp -- "$student_source" "$transport/student.c"
 (cd -- "$transport" && sha256sum student.c > student-source.sha256)
 scp "${SSH_OPTS[@]}" -P "$VM_PORT" "$transport/student.c" "$transport/student-source.sha256" "root@127.0.0.1:$remote/" >> "$transport/upload.log" 2>&1
 source_check='sha256sum -c student-source.sha256; '
fi
extra=''
if (( ${#runner_args[@]} )); then printf -v extra ' %q' "${runner_args[@]}"; fi
# Retrieve this transfer's outputs even when the runner exits nonzero.
rc=0
stage=guest_execution
ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 "set -e; cd '$remote'; ${source_check}tar xzf source.tar.gz; VMOBSERVE_CONTEXT=qemu-tcg python3 run_all.py --require-openeuler $extra" > "$transport/guest-run.log" 2>&1 || rc=$?
stage=retrieval
retrieval_rc=0
scp -r "${SSH_OPTS[@]}" -P "$VM_PORT" "root@127.0.0.1:$remote/runs/" "$transport/" > "$transport/retrieval.log" 2>&1 || retrieval_rc=$?
if (( retrieval_rc == 0 )); then
 for result in "$transport"/runs/*; do
  destination="$VM_DIR/guest-runs/$(basename -- "$result")"
  if test -e "$destination"; then echo "Refusing to overwrite $destination" >&2; exit 1; fi
  # Publish only after the whole copy is ready. A reader must never encounter
  # report.json while the source/evidence files are still being copied.
  staging="$transport/publish-$(basename -- "$result")"
  cp -a -- "$result" "$staging"
  mv -T -- "$staging" "$destination"
  echo "EVIDENCE_DIRECTORY=$destination"
 done
fi
python3 - "$transport" "$rc" "$retrieval_rc" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
(p/'transfer.json').write_text(json.dumps({'remote_exit_code':int(sys.argv[2]),'retrieval_exit_code':int(sys.argv[3]),'kind':'real_vm_transport'},indent=2)+'\n')
PY
cat "$transport/guest-run.log"
(( retrieval_rc == 0 )) || exit 1
exit "$rc"
