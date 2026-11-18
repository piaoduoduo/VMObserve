#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
base="$PWD"
test "$(id -u)" -ne 0
out="$PWD/results/$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$out"
exec > >(tee "$out/session.log") 2>&1
printf '=== 1.1 普通用户与环境 ===\n'
whoami
id
pwd
cat /etc/os-release
uname -a
lscpu > "$out/lscpu.txt"
free -h
df -h > "$out/df.txt"
mkdir "$out/files"
cd "$out/files"
touch a.txt
printf 'openEuler course experiment\n' > a.txt
cp a.txt b.txt
mv b.txt c.txt
cmp a.txt c.txt
rm -- c.txt
test ! -e c.txt
chmod 644 a.txt
ls -l a.txt
test "$(stat -c %a a.txt)" = 644
cat a.txt
ps -ef > "$out/ps-ef.txt"
top -b -n 1 > "$out/top.txt"
cd "$base"
printf '=== 1.2 编译阶段与链接 ===\n'
gcc --version | head -n 1
gcc -E hello.c -o "$out/hello.i"
gcc -S "$out/hello.i" -o "$out/hello.s"
gcc -c "$out/hello.s" -o "$out/hello.o"
gcc "$out/hello.o" -o "$out/hello"
"$out/hello" | tee "$out/hello-output.txt"
grep -Fx 'hello, openEuler' "$out/hello-output.txt" >/dev/null
file "$out/hello.o" "$out/hello" | tee "$out/file.txt"
ldd "$out/hello" | tee "$out/ldd.txt"
printf '=== 2.1 系统调用跟踪 ===\n'
strace -o "$out/echo.strace" /bin/echo hello
strace -o "$out/hello.strace" "$out/hello"
printf '=== 2.2 异常与信号 ===\n'
gcc -o "$out/zero" zero.c
gcc -O0 -g -Wall -Wextra invalid_pointer.c -o "$out/invalid_pointer"
ulimit -c 0
python3 - "$out" <<'PY'
import hashlib,json,os,pathlib,subprocess,sys
p=pathlib.Path(sys.argv[1]);results={}
for name in ('zero','invalid_pointer'):
    for traced in (False,True):
        command=(['strace','-o',str(p/(name+'.strace'))] if traced else [])+[str(p/name)]
        r=subprocess.run(command,capture_output=True,text=True)
        item={'command':command,'returncode':r.returncode,'signal':-r.returncode if r.returncode<0 else None,'stdout':r.stdout,'stderr':r.stderr}
        results[name+('_trace' if traced else '')]=item
        print(name,'traced='+str(traced),json.dumps(item,ensure_ascii=False))
for program, expected in (('zero', 8), ('invalid_pointer', 11)):
    for key in (program, program + '_trace'):
        if results[key]['signal'] != expected:
            raise SystemExit(f"{key}: expected signal {expected}, got {results[key]['returncode']}")
annotations={'execve':'装入并执行程序映像','openat':'打开程序需要的文件或共享库','read':'从文件描述符读取数据','write':'向文件描述符写入数据','mmap':'建立虚拟内存映射'}
lines=(p/'echo.strace').read_text().splitlines();examples=[]
for call,explanation in annotations.items():
    line=next(x for x in lines if x.startswith(call+'('))
    examples.append({'call':call,'raw':line,'explanation':explanation})
    print(explanation+': '+line)
manifest={name:hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest() for name in ('hello.c','zero.c','invalid_pointer.c','run_basics.sh')}
(p/'summary.json').write_text(json.dumps({'uid':os.getuid(),'user':os.environ.get('USER'),'file_permissions':'644','compiler_stages':['hello.i','hello.s','hello.o','hello'],'exceptions':results,'syscalls':examples,'sources':manifest,'status':'passed'},ensure_ascii=False,indent=2)+'\n')
PY
echo "BASICS_RESULT=$out"
