#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
out="$PWD/results/observe-$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$out"
exec > >(tee "$out/session.log") 2>&1
image=gcc-lab:course-20261116
name="oslab-observe-$(date -u +%Y%m%dT%H%M%S)-$$"
isula run -d --name "$name" "$image" /bin/sh -c 'exec sleep 600' > "$out/container-id.txt"
# Keep the stopped instance and its evidence even if a later observation fails.
trap 'isula stop -t 3 "$name" >/dev/null' EXIT
isula inspect "$name" > "$out/inspect-running.json"
pid=$(python3 - "$out/inspect-running.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))[0]['State']['Pid'])
PY
)
isula exec "$name" /bin/sh -ec 'cd /app; gcc -o hello-live hello.c; ./hello-live; gcc --version | head -n 1; id; ls -la /app/' | tee "$out/inside-execution.txt"
isula exec "$name" uname -r > "$out/container-kernel.txt"
isula exec "$name" cat /etc/os-release > "$out/container-release.txt"
isula exec "$name" cat /proc/1/status > "$out/container-pid1-status.txt"
uname -r > "$out/host-kernel.txt"
cat /etc/os-release > "$out/host-release.txt"
ps -o pid,ppid,user,stat,comm,args -p "$pid" | tee "$out/host-process.txt"
cat "/proc/$pid/status" > "$out/host-container-status.txt"
cat "/proc/$pid/cgroup" > "$out/host-container-cgroup.txt"
for namespace in pid mnt uts ipc net;do
    printf '%s host=%s container=%s\n' "$namespace" "$(readlink "/proc/1/ns/$namespace")" "$(readlink "/proc/$pid/ns/$namespace")"
done | tee "$out/namespaces.txt"
isula ps -a > "$out/isula-ps.txt"
isula inspect "$image" > "$out/image-inspect.json"
if [[ "${1:-}" == --linkage ]];then
    isula exec "$name" mkdir -p /opt/vmobserve
    isula cp competition-source.tar.gz "$name:/opt/vmobserve/source.tar.gz"
    isula exec "$name" /bin/sh -ec 'cd /opt/vmobserve; tar xzf source.tar.gz; python3 --version; VMOBSERVE_CONTEXT=isulad-container-in-qemu-tcg python3 run_all.py --suite baseline --repeats 1 --timeout 120' | tee "$out/competition-execution.txt"
    isula cp "$name:/opt/vmobserve/runs" "$out/competition-runs"
fi
isula stop -t 3 "$name"
trap - EXIT
isula inspect "$name" > "$out/inspect-stopped.json"
python3 - "$out" "$pid" "$name" <<'PY'
import json,pathlib,re,sys
p=pathlib.Path(sys.argv[1]);pid=int(sys.argv[2])
host=(p/'host-kernel.txt').read_text().strip();guest=(p/'container-kernel.txt').read_text().strip()
inside=(p/'container-pid1-status.txt').read_text();outside=(p/'host-container-status.txt').read_text()
namespaces={}
for line in (p/'namespaces.txt').read_text().splitlines():
    name,host_link,container_link=line.split()
    namespaces[name]={'host':host_link.split('=',1)[1], 'container':container_link.split('=',1)[1]}
expected_namespaces={'pid','mnt','uts','ipc','net'}
def isolated(name, links):
    pattern=rf'{name}:\[\d+\]'
    return (all(re.fullmatch(pattern, value) for value in links.values())
            and links['host'] != links['container'])
nspid=re.search(r'^NSpid:[ \t]+(.+)$',outside,re.M)
container_id=(p/'container-id.txt').read_text().strip()
checks={'hello_compiled_and_ran':'Hello from iSulad Container!' in (p/'inside-execution.txt').read_text(),
        'same_kernel':host==guest,
        'container_pid_one':re.search(r'^Pid:\s+1$',inside,re.M) is not None,
        'host_pid_matches_inspect':re.search(r'^Pid:\s+'+str(pid)+r'$',outside,re.M) is not None,
        'separate_namespaces':namespaces.keys()==expected_namespaces and all(isolated(n,v) for n,v in namespaces.items()),
        'host_to_container_pid':bool(nspid and nspid[1].split()==[str(pid),'1']),
        'cgroup_recorded':bool(container_id and container_id in (p/'host-container-cgroup.txt').read_text()),
        'stopped':not json.loads((p/'inspect-stopped.json').read_text())[0]['State']['Running']}
summary={'status':'passed' if all(checks.values()) else 'failed','checks':checks,'name':sys.argv[3],'host_pid':pid,'container_pid':1,'kernel':host,'namespaces':namespaces,'host_release':(p/'host-release.txt').read_text(),'container_release':(p/'container-release.txt').read_text()}
(p/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
if not all(checks.values()):
    sys.exit("Failed checks: "+", ".join(k for k,v in checks.items() if not v))
PY
echo "CONTAINER_OBSERVATION=$out"
