# 实际验证记录

## 2026-11-25 · 3.2 结论导出、3.3 笔记回跳与目录改名

- 在 Edge 回放 openEuler 实测记录 `20261120T105347.090942Z`，从申请前走到第六步并下载 HTML。页面与报告的第三次申请读数均为 `4 KiB + 12 KiB = 16 KiB`，全部释放后按旧地址查到的映射 RSS 均为 `4 KiB`。
- 在 openEuler 样例 `20261120T120355.446473Z` 中，分别在第 1 轮使用大页的「写到 ¼」和第 2 轮禁用大页的「写到 ½」保存验证笔记。每次都切到第 3 轮的「申请前」并刷新，再从笔记列表打开，两次均回到保存时的组和步骤。[仓库中的实测样例](../examples/20261120T120355.446473Z/report.json)
- 桌面侧栏标题和手机菜单按钮统一改为「目录」。刷新首页后，侧栏标题和首页说明均已显示新名称。
- 新增两条回归测试，覆盖结论页与单步导出的采样选择，以及策略顺序反转时的笔记定位。Node 测试共 39 项通过。

本机的浏览器验证产物保存在 `output/playwright/20261125-notes-fix/`，包含下载的报告 `3.2-conclusion.html` 和回跳位置记录 `3.3-note-return.json`。

## 2026-11-25 v0.8.3 三方分支整合验证

合并主线最新改动（含 11 月 20 日复做修复与 3.1 `file_stderr`/`readelf_stderr` 放行）、`origin/cdh_version`（3.3 512 MiB 受控大页对照、openEuler/WSL2 环境切换、配对 CSV 导出、步进学习笔记、跨轮并排对照、3.2 去重自测、按需单文件证据校验 `read_evidence` 与两份新实测样例 `20261120T113225.827429Z` / `20261120T120355.446473Z`）以及 `origin/feature/environment-doctor`（独立环境诊断 `work/doctor.py`）。

- Python 单元测试：`python -B -m unittest discover -s tests -v`，全部 100 项通过（含 `test_doctor`、`test_group3`、`test_server` 新增用例）。
- Node 前端逻辑测试：`node --test tests/test_notes_store.mjs tests/test_comparison_data.mjs`，全部 37 项通过。
- 环境自检 CLI：`python work/doctor.py` 正常执行并校验全部内置样例。
- 浏览器页面回放验证：检查首页、3.2 连续 malloc（含指针联动与第 4 步去重自测）、3.3 原版按需调页、3.3 512 MiB 透明大页对照（含 openEuler ↔ WSL2 切换、六阶段图表与跨轮核对）、3.3 栈增长、COW/THP 复做控件、跨轮并排对照与步进学习笔记，无控制台 JS 错误。

## 2026-11-19 v0.8.3 回放对照与笔记管理（`cdh_version`）

完成笔记列表／搜索／恢复撤销／导入备份和同阶段实验对照。Python 66 项检查、Node 27 项存储与对照逻辑检查通过，另完成四份内置实测报告只读重建核验。开发复验命令见 [学习流程说明](LEARNING_WORKFLOW.md)。

## 2026-11-16 v0.6 第3组完整实验

WSL `work/runs/20261116T082944.330397Z`和openEuler `work/openeuler-vm/guest-runs/20261116T083150.898289Z`均为24/24完成、校验通过、integrity=verified；后者由浏览器任务 `20261116T083138.463974Z`触发。每环境三次重复，含两种链接、连续malloc、512 MiB按需访问、正常递归及512/2048 KiB溢出、原layout。45项回归检查通过。每轮43源码和102输出哈希验证通过，CSV各135行，真实浏览器CSV一致。缺失trace清单的临时副本测试被正确拒绝，旧两轮33案例可回放，29原材料哈希不变。

证据位于`output/verification/v0.6-group3/`。最终仅将页面计数列按案例分别标为分配块数/写入位置数/递归深度，执行C/Python与快照一致；此JS展示差异记录在audit。浏览器发现原有favicon.ico 404，无JavaScript执行错误。详细数据见[完成记录](GROUP3_COMPLETION_20261116.md)。

最新阶段为文末的 **2026-11-13 v0.5.0 地址与映射**；以下历史记录保留其当时环境和测试数量。

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

## 2026-11-11 v0.2.0 COW 参数化

先检查现有环境，发现 VM 已停止。保留原串口日志后，使用原磁盘启动，未移动或重建镜像。再次确认 openEuler 24.03 LTS、内核 6.6.0-28.0.0.34.oe2403.x86_64、QEMU TCG 2 核/2 GiB、THP 默认 always。WSL 仍为 Linux 6.6.87.2-microsoft-standard-WSL2。11 月 10 日的约 51 分钟时差不是本轮测量结果，不能继续当作固定当前值。

| 独立真实记录（相对项目根） | 执行入口 | 结果 |
| --- | --- | --- |
| `work/runs/20261111T085149.710510Z` | WSL `work/run_all.py --cow-fraction all` | 30 项基础 + 12 项 THP 全部完成并校验通过 |
| `work/openeuler-vm/guest-runs/20261111T085215.932437Z` | `./work/vm.ps1 retest --cow-fraction all` | 30 项基础 + 12 项 THP 全部完成并校验通过 |
| `work/openeuler-vm/guest-runs/20261111T085556.996610Z` | 页面选择 1/8，再点击“运行 COW 对照” | 16/64 MiB 各三次，共 6 项全部通过；实际写页数 512/2048 |

openEuler 完整轮次传输记录：`work/openeuler-vm/transfers/20261111T085208-174/`。页面真实任务：`output/server-jobs/20261111T085547.200473Z/job.json`，其 command 保存 `--suite baseline --cow-fraction 1/8`，退出码 0。

在目标区父进程已写满、THP 关闭、无交换、父子同步采样的条件下，两环境每组三次都得到以下结果；不是只读取界面数字：

| 子进程写入比例 | 16 MiB 区域写页数 | 16 MiB 父子 PSS 合计 | 64 MiB 区域写页数 | 64 MiB 父子 PSS 合计 |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 | 16 MiB | 0 | 64 MiB |
| 1/8 | 512 | 18 MiB | 2048 | 72 MiB |
| 1/4 | 1024 | 20 MiB | 4096 | 80 MiB |
| 1/2 | 2048 | 24 MiB | 8192 | 96 MiB |
| 全部 | 4096 | 32 MiB | 16384 | 128 MiB |

`tests/verify_cow.py` 对已保存的真实记录做只读审计，独立列出 4 KiB 页下的预测值，逐项核对 30 案例条件覆盖、实际写入数、PSS、两侧 Private_Dirty/Shared_Dirty、父子页首值和诊断确认，并重新校验源码/原始数据哈希。审计自身不创建 Linux 实验，结果明确标为 historical_replay，采集来源仍为 real_execution：

- `output/verification/cow-wsl-20261111T085149/audit.json`
- `output/verification/cow-openeuler-20261111T085215/audit.json`
- 上述两个目录的 `report/` 均包含 HTML/JSON/CSV，原 report 哈希保持不变。
- `output/verification/cow-browser-audit-20261111.json` 核对页面新运行的六案例原始记录，并核对浏览器实际下载的 264 行 CSV 与同轮导出器输出一致，覆盖全部五种比例；下载副本为 `cow-browser-download-20261111.csv`。
- `output/verification/cow-history-20261111.json` 确认历史清单 41 个文件未变，旧 v1 轮次 18 项 verified；原始无 schema 的夹具仍通过 legacy_partial 回放测试。

`python -X utf8 -m unittest discover -s tests -v` **21/21 通过**；新增测试覆盖元数据与计划不符、实际计数不符、禁止新记录静默退回旧格式、单页值错误、计划覆盖与页面命令传参。构造的负路径样本仅在临时测试目录，不进入实验历史。第一次 HTTP 测试因本机回环网络权限返回 WinError 10013，随后在获准环境运行通过；这不属于实验机制失败。本轮测试结果保留于聊天工具回执，没有将旧测试日志冒充新日志。

C 探针按 `-std=c11 -O2 -Wall -Wextra -Werror` 编译通过；页面 JavaScript 语法检查和 `git diff --check` 通过。实际浏览器完成比例选择、运行状态、历史切换、原始 JSONL、CSV 下载；console error 为空。截图见 UI_VERIFICATION。

结论范围：确认目标区域的计账关系与页首值隔离；零写入只确认保持共享。没有直接跟踪物理页帧、没有实机性能结论，也没有新增教学效果或真实 THP 回退证据。

## 2026-11-11 v0.3.0 课程 malloc 观察

复用正在运行的 QEMU（当次 PID 37）和既有磁盘，未重新部署。目标仍为 openEuler 24.03 LTS、Linux 6.6.0-28.0.0.34.oe2403.x86_64、TCG 2 核/2 GiB；WSL 为 Ubuntu 22.04.1 LTS、Linux 6.6.87.2-microsoft-standard-WSL2。新增探针保留各自 THP 默认值，未修改全局策略。

| 独立真实记录（相对项目根） | 内容 | 结果 |
| --- | --- | --- |
| `work/runs/20261111T094314.783829Z` | WSL 首次课程小轮，每种大小一次 | 4/4 完成并通过 |
| `work/runs/20261111T094618.121722Z` | WSL 完整五比例对照加课程实验 | 54/54 完成并通过 |
| `work/openeuler-vm/guest-runs/20261111T094632.898125Z` | VM 完整五比例对照加课程实验 | 54/54 完成并通过 |
| `work/openeuler-vm/guest-runs/20261111T094820.213072Z` | 真实页面点击“运行课程实验” | 12/12 完成并通过 |

两个 54 项完整轮次各包含课程 12、COW 基础 30、THP 12。完整 VM 传输日志在 `work/openeuler-vm/transfers/20261111T094620-355/`；页面任务在 `output/server-jobs/20261111T094811.037313Z/`，保存真实命令 `--suite course` 和退出码 0。原服务确认空闲后才停止并重启为 v0.3，未中断正在执行的实验。

两环境 1 KiB 每组三次均记录相关映射 RSS 序列 0/4/4/4/4/4 KiB，申请时 1 次次缺页，写入时无新增次缺页，free 后仍有映射。WSL 的 16 MiB 相关映射 RSS 为 0/4/4096/8192/16384/0 KiB；openEuler 第一次为 0/8/4376/8472/16388/0 KiB，其余重复中间值不同。较大块释放后原申请范围均未发现映射。保留 THP 默认策略的课程实验并非严格页数/缺页一一对应验证；结果差异原样保存，不拟合成相同数字，也不把默认策略当作唯一根因证明。

`output/verification/v0.3-course/audit.json` 是两个完整真实轮次的只读审计，核对源码和原始记录哈希、54 项验证状态、四尺寸三重复条件和六阶段数据。旁边以运行 ID 命名的两个目录保存 HTML/JSON/CSV 导出，各 336 条样本，其中课程 72 条明确标记 overlapping_vmas。导出前后原 report 哈希未变。早期 18 项记录仍为 legacy_partial，v0.2 的 42 项记录 verified，未改写旧数据。

`browser-audit.json` 核对页面新记录和实际下载：12 项、72 行 CSV，下载文本与本轮只读导出完全一致；副本 `browser-download.csv`。同时核对最初历史清单的 **41 个文件哈希未变**。来源材料哈希位于 `course-source-hashes.json`。

自动检查 **25/25 通过**，新增覆盖 malloc 整映射口径、释放后保留、非法条件/地址/计数、缺少 smaps 字段/阶段、值错误及入口传参。合成负路径数据仅用于测试，不进入实验历史。当前测试回执保留在聊天工具记录；没有冒用旧日志。C 按 `-std=c11 -O2 -Wall -Wextra -Werror` 在两环境编译通过。完整运行后仅补充页面“大页驻留”行和文档，不修改采集实现；最新页面语法检查通过。

实际浏览器验证新任务、尺寸切换、六步导航、原理展开、原始 JSONL 弹窗和 CSV 下载；console error 为空，桌面截图见 UI_VERIFICATION。本轮没有重测手机布局。仍未做理论 PPT 页码核对、真实教学试用、系统调用/PFN 跟踪、真实 THP 回退根因验证或实机性能评测。

## 2026-11-12 四项审查修复

`python -B -X utf8 -m unittest discover -s tests -p 'test_*.py' -q`：37 项全部通过，日志为 `output/verification/review-fixes-20261112-tests.log`。新增 6 项测试覆盖新旧格式中首项／末项损坏的隔离、共享环境错误仍全局阻断、THP 相同／不同计数标题、退出码 3 与新报告状态匹配、CSV 失败状态及无采样案例。测试中的修改只发生在临时副本或构造输入，未修改历史夹具。页面 app.js 模块语法检查通过。

只读重建 openEuler `20261111T124218.162916Z`：30 项，completed、integrity=verified，CSV 144 行。只读重建 WSL 学生记录 `20261111T124215.521623Z`：12 项，failed、integrity=verified，CSV 72 行均保留 case_status=completed、validation_status=failed、run_status=failed。新 CSV 保存为 `output/verification/review-fixes-20261112-student.csv`。两份原始 report.json 前后哈希一致，清单中源码与原始文件校验通过。

本轮未改 C 探针、未运行新 Linux 实验；新增验证属于自动回归和历史回放，不复用为新的实测结果。

## 2026-11-11 v0.4.0：学生任务与真实策略反例

复用既有 VM，未移动镜像、重建系统或修改全局 THP。openEuler 内核仍为 6.6.0-28.0.0.34.oe2403.x86_64。

| 目录下的运行 ID | 环境 / 内容 | 结果 |
| --- | --- | --- |
| `work/runs/20261111T123819.434532Z` | WSL 进程策略，稀疏/逐页各三对 | 12/12 通过 |
| `work/runs/20261111T124129.257226Z` | WSL 默认完整回归 | 30/30 通过 |
| `work/runs/20261111T124215.521623Z` | WSL 未完成学生骨架 | 12/12 按预期任务检查失败；采集完整 |
| `work/openeuler-vm/guest-runs/20261111T124218.162916Z` | openEuler 默认完整回归 | 30/30 通过 |
| `work/openeuler-vm/guest-runs/20261111T124402.584266Z` | openEuler 进程策略，稀疏/逐页各三对 | 12/12 通过 |
| `work/openeuler-vm/guest-runs/20261111T124649.335779Z` | 页面实际点击检查学生骨架 | 12/12 按预期任务检查失败；采集完整 |
| `work/openeuler-vm/guest-runs/20261111T124854.313916Z` | 页面关联上一个 THP 记录，稀疏三对 | 6/6 通过，父报告 ID/哈希匹配 |

两环境所有策略对中，允许组 AnonHugePages=32768 KiB，禁止组=0；稀疏组 RSS 分别为32768/64 KiB，逐页组为32768/32768 KiB。两组 MADV_HUGEPAGE 都成功，PR_GET_THP_DISABLE 与原始 THP_enabled 均一致。确认本轮人为进程禁用阻断大页；未验证自然内存碎片、无法泛化为所有未分配原因，也不代表性能提升。

学生骨架累计位置为 0，页首值/阶段计数检查失败，完整六步仍可回放。统一运行器退出 1、报告 failed，与正常实验没有混作全部通过。工具没有替用户填写任务。

`output/verification/v0.4-course/audit.json` 审计七轮、三格式导出、来源和 68 个历史文件哈希；全部未改写。复核脚本为 `tests/verify_v04.py`，属于历史只读核查。`unittest.log` 为 31 项回归检查通过；其中合成的策略状态缺失/冲突、缺少阳性对照、条件不匹配、学生计数错误均不是 Linux 实测。首轮本机 HTTP 检查受 WinError 10013 限制，获准环境重跑后通过。

`browser-audit.json`、`browser-policy.csv` 与 `browser-worksheet.json` 保存真实浏览器下载核对：CSV 的 12 行与已验证报告导出一致；关联复验父哈希一致；学习记录为 ui_verification / not_graded，绑定失败学生轮次及源码哈希。正常学习页保持空白草稿。页面控制台无 error/warn；截图见 UI_VERIFICATION。最终页面补充了课程案例选择和记录刷新选择逻辑，未改写之前的源码快照；两份 JS 语法检查通过。移动布局未测。

## 2026-11-13 v0.5.0：程序地址、映射与装载段

复用现有 QEMU 磁盘；启动前保存既有 serial 日志，没有重建系统或调整全局 THP。证据目录为 `output/verification/v0.5-layout/`。

| 运行位置 | 内容 | 结果 |
| --- | --- | --- |
| `work/runs/20261113T123249.368354Z` | WSL 初始单例试跑，版本号尚为 0.4.0 | 1 项完成；与最终验证分开记录 |
| `work/runs/20261113T123619.972191Z` | WSL 最终默认完整计划，v0.5.0 | 33/33 完成并通过，integrity=verified |
| `work/openeuler-vm/guest-runs/20261113T123613.857588Z` | openEuler 最终默认完整计划，v0.5.0 | 33/33 完成并通过，integrity=verified |
| `work/openeuler-vm/guest-runs/20261113T123758.496525Z` | 浏览器真实点击地址实验 | 3/3 完成并通过，integrity=verified |

WSL 内核为 6.6.87.2-microsoft-standard-WSL2；openEuler 为 6.6.0-28.0.0.34.oe2403.x86_64。每轮完整计划包含地址 3、malloc 12、基础 6、THP 12。七类地址均能关联实际映射；程序代码、全局数据和库函数进一步关联已加载 ELF 段。未初始化数组落入匿名映射，同时仍属于程序的数据装载段；不同进程地址变化按原始记录展示，不据此单独证明随机化原因。结果用于机制与功能验证。

`tests.log` 保存 42 项自动测试通过结果，新增 5 项覆盖地址/段关联、跨映射 BSS、缺失与冲突证据、权限偏差、导出和入口。合成测试不计入上述 Linux 实验。首轮日志 `tests-initial.log` 保留本机 HTTP 权限限制导致的 4 项错误；允许本机服务访问后完整重跑通过。JS 模块语法检查通过。

浏览器任务 ID 为 `20261113T123750.163968Z`。真实下载 `browser.csv` 的 21 行与导出器一致，未采集的缺页数留空；页面无控制台错误。三份最终报告的 HTML/JSON/CSV 保存在对应 `export-<ID>/`，截图见 UI_VERIFICATION。

只读复核旧 openEuler `20261111T124218.162916Z` 的 30 项成功记录和 WSL `20261111T124215.521623Z` 的 12 项学生检查失败记录，二者完整性均 verified，失败状态保留。此前 23 份 report.json 哈希未变，清单为 `history-before.json`，汇总为 `audit.json`。未开展真实学习者试用。

## 2026-11-16 v0.6.1 连续 malloc 专项

新增 WSL `20261116T085950.403720Z`、openEuler `20261116T090129.522833Z`，各3/3完成、检查通过。后者由页面新按钮触发，任务 `20261116T090119.677673Z`。52项自动检查通过，包含7项新增解析/统计/缺工具边界测试；这些合成测试与6个真实案例分开计数。

两轮旧group3各24案例、两轮旧v0.5各33案例只读回放通过；29份历史报告哈希未变。每轮导出15行CSV及HTML/JSON；详情、观测范围和待办见 [专项完成记录](V06_SEQUENCE_20261116.md)。审计入口 `output/verification/v0.6-sequence/audit.json`，原始运行目录不改写。该轮不重跑其余课例，也不声明教学试用完成。

## 2026-11-16 v0.7.0 第4组

WSL `20261116T091932.046340Z`、openEuler `20261116T092118.588077Z`各42/42真实案例completed、passed、verified；后者由网页任务 `20261116T092105.320066Z`触发。每轮57份源码哈希与当前实现一致，各导出525行CSV及HTML/JSON。60项自动检查通过，新增8项解析/错误证据回归与真实运行分开计数。

旧24/24/3/3/33/33只读回放通过，29份原材料未改。独立脚本与便携包复验见 `output/verification/v0.7-group4/delivery-audit.json`；原始运行与导出审计在同目录audit.json。每项运行结果与边界见 [GROUP4_COMPLETION_20261116.md](GROUP4_COMPLETION_20261116.md)。

## 2026-11-16 第1、2组补齐

六项实际记录与证据索引见[完成记录](GROUP12_COMPLETION_20261116.md)。审计 `output/verification/group12-20261116/audit.json`：普通用户基础/编译/strace/两种异常通过，Git两种补丁完整树一致；原容器构建、hello退出0与7项宿主/容器观察检查通过。实际Windows演示入口status/git/linkage已运行。

容器内能力赛运行 `20261116T121454.736703Z` 的2个案例均completed/passed/verified，取回回放与HTML/JSON/CSV导出通过；57份运行源码与当前工程一致，29份原课程材料哈希未变。核心未改，本轮不重复计算此前60项测试。首次600秒构建超时与1800秒重试成功均保存。
