#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
cd -- "$VM_DIR"
if test -f vm.pid; then
 pid="$(cat vm.pid)"
 ps -p "$pid" -o pid,comm,args || true
fi
ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 'uname -r; cat /etc/os-release; command -v gcc; command -v python3; cat /sys/kernel/mm/transparent_hugepage/enabled'
