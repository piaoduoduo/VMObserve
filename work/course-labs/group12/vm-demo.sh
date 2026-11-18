#!/bin/bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$here/../../openeuler-vm/config.sh"
guest=/home/oslab/os-course/group12-20261116
container_dir=/root/os-course/group12/container
case "${1:-status}" in
    status) command="set -e; id oslab; systemctl is-active isulad isula-build; systemctl is-enabled isulad isula-build; git --version; isula images; isula inspect gcc-lab:course-20261116 >/dev/null; ls $guest/git-evidence/*.patch" ;;
    basics) command="runuser -l oslab -c 'bash $guest/basics/run_basics.sh'" ;;
    git) command="runuser -l oslab -c 'bash $guest/git_demo.sh'" ;;
    container) command="bash $container_dir/observe_container.sh" ;;
    linkage) command="bash $container_dir/observe_container.sh --linkage" ;;
    shell) exec ssh -t "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 'su - oslab' ;;
    *) echo 'usage: vm-demo.sh {status|basics|git|container|linkage|shell}' >&2; exit 2 ;;
esac
ssh "${SSH_OPTS[@]}" -p "$VM_PORT" root@127.0.0.1 "$command"
