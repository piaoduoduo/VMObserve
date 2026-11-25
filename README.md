# VMObserve · 重点任务可视化实验台

**三次 malloc 申请了三个块，为什么只看到两段映射？** VMObserve 把程序动作、Linux 的原始记录和课内知识放在一起。它是华中科技大学操作系统实验的教学工具，也是 2026 年操作系统设计赛中西部与华南区域赛功能挑战第 5 题「课程实践案例」的参赛项目。

## 打开第一课

在项目根目录运行以下命令，然后打开 <http://127.0.0.1:8765>。Python 3.10 及以上即可回放。

```sh
python work/launch.py
```

[重点任务目录](docs/重点任务/README.md)单列两项内存实验。[3.2 连续三次 malloc](http://127.0.0.1:8765/labs/3.2) 从申请前开始回放，点击一步就能查看对应的映射和系统调用。[3.3 按需调页与栈增长](http://127.0.0.1:8765/labs/3.3) 对照 512 MiB 分批写入时的驻留量与次缺页，再看原课例的五次 ps 输出和栈上限对照，记下自己设计的访问实验。其他课内任务收在「完整课程目录」里，写时复制和透明大页收在「拓展实验」里。

第 1、2 组可以看 openEuler 历史实测摘录，第 3、4 组可以点进具体案例。第 5–7 组新增九项可复验的机制观察。例如[实验 7.2](http://127.0.0.1:8765/labs/7.2)展示 FIFO 在不同读写端状态下的返回值。7.4 内核模块和 7.5 eBPF 提供课程任务，等待补采记录。

点「复制回放链接」，可以让队友直接打开你选的记录、案例和步骤。两边需使用相同工作台地址并有这份记录；用内置课例演示最方便。「原始记录」支持按实验名、编号、参数和状态筛选。

每个实验回放页底部都可以记录本步的预测、观测与解释。草稿按记录、案例和步骤保存在当前浏览器；保存后的独立笔记附带采样、原始文件路径和报告哈希，支持历史搜索、恢复草稿和 JSON 导入导出。个人笔记保持未评分。

| 学生想弄清楚什么 | 去哪里看 |
| --- | --- |
| 地址分别属于哪一段？申请内存后何时真正占用物理页？ | 程序地址、按需分配；[动手任务](http://127.0.0.1:8765/lesson) |
| fork 后哪些内存仍然共享？稀疏写时大页有什么影响？ | 写时复制、透明大页；可在配置好的 Linux 环境运行对照 |
| 怎样回到原始证据或交一份报告？ | 原始记录，或右上角「导出报告」：HTML 阅读、CSV 比较、JSON 留档 |

连续 malloc、按需调页、栈增长和 COW 的具体采样步骤支持跨轮次并排对照，会列出参数、环境差异与实际读数。详见[回放对照与学习笔记](docs/LEARNING_WORKFLOW.md)。

参赛主线从首页的地址归属练习进入。完成 3.2 后，在 3.3 记录预测、核对两组原文，再导出可合并两项实验的 HTML 报告。openEuler 与 WSL2 各三轮对照已随仓库提供，可从 3.3 直接切换到另一环境的同轮、同策略和同阶段。见[参赛基线](docs/FOCUS_BASELINE.md)、[技术说明](docs/FOCUS_TECHNICAL_REPORT.md)与[课堂试用任务单](docs/FOCUS_TRIAL.md)。

## 评委复验内置记录

在干净检出的项目目录运行：

```sh
python -B work/verify_submission.py
```

这条命令只读核对随仓库交付的五份历史实测记录，包括进程级禁用下建议成功、写入后无匿名大页的反例。它用临时本地端口复核报告和证据哈希，从原始 `smaps` 重算 3.2 的去重 RSS，并核对 3.3 两环境的建议对照、WSL2 的进程级对照及其 CSV、JSONL 和 `smaps`。通过后输出 JSON，失败时给出失败位置并返回非零退出码。只需要 Python 3.10 及以上，无需安装编译器或启动 Linux 虚拟机。复验现有样例与重新采集的区别见[参赛基线](docs/FOCUS_BASELINE.md)。

## 运行自己的实验

Linux 采集需要 GCC；连续分配实验还需要 strace。在项目根目录运行：

```sh
python3 work/run_all.py --suite sequence
```

原开发机上已有 openEuler 虚拟机，可用 `./work/vm.ps1 retest --suite sequence`。每轮实验独立保存环境、源码和原始记录。QEMU 用于观察内存机制。更多实验参数、环境配置与离线导出见[运行说明](work/RUNNER.md)。

## 代码从哪里看

- **采集**：[`work/proj5-course/`](work/proj5-course/)、[基础内存实验](work/proj5-memory-pilot/)、[大页对照](work/proj5-round2/)。
- **解释**：[运行器](work/vmobserve/runner.py)安排实验；[连续分配解析](work/vmobserve/sequence.py)把返回地址与映射对应起来；[诊断规则](work/vmobserve/diagnosis.py)区分已观察到的现象、可能原因和缺少的证据。
- **呈现**：[本地服务](work/vmobserve/server.py)、[网页](work/vmobserve/web/)、[报告导出](work/vmobserve/export.py)。[内置课例](examples/)可独立回放。
- **教学与协作**：[课程对应](docs/COURSE.md) · [首次试用单](docs/V071_CLASSROOM.md) · [队友说明](docs/TEAM_README.md) · [开发交接](docs/HANDOFF.md)。

[对照当期指导书、课程目标和报告要求](docs/COURSE_ALIGNMENT.md) · [回放原版 512 MiB 的五个暂停点](http://127.0.0.1:8765/lesson#original-demand)。

当前本地版本 **0.8.3**。[公开仓库](https://github.com/piaoduoduo/VMObserve) · [参赛承诺和开源待办](docs/COMPETITION_COMMITMENTS.md) · [往届作品对照](docs/NATIONAL_REFERENCE_STUDY_20261116.md)。
