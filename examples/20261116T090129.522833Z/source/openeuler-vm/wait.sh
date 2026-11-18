#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
for ((i=0;i<36;i++)); do
 if ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 uname -r; then exit 0; fi
 sleep 5
done
exit 1
