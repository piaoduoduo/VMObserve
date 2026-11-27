# 环境诊断工具

在项目根目录运行 `python work/doctor.py`。默认检查离线回放；它不会启动网页服务或实验。Python 3.10+，只使用标准库，无须安装额外 Python 包。入口相对于脚本定位项目，也可以从其他工作目录用绝对路径运行。

## 选择检查范围

| 命令 | 检查内容 |
| --- | --- |
| `python work/doctor.py --profile replay` | 必需项目文件，以及全部内置样例的只读回放、来源完整性和案例校验 |
| `python3 work/doctor.py --profile student` | 学生 C 实战的最小条件，Linux、smaps、GCC 与基础页信息 |
| `python3 work/doctor.py --profile sequence` | Linux、smaps、GCC、strace、基础页尺寸及资源提示 |
| `python3 work/doctor.py --profile group3` | sequence 的检查，加 file、ldd、readelf 和 GCC 能否找到静态 libc |
| `python3 work/doctor.py --profile thp` | Linux、smaps、GCC、PMD THP 尺寸和大页策略 |
| `python work/doctor.py --profile vm` | 既有 VM 脚本、启动镜像存在性；Windows 额外列出已安装的 WSL 发行版，核对 Ubuntu |

Linux 本机检查可加 `--require-openeuler`，要求发行版 ID 是 openEuler，且内核名称不含 Microsoft。Windows 可回放，但直接采集会报告 `unsupported`。需要在 Linux 客体中再次执行采集检查；Windows 的 GCC 不能代替客体工具。

`group3` 对应完整第 3 组依赖，不代表单个实验都需要这些工具。`thp` 检查既有大页探针的必要条件；队友分支新增的 `demand512-thp` 使用 group3 中的需求子集，可在该分支上用 group3 检查工具和内存条件，仍须实际验证其编译与采集。

工具不会编译探针、链接测试程序、安装软件、修改 THP 或创建实验记录。默认诊断不读取 SSH 私钥；显式连接时由 SSH 客户端使用密钥认证，不输出密钥内容。磁盘、系统可用内存、当前 cgroup v2 限额和大页策略是提示信息。无法读取的值显示“未检查”，不会补零。cgroup v1、自定义挂载、祖先层级限额及未来负载尚未完整建模。

GCC 定位到 `libc.a` 只说明库文件存在，不能证明启动对象、其他静态库和链接器都可用。大页策略及 PMD 尺寸也不能证明后续实际分配到大页；仍应核对本次实验的 `AnonHugePages`。

## 显式检查已有 VM 的连接

```powershell
python work/doctor.py --profile vm --connect
python work/doctor.py --profile vm --connect --guest-lab student
```

此选项可能启动配置的 WSL 发行版，但不启动或重建 QEMU VM。Windows 启动器、本地服务和环境诊断共用 `VMOBSERVE_WSL_DISTRO`，默认 `Ubuntu`。配置不同发行版时，先用 `wsl -l -q` 核对实际名称，再设置 `$env:VMOBSERVE_WSL_DISTRO = '实际名称'`。它使用现有 `config.sh` 的端口、密钥路径和 known_hosts 配置，通过固定的回环地址连接已有客体，只读取系统信息、自身 smaps 和工具可定位性。

连接强制 `StrictHostKeyChecking=yes`、`UpdateHostKeys=no` 和非交互认证，不接受新主机密钥，也不写入 known_hosts。若尚无信任记录，应先按既有 VM 配置流程核对主机密钥。Windows 使用 `wsl --exec bash -s`，通过标准输入传送脚本；路径和远端命令使用 shell 转义，避免中间 shell 提前解释变量。

默认 `--profile vm` 仅在 Windows 上调用 `wsl --list --quiet`，不会启动发行版、连接 SSH、读取私钥内容或查询客体。由于客体条件没有验证，正常情况下结果是 `incomplete`。连接后会核对 openEuler、GCC、Python、strace、file、ldd、readelf 和 smaps。仅准备学生 C 实战时，加 `--guest-lab student`，按该实验的实际需求检查 openEuler、GCC、Python、smaps 和客体基础页尺寸。编译与测量以实跑记录为准。

每条本地命令超时 5 秒，连接命令超时 20 秒。超时会报告失败；Windows 终止 WSL 客户端不等同于证明远端进程树已清理。这里的远端命令仅进行短暂的只读检查，SSH 本身另有连接和保活时限。

## 输出与退出码

```powershell
python work/doctor.py --profile replay --json
python work/doctor.py --profile replay --output output/doctor-replay.json
```

标准输出和文件采用 UTF-8。`--output` 另存 JSON，不创建父目录、不覆盖已有文件，先准备目标目录。输出包含诊断时间、主机系统、profile、逐项状态、是否为必要条件以及处理建议，格式版本是 `vmobserve.doctor/v1`，独立于实验报告格式。

| 结果 | 退出码 | 含义 |
| --- | --- | --- |
| `ready` | 0 | 当前已检查的必要条件通过，仍可能有资源提示；不保证实验成功 |
| `blocked` | 1 | 必要条件缺失、不支持或检查失败 |
| `incomplete` | 2 | 无已知阻塞，但仍有未检查的必要条件，例如未连接客体 |

参数错误也返回 2；另存文件失败返回 1，并在标准错误中给出原因。只读回放会检查所有内置样例，任何一份损坏都会导致失败；这比网页允许继续查看其他完好案例的策略更严格，适合交付前检查。

## 开发与合并边界

本工具从 `feature/environment-doctor` 分支开发，以 main `6621f04` 为基线。入口是 `work/doctor.py`，实现集中在 `work/vmobserve/doctor/`，独立测试为 `tests/test_doctor.py`。`.gitignore` 仅增加入口脚本的精确白名单。没有修改运行器、服务端、网页、实验探针、历史记录、公共 README 或交接文件。

只调用既有 `runner.source_files()` 和 `replay.load_run()` 读取文件与记录；未修改它们的接口。诊断子包不进入旧运行器的扁平源码快照，它是宿主端的独立工具，现有实验不依赖它。验证其他分支时，将新增文件复制到隔离的完整分支快照，不用切换或覆盖工作区。

运行独立测试：

```powershell
python -B -m unittest discover -s tests -p test_doctor.py -v
```

合成测试覆盖工具缺失、超时、WSL/openEuler 区分、静态 libc、资源缺失、cgroup 提示、连接失败、严格 SSH 选项和 JSON 导出，合成条件不能当作真实 Linux 采集。真实可用环境的检查结果另存本地 `output/environment-doctor-review/`。

本轮工具及测试由 AI 辅助编写和执行，不记为队员独立实现、学生试用或新 Linux 实验。所有改动先交用户审核，用户确认前不执行 commit。建议首个提交标题：`feat(doctor): add standalone environment diagnostics`。后续交付检查和持续集成另行开发、另行审核。

## 本轮验证（2026-11-23）

| 环境或范围 | 结果 |
| --- | --- |
| 当前分支，Windows / Python 3.13.7 | 全部 88 项 Python 测试通过，含新增 24 项诊断测试 |
| cdh_version `197e7ae` 的隔离快照，复制新增工具与测试 | 全部 94 项 Python 测试通过；该分支内置样例只读诊断为 ready |
| 已安装的 WSL openEuler-24.03 / Python 3.11.6 | 新增 24 项诊断测试通过；group3 依赖诊断为 ready |
| 同一 WSL，增加 require-openeuler | 正确返回 blocked：用户态是 openEuler，但运行的是 Microsoft WSL2 内核 |
| Windows 回放及从另一工作目录启动 | 内置 6 份记录通过，只读诊断为 ready |
| Windows 直接采集检查 | 正确返回 blocked：需要目标 Linux |
| Windows 既有 VM 配置检查 | 正确返回 blocked：只安装 openEuler-24.03，没有脚本固定使用的 Ubuntu；启动镜像也未提供 |

Windows HTTP 测试需在允许本机回环网络的环境运行。以上为初轮验证，当时没有安装依赖、编译或运行 C 探针，也没有执行真实 VM SSH 连接；连接成功与失败分支使用合成测试验证。后续环境配置和真实验收单独记录。新文件及 `.gitignore` 的精确白名单与两条分支从共同基点以来的修改路径无交集；这只能说明当前可见改动的冲突风险，不能保证后续推送始终不重叠。

## 补齐本机 VM 环境

用户随后授权配置电脑并补齐真实 VM 验收。安装名为 Ubuntu 的 WSL2 发行版，保留已有 openEuler-24.03 和原默认发行版。安装入口遵循 [Microsoft WSL 命令说明](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)：

```powershell
wsl --install -d Ubuntu --no-launch --web-download --location C:\Users\Crier\AppData\Local\VMObserve\WSL\Ubuntu
```

本机安装的是 Ubuntu 26.04.1 LTS，Python 3.14.4、GCC 15.2.0、QEMU 10.2.1。在 Ubuntu 内通过发行版软件源安装 `qemu-system-x86 qemu-utils cloud-image-utils openssh-client xz-utils build-essential strace file binutils ca-certificates python3`。该安装位置是本机环境记录，不是工具源码中的固定路径。

客体镜像来自 [openEuler 官方 24.03 LTS 镜像目录](https://repo.openeuler.org/openEuler-24.03-LTS/virtual_machine_img/x86_64/)，文件为 `openEuler-24.03-LTS-x86_64.qcow2.xz`，下载完成后按同目录的官方校验文件核对 SHA256：

```text
c6af522d36d659b66da668cc4eb86b032a9cff05a95a0e37505a63e70ed585dc
```

镜像原样保存到被忽略的 `work/openeuler-vm/verified-image.qcow2.xz`。通过 `./work/vm.ps1 start` 使用现有脚本创建 backing image、独立写入层和 cloud-init seed，启动 TCG 2 核/2 GiB 客体。项目 SSH 私钥保留在 Ubuntu 的 `/root/proj5-vm/`，不复制到仓库。第一次信任客体前，须将 `ssh-keyscan` 收集的公钥指纹与客体串口日志中的指纹核对；不把 keyscan 本身视为身份验证。

独立的真实验收脚本在运行 QEMU 的 Ubuntu/Linux 内执行：

```bash
python3 tests/verify_doctor_vm.py --output output/environment-doctor-review/real-vm
```

结果目录必须尚不存在。脚本需要已有客体、项目私钥和核对过的 known_hosts；它不会启动 VM 或安装软件。依次检查默认不连接时 incomplete、使用临时空信任目录时拒绝连接、正常连接时 ready，并验证没有建立新的信任记录、原有 known_hosts 哈希不变。输出为真实 SSH 诊断记录，独立于合成单元测试和 C 探针实验。

真实 Windows→WSL 验证还发现 UTF-16LE 的 WSL 提示可能与 UTF-8 的 Linux stderr 混流。`probe.decode()` 现在逐行处理 WSL 前缀，保留可读的 SSH 错误；已补单元测试并用真实 WSL 错误输出复验。

初次真实连接还发现 `bash -c` 多行参数经过 Windows/WSL 时可能被中间 shell 提前展开，导致配置路径变成 `/config.sh`。连接脚本已改为标准输入传送，增加了 Windows 调用、特殊路径和 UTF-8 输入的回归测试。修复后从 Windows 实际得到正确的严格主机密钥拒绝提示，随后能识别真正 openEuler 客体及其缺失工具；修复前后的原始诊断分别保存在本地输出目录，不覆盖失败记录。

### 配置后的真实验收

客体通过官方 `OS` 和 `everything` 二进制源准备 GCC、glibc-devel、glibc-static、strace、file、binutils 和 Python。首次使用全部默认源时的大型元数据初始化已在 RPM 事务开始前中断，日志保留；重试只通过命令行限定软件源，没有修改全局仓库配置。

| 验收 | 结果与本地证据 |
| --- | --- |
| Windows→Ubuntu→QEMU 的 `--profile vm --connect` | ready，客体为 openEuler 24.03 LTS / `6.6.0-28.0.0.34.oe2403.x86_64`，Python 3.11.6；`output/environment-doctor-review/vm-ready.json` |
| 新客体尚未安装工具 | 正确报告 GCC、strace、readelf 缺失；`vm-before-packages.json` 保留实际失败条件 |
| 严格主机密钥拒绝 | Windows 实测拒绝未知 ED25519 密钥；`vm-untrusted-fixed.json` |
| 原生 Ubuntu 真实验收脚本 | 6 项全部通过，包括默认不连接、未知密钥拒绝、正常连接、无新信任记录、原 known_hosts 哈希不变；`real-vm/summary.json` |
| Windows 完整回归 | 91 项通过，含新增 27 项诊断测试 |
| cdh_version 隔离快照 | 97 项完整回归通过；未修改实际队友分支 |
| 新 Ubuntu / Python 3.14.4 | 新增 27 项测试通过 |
| 原项目 Windows 入口 | `./work/vm.ps1 status` 正常；`retest --suite group3 --repeats 1 --timeout 120` 完成真实编译、采集和结果取回 |

新增真实运行 `20261123T150400.268372Z` 保存于本机 `work/openeuler-vm/guest-runs/`。动态链接、静态链接、连续 malloc、512 MiB 按需调页、三种栈条件和地址布局共 8 个案例全部通过。只读回放完整性为 verified，报告 SHA256 为 `d1a838e26df9096580954463b178e5337dd5c5347ce4895fb336344f72ca6731`；审计在 `output/environment-doctor-review/real-run-audit.json`。这些是新客体上的真实实验，不是合成测试或学习者试用。

上述本机原始日志、运行记录、镜像、写入层和密钥按现有忽略规则保存，不随本次代码提交；没有覆盖内置课例或旧运行记录。Ubuntu 作为新增发行版保留，默认仍为 openEuler-24.03。QEMU 当前保持运行，资源配置为 2 核/2 GiB，SSH 仅监听宿主回环地址 2226。本轮代码在 `feature/environment-doctor` 独立开发，经用户审核授权后提交；后续每次 commit 仍需用户审核。
