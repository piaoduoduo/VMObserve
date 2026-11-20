#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
cd -- "$VM_DIR"
if test -f vm.pid && test -r "/proc/$(cat vm.pid)/cmdline" && grep -aq 'experiment.qcow2' "/proc/$(cat vm.pid)/cmdline"; then
 echo 'Experiment VM already running'; exit 0
fi
test -f verified-image.qcow2.xz
if ! test -f base.qcow2; then
 xz -dc verified-image.qcow2.xz > base.qcow2.partial
 mv base.qcow2.partial base.qcow2
fi
test -f experiment.qcow2 || qemu-img create -f qcow2 -F qcow2 -b "$PWD/base.qcow2" experiment.qcow2
mkdir -p "$VM_STATE_DIR"
test -f "${VM_KEY}" || ssh-keygen -q -t ed25519 -N '' -f "${VM_KEY}"
key=$(cat "${VM_KEY}.pub")
cat > user-data <<EOF
#cloud-config
disable_root: false
ssh_pwauth: false
users:
  - name: root
    ssh_authorized_keys:
      - $key
runcmd:
  - [systemctl, enable, --now, sshd]
EOF
printf 'instance-id: proj5-openeuler-01\nlocal-hostname: proj5-openeuler\n' > meta-data
cloud-localds seed.img user-data meta-data
qemu-system-x86_64 -accel tcg,thread=multi -cpu max -smp 2 -m 2048 \
 -drive file=experiment.qcow2,if=virtio,format=qcow2 \
 -drive file=seed.img,if=virtio,format=raw \
 -netdev user,id=n1,hostfwd=tcp:127.0.0.1:${VM_PORT}-:22 -device virtio-net-pci,netdev=n1 \
 -display none -serial file:serial.log -monitor "unix:${VM_STATE_DIR}/monitor.sock,server,nowait" \
 -pidfile vm.pid -daemonize
echo "VM started; SSH forwarded on WSL localhost:$VM_PORT"
