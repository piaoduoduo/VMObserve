# 虚拟内存实验观察与诊断工具

2026 年操作系统设计赛中西部与华南区域赛功能挑战赛道，第 5 题“课程实践案例”的开发工程。当前版本 `0.1.0` 将按需分配、写时复制和透明大页实验连成“程序动作 → 原始观测 → 有条件的解释 → 对照复验”。目标提交日期为 2026-12-27；这是开发版本，不是已验收的参赛成品。

## 快速开始

依赖 Python **3.10+**、Linux GCC；本地网页不需要 npm 或第三方 Python 包。Windows 可以直接回放、导出；真实采集通过已有 WSL 和 openEuler VM 完成。

在项目根目录的 PowerShell 中：

```powershell
./work/vm.ps1 status
python work/launch.py
```

打开 <http://127.0.0.1:8765>。Windows 默认按钮执行目标为已有 openEuler VM。页面支持完整实验、THP 开/关复验、历史阶段播放、原始 JSONL/smaps 查看、HTML/JSON/CSV 下载。所有采集生成独立目录；报告下载与历史播放不运行实验。

仅命令行复测：

```powershell
./work/vm.ps1 start
./work/vm.ps1 wait
./work/vm.ps1 retest
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

## 工程结构

| 位置 | 职责 |
| --- | --- |
| `work/common/probe.h` | 目标 VMA 的 smaps 与 getrusage 采集 |
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
- “可能使用共享零页”不写成已观察物理页帧；THP 未生效的原因不能从单个零值确定。
- QEMU TCG 仅用于机制和功能验证，不能推断实机性能。
- 不修改全局 THP 配置；不在重跑时执行系统软件安装。
- SSH 私钥、虚拟磁盘和下载镜像均排除于代码范围。Git 之外的历史实验数据也必须保留。

当前尚未完成 malloc 课程桥接、可调 COW 写入比例、真实大页回退样本、教学试用与正式参赛文档/视频。详见交接文档；不声称已提升教学效果或保证获奖。
