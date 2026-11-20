#!/bin/bash
# Source from any working directory. These defaults reuse the existing VM.
VM_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(cd -- "$VM_DIR/.." && pwd)"
VM_STATE_DIR="${PROJ5_VM_STATE_DIR:-/root/proj5-vm}"
VM_KEY="${PROJ5_VM_KEY:-$VM_STATE_DIR/id_ed25519}"
VM_PORT="${PROJ5_VM_PORT:-2226}"
[[ "$VM_PORT" =~ ^[0-9]+$ ]] && (( VM_PORT > 0 && VM_PORT < 65536 )) || { echo 'Invalid PROJ5_VM_PORT' >&2; exit 2; }
SSH_OPTS=(-i "$VM_KEY" -o "UserKnownHostsFile=$VM_STATE_DIR/known_hosts" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
