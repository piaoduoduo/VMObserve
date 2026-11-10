#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
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
# A local saved report may be supplied as the parent of a controlled recheck.
runner_args=()
while (( $# )); do
 if [[ "$1" == --recheck-from ]]; then
  test "$#" -ge 2 && test -f "$2/report.json"
  PYTHONPATH="$WORK_DIR" python3 - "$2" <<'CHECK'
import sys
from vmobserve.replay import load_run
r=load_run(sys.argv[1])
if r['integrity']['status']!='verified' or r['data_origin']!='real_execution':
 raise SystemExit('Refusing recheck: parent evidence is not a verified real v1 record')
CHECK
  scp "${SSH_OPTS[@]}" -P "$VM_PORT" "$2/report.json" "root@127.0.0.1:$remote/parent-report.json" >> "$transport/upload.log" 2>&1
  runner_args+=(--recheck-from "$remote/parent")
  shift 2
 elif [[ "$1" == --output || "$1" == --output=* ]]; then
  echo "retest.sh owns output placement to guarantee retrieval" >&2; exit 2
 else
  runner_args+=("$1")
  shift
 fi
done
extra=''
if (( ${#runner_args[@]} )); then printf -v extra ' %q' "${runner_args[@]}"; fi
# Retrieve this transfer's outputs even when the runner exits nonzero.
rc=0
stage=guest_execution
ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 "set -e; cd '$remote'; tar xzf source.tar.gz; if test -f parent-report.json; then mkdir parent; cp parent-report.json parent/report.json; fi; VMOBSERVE_CONTEXT=qemu-tcg python3 run_all.py --require-openeuler $extra" > "$transport/guest-run.log" 2>&1 || rc=$?
stage=retrieval
retrieval_rc=0
scp -r "${SSH_OPTS[@]}" -P "$VM_PORT" "root@127.0.0.1:$remote/runs/" "$transport/" > "$transport/retrieval.log" 2>&1 || retrieval_rc=$?
if (( retrieval_rc == 0 )); then
 for result in "$transport"/runs/*; do
  destination="$VM_DIR/guest-runs/$(basename -- "$result")"
  if test -e "$destination"; then echo "Refusing to overwrite $destination" >&2; exit 1; fi
  cp -a -- "$result" "$destination"
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
