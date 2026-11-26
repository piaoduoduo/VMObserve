# 统一运行入口

本说明替代最初的预实验运行步骤。原始 results 和 guest-runs 全部保留；不要移动项目或虚拟磁盘。脚本路径已改为相对自身定位，但 qcow2 写入层仍可能记录绝对 backing 路径。

## Windows

要复验同步、文件与设备九项观察，在已有 openEuler 环境运行 `./work/vm.ps1 retest --suite systems --repeats 1`。只做一项可加 `--lab 7.2`。在 Linux 本机运行 `python3 work/run_all.py --suite systems --lab 7.2 --repeats 1`。这组参数沿用相同的源码快照、原始输出、回放与报告格式。

在项目根目录：

```powershell
./work/vm.ps1 status
./work/vm.ps1 start
./work/vm.ps1 wait
./work/vm.ps1 retest
./work/vm.ps1 retest --suite layout
./work/vm.ps1 retest --suite sequence
./work/vm.ps1 retest --suite group3 --timeout 120
./work/vm.ps1 retest --suite course
python work/launch.py
```

浏览器打开 http://127.0.0.1:8765 。Windows 上，新检出的仓库默认回放。若项目中已有 `work/openeuler-vm/experiment.qcow2`，默认采集目标就是这台虚拟机，采集前用上述命令启动它。连接自行配置的同一转发端口时也可显式指定 `--executor openeuler-vm`。关闭服务用 Ctrl+C，先等运行任务结束。若端口已占用，用 `python work/launch.py --port 8766`。

PowerShell 入口用 wslpath 转换实际项目路径，不再要求手写 /mnt/d/...；默认发行版 Ubuntu。VM 配置集中在 `openeuler-vm/config.sh`，端口 2226，密钥默认 `/root/proj5-vm/id_ed25519`。可覆盖 PROJ5_VM_PORT、PROJ5_VM_STATE_DIR、PROJ5_VM_KEY；现有 VM 已运行时不改变其参数。

## Linux

```sh
python3 work/run_all.py
python3 work/run_all.py --require-openeuler
python3 work/run_all.py --suite layout
python3 work/run_all.py --suite sequence
python3 work/run_all.py --suite course
python3 work/run_all.py --cow-fraction all
python3 work/run_all.py --suite baseline --cow-fraction 1/8
python3 work/run_all.py --suite thp --pattern sparse --thp both --repeats 3
python3 work/run_all.py --recheck-from work/runs/某次运行ID
python3 work/launch.py --executor local
```

地址实验默认三个独立进程，各保存七类地址、完整 smaps 和加载后的 ELF 段。malloc 课程实验为 1/256/1024/16384 KiB 独立申请，各 3 次；基础实验默认 16/64 MiB 各 3 次、子进程写 1/4；THP 四条件各 3 次。参数：suite=all/layout/course/baseline/thp/group3/sequence，pattern=all/sparse/full，thp=both/on/off，repeats=1..5，timeout=(0,120] 秒。`--cow-fraction` 可选 `0`、`1/8`、`1/4`、`1/2`、`1`、`all`。默认每次程序 20 秒、编译 30 秒。THP 开关顺序交替。

`sequence` 在同一进程连续申请 1/256/1024 KiB，默认独立重复三次；需要 strace，保存版本及原始调用。页面入口“连续 malloc 与调用”。缺少跟踪器时案例 unsupported、检查证据不足，整轮失败；不退化为猜测调用。`group3` 含连续分配、链接、512 MiB 按需调页、栈及地址课例，默认 24 案例，另需 file/ldd/readelf 和静态 libc 开发文件。不同 WSL 发行版的工具可能不同。运行 `python3 -B work/run_all.py --suite sequence --check-tools` 可检查当前会话，退出码 0 表示已找到本项工具且采集环境初检通过，2 表示环境或工具不齐。检查不执行编译，也不验证静态链接库、跟踪权限或运行时压力。普通运行不安装依赖。两者均不改变默认 all 的 33 案例计划。

`--cow-fraction all` 遍历五种比例，默认重复次数下为 30 项基础案例；suite=all 时另执行 3 项地址、12 项课程和 12 项 THP，共 57 项。没有指定该参数时共 33 项。Windows 传输入口同样接受该参数，如 `./work/vm.ps1 retest --cow-fraction all`。旧版 18/30/42/54 项历史记录保持原样。

页面默认“程序地址与映射”，点击“运行地址空间实验”新建 3 项真实案例；任务单为 `work/lessons/layout/WORKSHEET.md`。切换到“课程实验入门”，点击“运行课程实验”新建 12 项真实案例。六步为申请前、申请后、写到 1/4、写到 1/2、写完、释放后。上一步/下一步只回放记录；展开原理和全部阶段不会执行程序。课程探针保留系统默认 THP，统计范围是与申请区间相交的整个 VMA；详见 ../docs/COURSE.md。

页面切换到“按需分配 / 写时复制”，选择“下一次真实运行：子进程写入比例”，点击“运行 COW 对照”。单比例运行 6 项，全部比例运行 30 项。选择控件只影响下一次真实执行，当前历史表不会因此改变。零写入是保留共享的对照，不应解释为已发生复制。

旧 `run_pilot.py` 与 `run_thp.py` 自动转入统一运行器，并生成独立 `work/runs/<ID>`，不再覆盖旧 results。

## 回放与导出

```sh
cd work
python3 -m vmobserve replay openeuler-vm/guest-runs/20261110T091621.439041Z
python3 -m vmobserve export openeuler-vm/guest-runs/20261110T091621.439041Z --output ../output/example-export
```

输出为 HTML、JSON、CSV。无需 Linux 或 GCC即可回放。旧格式只进行部分来源校验；新格式重新核对源码和原始数据 SHA256，重新计算诊断，不执行保存的源码。

## 每轮证据

`report.json` 保存 schema、环境、计划、状态、校验、诊断和来源；`environment.json` 是独立环境记录；`source/` 为源码快照；`build/` 为编译版本和日志；`cases/<ID>/` 为原始 stdout.jsonl 与 smaps.stderr.txt。失败也有报告（进程强杀或存储故障可能只剩最后检查点）。

VM 传输日志在 `openeuler-vm/transfers/<宿主ID>`，只打包白名单源码，每次上传到新的客体目录。普通重跑不安装依赖。runner 非零退出后仍取回本轮 runs，禁止覆盖已有 guest-runs。传输脚本拥有输出目录，不接受 --output；用 --suite/--repeats 等选择实验。

退出码 0=完成，1=失败，2=不支持/参数错误，3=完成但偏离预期，130=中断。completed 不保证大页实际生效；以 AnonHugePages 与对照为准。

## 目标系统与限制

现有环境为 openEuler 24.03 LTS、内核 6.6.0-28.0.0.34.oe2403.x86_64，QEMU TCG 2 核/2 GiB；SSH 仅 WSL 127.0.0.1:2226。`--require-openeuler` 同时拒绝非 openEuler 用户态和 Microsoft/WSL 内核。默认不改全局 THP。

2026-11-10 曾观察到客体时钟与宿主约 51 分钟偏差，这不是固定偏移量。2026-11-11 复用磁盘启动了已停止的 VM，未手动校时；当前时差需按当次 preflight/传输日志核查。源码包的 mtime 归一化为 0，内容 SHA256 不变。运行身份依靠唯一 ID 与哈希，不能跨机器直接按 ID 推断先后。

历史初始复测在 guest-runs/20261110T091621.439041Z。当前验证入口与新增证据见 ../docs/VERIFICATION.md；后续接手先看 ../docs/HANDOFF.md。

## v0.4 学生任务与进程策略反例

```powershell
# 起始 student.h 故意未完成，此命令预期返回 1 并保留检查失败的记录
./work/vm.ps1 retest --suite course --course-code student
# 参考实现，不会覆盖学生文件
./work/vm.ps1 retest --suite course --course-code reference
# 两组均请求 THP，仅改变进程策略；稀疏/逐页 × 两策略 × 三次 = 12 项
./work/vm.ps1 retest --suite thp --thp on --thp-process pair
# 关联已经存在的真实记录，执行新的进程策略对照（路径换成待复验目录）
./work/vm.ps1 retest --recheck-from work/openeuler-vm/guest-runs/20261111T124402.584266Z --recheck-kind process --pattern sparse
```

Linux 使用相同参数传给 `python3 work/run_all.py`。`--thp-process` 支持 inherit（默认）、allow、disable、pair；pair 交替两种执行顺序，allow 解除当前进程禁用而不保证分配大页。进程退出后不影响其他进程，不修改 sysfs。课程任务说明见 `work/lessons/demand/WORKSHEET.md`。

网页 `/lesson` 提供草稿、证据选择与学习记录 JSON；个人解释不自动评分。主页面 THP 页提供新对照及关联复验。课例 v2 采集完整可退出 0，但累计位置/页首值检查不通过时统一运行器返回 1，整轮 `failed`。这与采集不完整、编译失败不同。原始 v1 课例兼容读取，不重写。

VM 在传输目录完成副本后再一次性移入公开历史目录，避免页面将复制中的不完整目录误判为证据损坏。失败执行仍取回；不覆盖历史。


### 环境自检（Doctor）

运行只读环境自检以核查内置样例回放、Linux 编译/观测工具链以及已有 openEuler 虚拟机配置：

```sh
python work/doctor.py
python work/doctor.py --json
```

详细选项（如 `--profile`、`--check-vm`）见 `../docs/ENVIRONMENT_DOCTOR.md`。

### 3.3 的 512 MiB 透明大页对照

在 Linux 运行 `python3 work/run_all.py --suite demand512-thp --repeats 3 --timeout 120`。
已有 openEuler 虚拟机可运行 `./work/vm.ps1 retest --suite demand512-thp --repeats 3 --timeout 120`。
每组独立启动进程，顺序按轮次交替，每次最多写入 512 MiB。对照保留原课例 A/B/C 的访问次序与 4096 字节步长，用两侧带保护页的私有匿名映射建立精确的 512 MiB 统计范围。建议作用于整个区间，使用 `MADV_NOHUGEPAGE` 与 `MADV_HUGEPAGE` 配对，写入前保存返回值和地址，再按阶段复核 `VmFlags`、RSS 和 `AnonHugePages`。

网页在实验 3.3 中分别提供原版 malloc 回放和透明大页对照。对照记录可按阶段打开两组的策略 JSONL 与 smaps。策略请求成功后，实际大页驻留仍以采样为准。次缺页增量来自进程级 `getrusage`。真实采集记录默认保存于工具目录的 `runs/` 或虚拟机回传目录。Windows Python 本地服务可以回放已采集记录。
