# 3.2 与 3.3 的参赛基线

两项原课例使用同一份 openEuler 记录 `examples/20261118T013159.221864Z`，报告 SHA-256 为 `7471631ce89130bfcf0caef4bacb0ef6de291ce11405d17279d76ac922c880a8`。复现入口为 `python3 work/run_all.py --suite group3 --repeats 1 --timeout 120`，重新执行会生成新的地址和记录编号。指导书对应关系见 [课程依据](COURSE_ALIGNMENT.md)。

| 指导书任务 | 案例 | 关键观测 |
| --- | --- | --- |
| 3.2，PDF 第 10–11 页 | `sequence-1` | 第三次申请后，1281 KiB 申请量对应 1428 KiB 相关映射，其中 RSS 为 4 + 12 = 16 KiB。 |
| 3.3，PDF 第 11–12 页 | `demand512-1` | 申请后目标映射 RSS 为 8 KiB。写入四分之一时，累计写入 32768 个位置，记录 266 次次缺页及 128 MiB 匿名大页。 |

2026-11-20 新增的 512 MiB 受控采集在 Ubuntu 24.04.5 LTS 的 WSL2 执行。[内置记录](../examples/20261120T113225.827429Z/report.json)为 `20261120T113225.827429Z`，报告 SHA-256 为 `9d7aa036cd908c7bbd110dc8f4755a594486e0a07d4073a2be3d43bcd5f9110e`，详见 [采集说明](../work/RUNNER.md#33-的-512-mib-透明大页对照)。三轮均在写到四分之一时记录到同样结果，两组映射 RSS 同为 128 MiB。禁用组记录 32768 次次缺页和 0 KiB 匿名大页，请求组记录 64 次次缺页和 128 MiB 匿名大页。当前待用 openEuler 独立复验这一组新对照。
