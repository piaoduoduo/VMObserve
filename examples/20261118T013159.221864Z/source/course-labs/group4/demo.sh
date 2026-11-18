#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
task="${1:-all}"
case "$task" in all|4.1|4.2|4.3|4.4) ;; *) echo 'Usage: bash demo.sh [all|4.1|4.2|4.3|4.4]' >&2; exit 2;; esac
bash build.sh
destination="results/$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$destination"
run_case() {
    local label="$1";shift
    echo "--- $label ---"
    timeout 60 "$@" 2>"$destination/$label.kernel.txt" | tee "$destination/$label.jsonl" | python3 view_events.py
}
if [[ "$task" == all || "$task" == 4.1 ]]; then
    run_case fork-normal .build/fork_exec_wait .build/child_prog normal
    run_case fork-exec-failure .build/fork_exec_wait .build/child_prog exec-failure
fi
if [[ "$task" == all || "$task" == 4.2 ]]; then
    run_case pthread-unsafe .build/pthread_test unsafe
    run_case pthread-mutex .build/pthread_test mutex
fi
if [[ "$task" == all || "$task" == 4.3 ]]; then
    run_case uthread-round-robin .build/user_thread_test round-robin
    run_case uthread-blocking .build/user_thread_test blocking
fi
if [[ "$task" == all || "$task" == 4.4 ]]; then
    for mode in basic eof eagain epipe sigpipe;do run_case "pipe-$mode" .build/pipe_communication "$mode";done
    for mode in comparison condition transfer;do run_case "bank-$mode" .build/thread_communication "$mode";done
fi
echo "原始记录与ps观察保存在: $PWD/$destination"
