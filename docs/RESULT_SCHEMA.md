# 结果格式 v1

格式标识：`schema_version = "vmobserve.run/v1"`。Python 3.10+，JSON UTF-8，内存计量为 KiB，动作计数无单位。原始探针 JSONL 保持兼容；报告是统一外壳，不能替代原始证据。

| 字段 | 含义 |
| --- | --- |
| run_id / started_at / finished_at | 执行环境 UTC 标识与时间，客体时钟未保证与宿主同步 |
| data_origin | 真实运行为 real_execution；单元测试构造数据为 synthetic_test |
| view_mode | 原记录 execution_record；重建结果 historical_replay |
| environment | OS、内核、架构、页尺寸、Python/libc、THP 策略/分尺寸策略、meminfo、执行环境 |
| sources | 相对于 source/ 的源码路径 → SHA256，包含实际 C/头文件与编排/展示源码 |
| artifacts | 原始数据/日志相对路径 → SHA256 |
| builds / compiler_check | 命令、进程结果、错误与起止时间；原始版本输出在 build 日志 |
| plan / cases | 计划参数、case ID、执行状态、原始文件、解析观测、验证结果 |
| diagnosis | 规则版本、证据引用、confidence、解释边界、同轮对照与复验建议 |
| related_run | 父报告 ID/SHA256、复验配方与关系；非同一轮对照 |
| integrity | 回放时新计算，verified / legacy_partial / failed |

## 状态与退出码

| 运行状态 | 退出码 | 含义 |
| --- | ---: | --- |
| completed | 0 | 全部请求的案例执行完整，校验通过 |
| failed | 1 | 编译、进程、采集或正确性失败 |
| unsupported | 2 | 非 Linux、目标系统不符或基础采集条件不足 |
| completed_with_deviations | 3 | 程序完成，但某些观测关系偏离基线 |
| cancelled | 130 | 运行器收到中断，保留已完成和部分证据 |
| running | 无 | 中间检查点；持久化记录可能来自异常退出，不能视为正在实时采集 |

案例可有 `not_run`、`running`、`completed`、`failed`、`timeout`、`unsupported`、`cancelled`。案例 validation 是另一维：passed / deviation / failed / insufficient_evidence。编译失败的案例为 not_run，错误明确引用 compile_failed。原始值校验失败是 correctness 失败，数值关系偏离只是 expectation 偏差。

## 兼容旧记录

旧版无 schema_version，按原来 6+12 个实验的文件布局适配。读取原始源文件并核对旧报告的 4 个源码哈希，重新解析全部原始 JSONL/smaps。旧版未保存原始数据哈希，所以标记 legacy_partial，不能追溯证明这些原始文件从未改变。旧 summary 的“仅 WSL”文案保留在原文件中，界面以对应实际 environment 为准。

回放不会改写原 report，不执行历史源码，不信任缓存的诊断内容。若需要迁移，导出到新目录；导出附带原报告哈希及当前规则版本。
