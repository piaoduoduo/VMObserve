# 实际验证记录

记录日期：2026-11-10（北京时间）。下列 ID 为产生记录的环境自身 UTC；QEMU 客体时钟与宿主存在偏差，不能跨环境按 ID 排序。没有重建或移动已有 VM，原始历史记录仍在原位置。

## 正常实验

| 记录位置（相对项目根） | 真实环境/用途 | 验证结果 |
| --- | --- | --- |
| `work/openeuler-vm/guest-runs/20261110T091621.439041Z` | 用户提供的历史 openEuler 轮次 | 只读重建 18 项；全部校验通过；legacy_partial |
| `work/openeuler-vm/guest-runs/20261110T101531.518666Z` | 重构后首次 openEuler 完整运行 | 6 基础 + 12 THP，全完成并通过；verified |
| `work/runs/20261110T110930.821796Z` | 同一核心在 WSL Ubuntu 完整运行 | 18 项通过；verified |
| `work/openeuler-vm/guest-runs/20261110T102725.370510Z` | 页面点击稀疏写复验 | 6 项通过，父记录 101531，保存父 report SHA256 |
| `work/openeuler-vm/guest-runs/20261110T103503.315280Z` | 页面点击“运行完整实验” | 18 项通过；含扩大后的源码清单/编译器版本日志 |
| `work/openeuler-vm/guest-runs/20261110T103908.527510Z` | 页面选择逐基础页写，再点击复验 | 6 项全为 full，配方 thp_full_pair，父记录 103503；verified |

真实环境再确认：openEuler 24.03 LTS、Linux 6.6.0-28.0.0.34.oe2403.x86_64，QEMU 进程 PID 29（检查时）、TCG、2 核、2 GiB，THP enabled 为 `[always] madvise never`。WSL Linux 为 6.6.87.2-microsoft-standard-WSL2。

本轮仍观察到：稀疏写的 THP off/on RSS 为 64/32768 KiB；逐基础页写的次缺页为 8192/16。没有推断实机性能。最初历史轮次选出的 41 个源码/原始数据/report 文件与保存的哈希清单一致，清单在 `output/verification/historical-manifest.json`。

## 真实失败路径

`output/verification/failure-injection-20261110T111912.093497Z/verification.json` 记录三项 WSL 真执行：

- 指定不存在的 GCC：退出 1，状态 failed，案例 not_run，错误 compile_failed，保存日志和 report。
- 将探针 timeout 设为 0.00001 秒：退出 1，案例 timeout，保留部分原始文件，不作成功机制解释。
- 在 WSL 要求 openEuler：退出 2，状态 unsupported，未执行实验，保存环境与 report。

`work/openeuler-vm/guest-runs/20261110T103210.576796Z` 是 openEuler 的真实缺编译器注入；两项计划未运行，失败报告成功取回。对应传输记录为 `work/openeuler-vm/transfers/20261110T112315-565/transfer.json`，保留 remote_exit_code=1 与 retrieval_exit_code=0。

这些用于验证故障处理，不能计入成功机制实验数量。THP 回退分支目前只做了合成规则测试，尚无真实“请求 on 却未观察到 PMD THP”的样本；未修改全局策略来伪装该样本。

## 自动化检查

最终 `python -m unittest discover -s tests -v`：**16/16 通过**。完整日志：`output/verification/unit-tests-full-authorized.log`。

覆盖历史回放、零页置信度、合成大页回退、错误配对、原文破坏、采样缺失、源码修改、路径越界、HTML 转义、CSV 来源、非零退出/超时原始输出、HTTP 三格式导出、原始证据白名单、Host/Origin/token 校验和复验参数传递。前 11 项也在 WSL 中全部通过。

合成数据仅在单元测试内复制/修改，标为 synthetic_test，临时目录为 output/test-tmp，未放入工作台历史。第一次 Windows 测试遇到沙箱临时目录权限，改用项目内测试目录解决；HTTP 测试第一次遇到沙箱回环网络限制，之后在获准本机网络执行环境通过。失败日志没有改写成通过记录。

## 页面与导出

使用 Codex 内置 IAB 浏览器，未用 Playwright CLI 替代。实际验证完整运行、两种写入模式的复验、失败记录、历史播放/暂停、smaps 原文、HTML 下载及桌面/手机布局。页面未发现 JavaScript console error；手机 document scrollWidth=clientWidth（初检 390、最终有效内容宽度 375）。截图和设计比对详见 UI_VERIFICATION。

正式本地导出位于 `output/reports/openeuler-v0.1.0/`，HTML/JSON/CSV 来自完整轮次 103503 的只读重建，诊断规则版本以导出文件为准。浏览器下载副本在 `output/verification/browser-export.html`。

## 尚未验证

未做真实用户教学效果测试、非 x86 架构验证、真实交换压力、大页分配失败根因追踪、实机性能测试或远程断连下的进程回收审计。尚无正式提交或竞赛验收记录。当前成绩和获奖概率均未知。
