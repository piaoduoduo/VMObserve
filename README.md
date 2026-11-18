# 虚拟内存实验观察与诊断工具

## 0.7.1 · cdh_version 工作台

- Windows 双击 `启动交互网页.cmd`，打开 <http://127.0.0.1:8766>。首次打开可以直接回放内置样例。
- Linux / WSL 运行 `python3 -B work/launch.py --executor local --port 8766`。新的「运行课内全套」使用第 3 组原课例、地址映射和 12 项按需分配入门，共 36 项。命令行也可运行 `python3 -B work/run_all.py --suite course-all`。
- 第 3 组需要 GCC、静态 libc、binutils、file、ldd 和 strace。strace 不在 PATH 时，可通过启动或运行命令的 `--strace` 指定路径。
- 「复制回放链接」可保存当前运行记录、主题、案例和步骤。同一个工作台地址能打开对应记录时，刷新或访问该链接会恢复回放位置。「证据与环境」可按案例编号、实验或参数查找，并筛选状态。
- 「连续分配」支持时间线和原始调用行号。「静态与动态链接」「栈增长对照」按运行轮次比较原始课例记录。第 4 组保持独立运行和回放入口。

2026-11-16 第1、2组补齐：六项基础实验已在openEuler实跑，Git两类补丁在干净副本还原一致，原Dockerfile构建/运行及宿主进程观察通过；能力赛16/64 MiB COW案例在容器内2/2通过。先看[11月18日速查](docs/ACCEPTANCE_20261118.md)和[本轮完成记录](docs/GROUP12_COMPLETION_20261116.md)，命令入口 `work/course-labs/group12/demo.ps1`。

公开仓库：[piaoduoduo/VMObserve](https://github.com/piaoduoduo/VMObserve)。包含 C 实验程序、Python 运行器、本地交互网页、课程任务单和测试。报名资料、个人证件、联系方式、私钥及虚拟机镜像不在仓库中。

**队友入口：[选题、进度、网页预览与协作更新 README](docs/TEAM_README.md)。** 新电脑可以先回放内置真实样例，再按需要配置 Linux 执行新实验；暂不安排分工。

首次获取：`git clone https://github.com/piaoduoduo/VMObserve.git`，然后进入 `VMObserve` 目录。使用已有 Python 3.10+ 执行 `python work/launch.py`，打开下方快速开始中的本机地址。网页在自己的电脑运行；新电脑上的真实实验需 Linux 环境，已有 openEuler 虚拟机入口是原开发机的环境配置。离线查看内置真实历史样例可运行 `python -m vmobserve replay ../tests/fixtures/legacy-run`（先进入 `work` 目录）。

完整本机历史和验证附件保留在开发机；文档中的 `output/`、`outputs/`、`work/runs/`、`guest-runs/` 路径是本地证据索引。内置回归夹具在 `tests/fixtures/`；尚未完成代码及文档许可证定稿，见 [参赛准则](docs/COMPETITION_COMMITMENTS.md)。

主分支此前的 `0.7.0`：第4组4.1—4.4的五份骨架和缺失child_prog已补齐，支持按验收范围运行、进程/线程事件回放、原文与三格式导出。WSL和openEuler各42/42案例通过，合并后60项自动检查通过；保留v0.6.1连续malloc专项。[第4组完成记录](docs/GROUP4_COMPLETION_20261116.md)；[11月18日验收速查](docs/ACCEPTANCE_20261118.md)。本轮服务入口 <http://127.0.0.1:8766>。

此前 `0.6.1`：连续三次 malloc 已有独立页面和运行入口，展示系统调用原文行号、返回地址与去重后的相关映射。WSL / openEuler 新增各 3/3 真实案例通过，52 项自动检查通过。[本轮结果与复现](docs/V06_SEQUENCE_20261116.md)；[课程任务单](work/lessons/sequence/WORKSHEET.md)。

2026-11-16：第3组在WSL与openEuler各24/24案例通过，45项回归检查通过。页面入口为“第3组完整实验”；[完成记录与复现说明](docs/GROUP3_COMPLETION_20261116.md)。

2026 年操作系统设计赛中西部与华南区域赛功能挑战赛道，第 5 题“课程实践案例”的开发工程。当前版本 `0.7.0` 覆盖课内第4组进程、线程、管道与同步，以及第3组：静态/动态链接、同进程连续 malloc、512 MiB按需调页及栈增长/溢出；保留地址映射、malloc六步入门、学生动手任务、写时复制及透明大页对照。目标提交日期为 2026-12-27；当前为开发原型。

开发、开源及报告编写遵循 [参赛承诺与项目执行准则](docs/COMPETITION_COMMITMENTS.md)，其中明确区分承诺书条款、章程 AI 要求和当前尚待落实事项。

最新研究：[全国优秀作品、当前差距与下一轮验收](docs/NATIONAL_REFERENCE_STUDY_20261116.md)。课内连续malloc与真实调用证据已在v0.6完成；后续按该研究推进真实学习者试用与正式材料。

## 快速开始

依赖 Python **3.10+**、Linux GCC；本地网页不需要 npm 或第三方 Python 包。Windows 可以直接回放、导出；真实采集通过已有 WSL 和 openEuler VM 完成。

在项目根目录的 PowerShell 中：

```powershell
./work/vm.ps1 status
python work/launch.py
```

打开 <http://127.0.0.1:8765>，默认进入“程序地址与映射”：先预测函数、常量、全局变量、堆和栈需要什么权限，再展开真实对应关系。点击“运行地址空间实验”生成三个新进程的记录，Windows 默认执行目标为已有 openEuler VM。随后切到“课程实验入门”，选择 16 MiB，用“下一步”观察申请、写入与释放；[动手任务](http://127.0.0.1:8765/lesson)提供待补的访问循环和单独的参考版。详细课程对应见 [课程阅读指南](docs/COURSE.md)。页面支持 COW 比例对照、THP 复验、原始 JSONL/smaps 查看和 HTML/JSON/CSV 下载。所有采集生成独立目录；报告下载与历史播放不运行实验。

仅命令行复测：

```powershell
./work/vm.ps1 start
./work/vm.ps1 wait
./work/vm.ps1 retest
./work/vm.ps1 retest --suite layout
./work/vm.ps1 retest --suite sequence
./work/vm.ps1 retest --suite group4 --group4-task 4.1 --timeout 120
./work/vm.ps1 retest --suite course
./work/vm.ps1 retest --cow-fraction all
```

在 Linux 中：

```sh
python3 work/run_all.py
python3 work/run_all.py --require-openeuler
cd work
python3 -m vmobserve replay openeuler-vm/guest-runs/20261110T091621.439041Z
python3 -m vmobserve export openeuler-vm/guest-runs/20261110T091621.439041Z --output ../output/my-export
```

导出目标必须是尚不存在的新目录，避免覆盖。完整命令与状态见 [运行说明](work/RUNNER.md)。最新验证和交接见 [HANDOFF](docs/HANDOFF.md) 与 [验证记录](docs/VERIFICATION.md)。

默认完整实验为 3 项地址映射、12 项 malloc 课程、6 项基础和 12 项 THP 对照，共 33 项。`--cow-fraction all` 将基础案例扩展到五种写入比例，完整轮次共 57 项。地址按钮只运行 3 项，课程按钮只运行 12 项。v0.5 已在 WSL 和 openEuler 各完成 33 项完整验证，页面另完成 3 项地址实验；42 项自动测试通过。旧版 30/54 项记录保持原样，验证索引见 [VERIFICATION](docs/VERIFICATION.md)。

## 工程结构

| 位置 | 职责 |
| --- | --- |
| `work/course-labs/group4/`、`work/vmobserve/group4.py` | 第4组独立完成版、演示脚本、进程线程事件校验 |
| `work/common/probe.h` | 目标 VMA 的 smaps 与 getrusage 采集 |
| `work/proj5-course/layout_probe.c`、`work/vmobserve/layout.py` | 七类程序地址、实际映射与已加载 ELF 段关联 |
| `work/vmobserve/smaps.py` | 地址实验与 malloc 实验共用的完整映射解析 |
| `work/proj5-course/allocator_probe.c`、`work/vmobserve/allocator.py` | malloc 六步采样、相关映射解析与有边界的解释 |
| `work/proj5-memory-pilot/memory_probe.c` | 按需分配与 fork/COW 动作 |
| `work/proj5-round2/thp_probe.c` | THP 建议与写入步长受控对照 |
| `work/vmobserve/runner.py` | 唯一运行器、源码快照、编译、检查点和失败报告 |
| `work/vmobserve/evidence.py` | JSONL 结构、原始 smaps 一致性、预期关系校验 |
| `work/vmobserve/diagnosis.py` | 确认/可能/证据不足规则及配对对照 |
| `work/vmobserve/replay.py` | 新旧记录只读回放与来源校验 |
| `work/vmobserve/server.py`、`web/` | 本地工作台与一次一个的真实实验任务 |
| `work/openeuler-vm/` | 现有虚拟机和传输入口；不移动镜像 |
| `tests/` | 真实历史夹具、合成负路径测试、真实失败注入 |

## 证据边界

- `real_execution` 描述采集来源；`historical_replay` 描述当前查看方式。合成测试只在测试中构造，不进入普通实验历史。
- `completed` 只说明本轮计划完成且检查通过，不表示大页请求必须实际生效，更不表示竞赛已经验收。
- 目标区域 RSS/PSS 不等于整个进程开销；缺页计数是进程级的，不是逐页跟踪。
- malloc 课程实验统计与申请范围相交的整个映射，可能包含其他对象；不能当作单个 malloc 块的精确物理占用。记录映射位置不等于追踪了 brk/mmap 系统调用。
- “可能使用共享零页”不写成已观察物理页帧；THP 未生效的原因不能从单个零值确定。
- QEMU TCG 仅用于机制和功能验证，不能推断实机性能。
- 不修改全局 THP 配置；不在重跑时执行系统软件安装。
- SSH 私钥、虚拟磁盘和下载镜像均排除于代码范围。Git 之外的历史实验数据也必须保留。

已对齐原实验文档第 10–12 页与理论第七章重点页。v0.5 覆盖运行时地址与装载段关联；完整静态/动态链接对比、同进程连续三块 malloc、栈增长任务、真实教学试用与正式报告/视频仍待完成。按用户节奏边复习边开发，12 月 15 日前冻结主要功能，最后 10 天基本不改项目。团队现为三人，参赛信息与首次协作建议见 [队友说明](docs/TEAM_BRIEF.md)。
