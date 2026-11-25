# VMObserve · 重点任务可视化实验台

**三次 malloc 申请了三个块，为什么只看到两段映射？** VMObserve 把程序动作、Linux 的原始记录和课内知识放在一起。它是华中科技大学操作系统实验的教学工具，也是 2026 年操作系统设计赛中西部与华南区域赛功能挑战第 5 题「课程实践案例」的参赛项目。

## 打开第一课

在项目根目录运行以下命令，然后打开 <http://127.0.0.1:8765>。Python 3.10 及以上即可回放。

```sh
python work/launch.py
```

首页的「开始 3.2」会带你进入第一步。页顶的圆圈按程序执行顺序排列，点哪一步，就看哪一步的程序动作、Linux 处理和实测结果。[网页重点任务目录](http://127.0.0.1:8765/labs/focus) · [重点任务说明](docs/重点任务/README.md)

| 想弄清楚什么 | 从哪里开始 |
| --- | --- |
| 三次 malloc 为什么只看到两段映射？ | [3.2 的 6 步回放](http://127.0.0.1:8765/labs/3.2?replay=sequence)。点第 4 步，看两次 mmap 的地址怎样相接，再打开 smaps 核对驻留量。 |
| 申请 512 MiB 后，哪一步才用上物理内存？ | [3.3 的 6 步回放](http://127.0.0.1:8765/labs/3.3?replay=demand512)与[512 MiB 透明大页实测对照](http://127.0.0.1:8765/labs/3.3?replay=demand512-thp)（支持在匹配的 openEuler 与 WSL2 记录间切换并导出配对 CSV）。接着看[栈增长与溢出](http://127.0.0.1:8765/labs/3.3?replay=stack)，或在[实验笔记](http://127.0.0.1:8765/lesson)里写下自己的预测和解释。 |
| fork 后哪些页仍然共享？只写几个字节为什么会占几十 MiB？ | [拓展实验](http://127.0.0.1:8765/labs/extensions)里有写时复制（8 步）和透明大页（4 步）。 |
| 想记录每步预测与解释，或把两轮实验并排对照？ | 每个回放页底部提供「把本步与另一轮实验并排对照」和「记录本步的预测、观测与解释」，支持搜索、JSON 导出导入与 HTML 报告导出。[学习流程与对照说明](docs/LEARNING_WORKFLOW.md) |
| 想让同学看到同一条记录，或把证据放进报告？ | 点「复制当前步骤链接」，接收方需能访问同一服务和记录。「原始证据」能按编号、参数或状态搜索。「导出实验报告」提供 HTML、CSV、JSON，手机上先展开「实验台目录」。 |

完整课程目录也收入了第 1、2 组 openEuler 实测摘录以及进程、同步和 I/O 案例。[7.2 FIFO](http://127.0.0.1:8765/labs/7.2) 可以复验。7.4 内核模块和 7.5 eBPF 目前只提供课程任务索引。

## 运行自己的实验

Linux 采集需要 GCC；连续分配实验还需要 strace。在项目根目录运行：

```sh
python work/doctor.py
python3 work/run_all.py --suite sequence
```

`python work/doctor.py` 可进行只读环境自检（内置样例回放、Linux 依赖、已有虚拟机与 SSH 核查），详见[环境自检说明](docs/ENVIRONMENT_DOCTOR.md)。原开发机上已有 openEuler 虚拟机，可用 `./work/vm.ps1 retest --suite sequence` 或 `./work/vm.ps1 retest --suite demand512-thp --repeats 3 --timeout 120`。每轮实验独立保存环境、源码和原始记录。QEMU 用于观察内存机制。更多实验参数、环境配置与离线导出见[运行说明](work/RUNNER.md)。

## 代码从哪里看

- **采集**：[`work/proj5-course/`](work/proj5-course/)、[基础内存实验](work/proj5-memory-pilot/)、[大页对照](work/proj5-round2/)。
- **解释**：[运行器](work/vmobserve/runner.py)安排实验；[连续分配解析](work/vmobserve/sequence.py)把返回地址与映射对应起来；[诊断规则](work/vmobserve/diagnosis.py)区分已观察到的现象、可能原因和缺少的证据。
- **呈现**：[本地服务](work/vmobserve/server.py)、[网页](work/vmobserve/web/)、[报告导出](work/vmobserve/export.py)。[内置课例](examples/)可独立回放。
- **教学与协作**：[课程对应](docs/COURSE.md) · [学习流程与对照](docs/LEARNING_WORKFLOW.md) · [3.2/3.3 参赛基线](docs/FOCUS_BASELINE.md) · [首次试用单](docs/V071_CLASSROOM.md) · [协作分工](docs/COLLABORATION.md) · [开发交接](docs/HANDOFF.md)。

[对照当期指导书、课程目标和报告要求](docs/COURSE_ALIGNMENT.md) · [回放原版 512 MiB 的五个暂停点](http://127.0.0.1:8765/lesson#original-demand)。

当前本地版本 **0.8.3**。[公开仓库](https://github.com/piaoduoduo/VMObserve) · [参赛承诺和开源待办](docs/COMPETITION_COMMITMENTS.md) · [往届作品对照](docs/NATIONAL_REFERENCE_STUDY_20261116.md)。

## 参赛材料

演示视频（百度网盘）：待录制，发布后在这里填写分享链接。当前可用的设计、测试和同类作品对照见[交付材料清单](docs/GEMINI_REVIEW_20261119.md)。

队伍原创的作品文档采用[知识共享署名－相同方式共享 4.0 国际许可协议](https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans)。引用的课程材料、赛会文件及第三方作品按各自来源和授权使用。[来源清单](docs/SOURCES.md)
