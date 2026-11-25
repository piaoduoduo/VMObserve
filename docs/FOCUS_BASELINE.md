# 3.2 与 3.3 的参赛基线

两项原课例使用同一份 openEuler 记录 `examples/20261118T013159.221864Z`，报告 SHA-256 为 `7471631ce89130bfcf0caef4bacb0ef6de291ce11405d17279d76ac922c880a8`。复现入口为 `python3 work/run_all.py --suite group3 --repeats 1 --timeout 120`，重新执行会生成新的地址和记录编号。指导书对应关系见 [课程依据](COURSE_ALIGNMENT.md)。

| 指导书任务 | 案例 | 关键观测 |
| --- | --- | --- |
| 3.2，PDF 第 10–11 页 | `sequence-1` | 第三次申请后，1281 KiB 申请量对应 1428 KiB 相关映射，其中 RSS 为 4 + 12 = 16 KiB。 |
| 3.3，PDF 第 11–12 页 | `demand512-1` | 申请后目标映射 RSS 为 8 KiB。写入四分之一时，累计写入 32768 个位置，记录 266 次次缺页及 128 MiB 匿名大页。 |

2026-11-20 新增的 512 MiB 受控采集在 Ubuntu 24.04.5 LTS 的 WSL2 执行。[内置记录](../examples/20261120T113225.827429Z/report.json)为 `20261120T113225.827429Z`，报告 SHA-256 为 `9d7aa036cd908c7bbd110dc8f4755a594486e0a07d4073a2be3d43bcd5f9110e`，详见 [采集说明](../work/RUNNER.md#33-的-512-mib-透明大页对照)。三轮均在写到四分之一时记录到同样结果，两组映射 RSS 同为 128 MiB。禁用组记录 32768 次次缺页和 0 KiB 匿名大页，请求组记录 64 次次缺页和 128 MiB 匿名大页。

## 进程级禁用反例

同一台 WSL2 机器、同一份探针和同一全局设置 `always [madvise] never` 下，分别记录解除进程禁用和进程级完全禁用，各三轮。探针用 `PR_GET_THP_DISABLE` 读回设置，512 MiB 映射、写入步长和 `MADV_HUGEPAGE` 调用保持一致。两份记录的探针 C 文件与采样头文件哈希相同。设置仅作用于探针进程。 [Linux 内核 THP 文档](https://docs.kernel.org/admin-guide/mm/transhuge.html#process-thp-controls)

| 写到四分之一，均为 MADV_HUGEPAGE 组 | 进程禁用读回 | 建议返回 | 映射 RSS | 匿名大页 | 本步进程次缺页 |
| --- | ---: | ---: | ---: | ---: | ---: |
| [解除进程禁用](../examples/20261125T110630.221939Z/report.json) | 0 | 0 | 128 MiB | 128 MiB | 64 |
| [进程级完全禁用](../examples/20261125T110657.478995Z/report.json) | 1 | 0 | 128 MiB | 0 KiB | 32768 |

两份记录的 Linux 内核均为 `6.6.87.2-microsoft-standard-WSL2`，所列结果在各自三轮中一致。打开任一进程条件的回放后，展开「同阶段比较进程级开关」。页面对齐同一轮次、阶段和 `MADV_HUGEPAGE` 建议，核对环境、探针哈希与实验条件，然后并排显示结果。每列链接可打开该阶段对应案例，到原文区核对 `condition`、策略返回以及 `smaps`。「下载本步对照证据 JSON」会重新核对两份报告，保存页面读数、实验条件、案例与阶段、探针源码哈希，以及 JSONL 和 `smaps` 的路径与哈希。在 Linux 重新采集时，可分别运行 `python3 work/run_all.py --suite demand512-thp --thp-process allow` 与 `python3 work/run_all.py --suite demand512-thp --thp-process disable`。用 `python -B work/verify_submission.py` 复验内置记录。离线核对已下载的单份文件时，添加 `--process-evidence demand-process-evidence.json`。若原始运行不在工作台默认目录，再用 `--records` 指向原始运行目录的上一级。

## openEuler 双环境复验

在官方 openEuler 24.03 LTS x86_64 镜像上启动 QEMU TCG 客体，内核为 `6.6.0-28.0.0.34.oe2403.x86_64`。镜像 SHA-256 为 `c6af522d36d659b66da668cc4eb86b032a9cff05a95a0e37505a63e70ed585dc`。客体启动后从发行版仓库安装 GCC 12.3.1，再将分支 `b855a8a` 的源码传入客体现场编译。采集命令为 `python3 run_all.py --require-openeuler --suite demand512-thp --repeats 3 --timeout 120`。[官方镜像与校验文件](https://repo.openeuler.org/openEuler-24.03-LTS/virtual_machine_img/x86_64/)

[内置 openEuler 实测记录](../examples/20261120T120355.446473Z/report.json)的报告 SHA-256 为 `53118ce1664fbc55b7884aac42794065de71a22cee14cd39649b319ec4f9fea0`。两种环境的探针 C 文件和采样头文件哈希逐字节一致。默认透明大页策略分别为 openEuler 的 `always` 与 WSL2 的 `madvise`。两边分别在同一环境内做对照，每种策略各跑三次并交替顺序。

| 写到 128 MiB | 累计写入位置 | 目标映射 RSS | 匿名大页 | 本步进程次缺页 |
| --- | ---: | ---: | ---: | ---: |
| openEuler 禁用建议，三轮一致 | 32768 | 128 MiB | 0 KiB | 32768 |
| openEuler 请求大页，三轮一致 | 32768 | 128 MiB | 128 MiB | 64 |
| WSL2 禁用建议，三轮一致 | 32768 | 128 MiB | 0 KiB | 32768 |
| WSL2 请求大页，三轮一致 | 32768 | 128 MiB | 128 MiB | 64 |

回放页的「切换同轮实验环境」可在 openEuler 与 WSL2 之间跳转，保留轮次、策略组和阶段。切换后，原文与笔记继续绑定到当前运行编号和报告哈希。

每份记录下的「对照本轮六个阶段」并排显示两组 RSS、匿名大页与步进次缺页。可下载一轮配对 CSV，用运行号、案例号、报告哈希和 smaps 哈希定位原文。无目标映射时，RSS 与匿名大页留空。

两种环境共 12 个案例的策略返回值、目标 VMA、采样以及末尾读回均通过校验。四分之一写入时两个组的 RSS 相同，匿名大页与进程次缺页计数不同。结果呈现观测到的分页机制，计数来自 getrusage，适用范围为该探针、当前环境与本次采样阶段。
