# 来源与阅读记录

## 课程代码来源

下表列出与华中科技大学操作系统课程《应用层实验－学生版》代码包逐份核对、SHA-256 相同的四份文件。

| 仓库文件 | 课程代码包中的原始路径 |
| --- | --- |
| [第 1 组 hello.c](../work/course-labs/group12/basics/hello.c) | `lab1/lab1_2/hello.c` |
| [第 2 组 zero.c](../work/course-labs/group12/basics/zero.c) | `lab2/lab2_2/zero.c` |
| [容器 Dockerfile](../work/course-labs/group12/container/Dockerfile) | `lab2/lab2_3/Dockerfile` |
| [容器 hello.c](../work/course-labs/group12/container/hello.c) | `lab2/lab2_3/hello.c` |

第 4 组在课程包 `lab4/lab4_1` 至 `lab4/lab4_4` 的五份骨架上改编，新增了 `child_prog.c`。原件和沿用的骨架部分保留课程材料的权利归属，公开再分发授权待课程组确认。团队原创代码和文档的许可见[授权说明](../NOTICE)。[第 4 组改编记录](GROUP4_COMPLETION_20261116.md)

## 2026-11-16 全国功能赛优秀作品

- [赛事官方 2021–2025 部分功能赛获奖索引](https://github.com/oscomp/os-competition-info/blob/main/os-funtion-winners.md)：逐行读取，定位全国获奖作品；原 GitLab 部分不可访问，使用 oscomp 的公开归档。
- [华科 RRAM 获奖新闻](https://sse.hust.edu.cn/info/1096/3784.htm)与 [官方归档](https://github.com/oscomp/first-prize-osf2024-RRAM)：核实 2024 全国一等奖，阅读决赛 PDF 的课程、虚存、测试等相关页及对应实现，9 页渲染查看。非全仓审查，未运行。
- [F-Tutorials 与 LMY 获奖报道](https://carc.hitsz.edu.cn/info/1022/2073.htm)：分别核实全国二等奖与一等奖。F-Tutorials 的 [骨架](https://github.com/F-Tutorials/user-land-filesystem)、[测试](https://github.com/F-Tutorials/user-land-filesystem-test)、[指导书](https://gitee.com/ftutorials/ftutorials_book)取得源码并读取相关内容；LMY 未取得完整实现，不做代码级结论。
- [MIAYC 官方归档](https://github.com/oscomp/first-prize-osf2025-heap_detection)：由官方索引核实 2025 全国一等奖，读取测试材料与部分采样/检查/统计代码。数字为作者报告，不是本项目实测。
- [movedancer/OScomp](https://github.com/movedancer/OScomp)：作者自述区域一等奖；阅读内存/进程关卡与片段，未找到独立对应奖项，记录其立即复制与 COW 描述冲突。
- 1037.wiki 本轮超时；GitHub API 返回速率限制，随后通过公开 Git 和固定提交的原始文件读取。未读取私人仓库、未执行参考项目脚本。当前区域赛章程物理第 1 页已目视复核全国资格的推荐/审核条件。

详细文件范围、提交及哈希见 `output/research/national-reference-20261116/source-manifest.json`；结论见 [全国作品研究](NATIONAL_REFERENCE_STUDY_20261116.md)。仓库中晚于获奖时间的资料和报告/代码差异均明确列出。

## 2026-11-11：区域课程获奖作品与 GitHub 源码对照

完整分类、阅读文件和差距分析见 [REGIONAL_COURSE_COMPARISON.md](REGIONAL_COURSE_COMPARISON.md)。本地研究快照及哈希在 `output/research/regional-course-20261111/source-manifest.json`。

- [上海电力大学区域赛报道](https://jsjxy.shiep.edu.cn/_t189/f9/65/c972a260453/page.htm)：读正文，确认 2024 华东区域 OS 原理二等奖“OpenEuler 系统实验设计”；未取得对应源码/完整报告。
- [OS-Barrier](https://github.com/HarvestMoons/OS-Barrier)：读完 README、barrier.c、barrier_empty.c，固定 f48439e37e326efd6ab2484db36f29419675bc1c。区域三等奖仅作者自述，未独立核验，未运行。
- [BirdOS](https://github.com/laojiahuo2003/bird-OS)：读内存管理设计文档至懒分配部分，核对 uvmcopy/copyout 和 cowtest。固定 ee9a29688179724783ed2373d04e7df11ff5e610；一等奖仅作者自述，且是内核方向、当前快照晚于比赛，未运行，不作本题硬门槛。
- [smem Python 3 改编版](https://github.com/kwkroeger/smem)：读映射解析、汇总和入口，固定 1910834fbad7809507fc23406de0a17c6bb148dc。用原始 pidmaps 函数核对 144 个历史快照的七项计数，1008 项一致；只属于历史解析验证，未启动完整应用或新 Linux 实验。
- [memory-watcher](https://github.com/Karry/memory-watcher)：读采集、数据库和回放实现及 README，固定 d5a72cd95a09490d71b4a17e2ce894d4a071b66d，未编译或运行。记录/回放/图表本身不应被称为本项目独创。
- [阶·电校方报道](https://www.shiep.edu.cn/48/8a/c2933a280714/page.htm)、[F-Tutorials 校方报道](https://carc.hitsz.edu.cn/info/1022/2073.htm)：读正文，分别为全国三等奖和全国二等奖教学项目；未读到对应获奖提交的完整源码，不能与区域奖次换算。
- 实际读取 2024/2025 华东原理赛公开排行榜的正常加载回执，均为“当前的排行榜未公开”；没有访问非公开内容。1037.wiki 和 F-Tutorials Gitee 组织入口访问超时。GitHub 搜索取得一页候选后 API 受限，后续通过公开网页及已定位仓库继续；未取得同方向区域一等奖的官方奖项、完整代码与报告三者齐全的样本。

2026-11-10 接手阶段已阅读用户指定的 RUNNER、两份预实验 README、运行脚本、指定 openEuler report 与两份比赛 PDF。技术方案提取了全部 3 页；扫描版章程渲染并逐页查看 7 页。渲染留存在 `output/verification/pdf-read/`。

## 比赛一手材料

- [官网](https://os.educg.net/#/index?TYPE=26OS_ZXHNF)、[赛题入口](https://os.educg.net/#/sList?TYPE=26OS_ZXHNF)：本轮静态读取只能得到需要 JavaScript 的页面，未重新取得动态赛题正文；第 5 题的当前定位承接用户已确定方向及项目既有阅读记录。
- `outputs/2026操作系统中西部华南区域赛-章程.pdf`：第 3 页为 2026-12-27 前提交要求；第 5—6 页为开源、AI 说明与贡献要求。
- `outputs/2026操作系统中西部华南区域赛-技术方案.pdf`：第 2 页功能挑战的参考权重为执行展示 30%、文档 20%、工程规范 20%、AI 说明 10%、演示视频 20%。这些是提供的本届 PDF 内容，不能代替临近提交时的更新通知。

## 华科课程与往届材料

按用户要求先检索了 GitHub 与 [1037.wiki](https://1037.wiki/)。本轮 1037 首页只有搜索入口，没有取得对应应用层内存实验报告正文；不把它写成已阅读报告。

已读本地保存的 `work/hust-pke-cow-reference.md`，来源为 [CubeLander/hust-pke-docs · lab3_challenge3](https://github.com/CubeLander/hust-pke-docs/blob/main/lab/lab3_challenge3.md)。该文讨论 fork 权限、页错误与引用计数，但明确省略具体实现。本轮网络重取正文失败，因此准确表述为“阅读已有本地副本”。PKE 实验环境不同于当前 openEuler Linux 应用层实验，只作为机制背景，不复制其实现。

用户的当期课程材料路径与具体 demand/malloc/maps 实验，已在 `work/proj5-memory-pilot/README.md` 记录。本轮继承原探针动作，没有声称完成 malloc 对照，也未编造同学试用、个人经历、姓名学号或分工。

## 接口语义

- [Linux proc / smaps](https://docs.kernel.org/filesystems/proc.html)：目标 VMA 的 RSS、PSS、AnonHugePages 等口径。
- [Linux THP](https://docs.kernel.org/admin-guide/mm/transhuge.html)：策略、实际分配和回退；新内核还可能有多尺寸 THP，不能把 PMD 指标当成所有物理粒度的证明。
- [getrusage](https://man7.org/linux/man-pages/man2/getrusage.2.html)：进程级缺页统计，原探针参考。
- [madvise](https://man7.org/linux/man-pages/man2/madvise.2.html)：区域建议语义，原探针参考。

本轮在线读到了前两个 Linux 官方文档正文。后两个链接承接原探针注释，不虚称本轮逐页复读。

## 2026-11-11：其他赛道与赛题复核

用户要求保留当前成果看效果，并进一步比较其他赛道。本轮没有切换项目选题，没有安装其他赛题环境，也没有运行它们的测试。

通过浏览器实际打开[本届功能挑战赛题列表](https://os.educg.net/#/sList?TYPE=26OS_ZXHNF)，逐一打开全部 7 个“查看”弹窗，读到以下要求。列表当前共 7 题；A/B 是官网难度标签，不是获奖等级。以下是要求摘要，不是完成记录。

| 编号 | 官方名称与难度 | 影响选题的明确要求 |
| --- | --- | --- |
| 1 | 面向具身智能的国产操作系统ACT模型适配与实时推理优化，B | 在 StarryOS 上运行统一 ACT 模型；QEMU CPU 推理为基础层次，RK3588 NPU / SG2002 256MB TPU 为更深层次。页面明确完成难度层次并非最终评奖标准。 |
| 2 | 面向openEuler的自适应资源管控Agent，B | 用户态 Agent、标准 Tool / Skills 接口、workload 感知、实际 sched_ext / scx 调度闭环与性能对比；交付环境 openEuler 24.03-LTS-SP3。仅展示资源数据或调整 cgroup 不足以覆盖核心要求。 |
| 3 | 面向多智能体的操作系统级执行时（Agent Runtime），A | 至少一个国产开源 OS；依赖及动态任务调度、资源感知、生命周期、故障隔离、上下文复用/压缩/隔离、通信、复杂场景和性能验证。 |
| 4 | 智能体操作系统中的多智能体协作技术，A | Linux + AIOS + 端侧 7B/8B 模型；至少 4 种智能体、4 个可并行子任务、3 对不同类型智能体双向交互；处理依赖；并发总时间相对多智能体串行至少减少 20%，且任务正确。 |
| 5 | 课程实践案例，B | 来自本校 OS 课程实践，可只选一个机制方向；功能完整正确、可运行验证，特色有可观察的对比证据；鼓励机制观测、难点解析、工具复用。 |
| 6 | xv6网络和动态链接功能的设计与实现，B | 指定 2026 北航扩展版；支持 iperf/netperf/libctest/libcbench 等相关测例与原测例；保持 RISC-V、LoongArch 及 xv6/ext2/fat32；C 实现，提交与基础版的 diff。 |
| 7 | AI辅助的xv6微内核化重构，A | 指定 2026 北航扩展版；文件系统/驱动等用户态服务和 IPC；保留双架构、三文件系统及原测例；新增故障隔离和恢复测试，提交关键 AI 提示词。页面命名日期为 2026-10-30。 |

本届另有 OS 内核实现赛道。已读本地技术方案要求完整内核、Docker 构建环境及自动平台功能/性能测试记录；参考权重代码通过率 40%、文档 20%、工程规范 20%、AI 说明 10%、视频 10%。本轮也读取了[官方内核赛道入口](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=z0ZUSt-KKQQ&doVisit=true&my=false)，但没有取得本届全部测例详情，不把全国赛或往届测例直接当作本届内核赛要求。

技术前提补充：实际读取了 [scx 官方 README](https://github.com/sched-ext/scx) 和 [Linux sched_ext 文档](https://docs.kernel.org/scheduler/sched-ext.html)。上游从 Linux 6.12 支持 sched_ext，需 CONFIG_SCHED_CLASS_EXT 与 BPF/BTF 等配置；发行版可能回移植，不能仅凭版本号断言支持。已有通过验证的 openEuler 24.03 LTS / 6.6.0-28 环境不能直接当作第 2 题 SP3 + scx 的验收环境。本轮未现场探测其 scx 配置，也没有升级内核。

实际读取了 [AIOS 官方 README](https://github.com/agiresearch/AIOS)，其 Kernel 是 OS 内核之上的资源抽象层，SDK 为 Cerebrum；不把“AIOS Kernel”误称成新写的 Linux 内核。访问[赛题指定北航基础仓库](https://gitlab.eduxiji.net/educg-group-48534-3136859/T2026100069911110-2748)超时，未声称审阅其实现或验证其测试。

评估意见（不是官方结论、不是用户已同意换题）：第 5 题仍有现成真实证据优势；第 2 题是值得新增预研的候选，可复用编排/记录/对照/页面，但必须另行验证 SP3/scx 兼容性和可信性能环境；第 4 题需要本地模型与 20% 加速的可行性验证。第 6 题范围比“xv6功能扩展”简称广，不再视作轻量兜底。第 1、3、7 及完整内核赛道的技术深度可观，但现有机制实验代码复用较少。所有其他选题均尚未实际开发或验收。

## 2026-11-11：扩展到区域赛之外

用户进一步询问这一大类以外的操作系统设计赛道，本轮扩大检索范围，仍未改变实现或报名。

- [第三届中国研究生操作系统开源创新大赛暨开放原子大赛操作系统专项赛邀请函](https://cpipc.acge.org.cn/cw/contestNews/detail/2c9080178c7c917b018d1b1a0af61cd6/2c9080179dcfa227019e297e87857f34?page=1)：实际阅读正式通知全文。分系统创新（核心功能、缺陷修复、架构适配等）、应用创新（移植、应用、开发工具等）、研究创新（优化、容错、量化分析等）三赛道；2026-07-28 17:00 截止报名，07-30 17:00 截止提交，已过本届报名窗口。本科生可参加，但队长须为在读研究生；这里只记录资格边界，不以招募替代开发。下一届日期未核实，不把往年节奏当已发布安排。
- [基于 eBPF 的系统异常观测与根因定位工具](https://competition.openatom.tech/competitionInfo?id=b125dbcd11b797bda588b8f90c5fb7fe)：实际通过浏览器阅读全文。属于上述专项赛，要求 openKylin，五类异常至少覆盖四类（CPU/调度、I/O、内存/OOM、锁竞争、系统调用），结构化输出及可回溯证据；评分功能40、诊断准确30、性能开销15、工程规范15。基础环境4核/8GB/50GB、内核6.6及以上与必要BPF权限。与当前项目有方法上的衔接，但当前代码没有eBPF、没有四类异常覆盖，也未做准确率和开销验收。页面仍有“进行中”字样，但同时显示“截止报名”与7月截止日，不可误报为现可报名。
- [开放原子比赛列表](https://competition.openatom.tech/competition)：通过浏览器确认 Agentic OS 开源贡献赛显示“进行中”，承办方杭州阿里云飞天信息技术有限公司，报名截止2027-09-30。官方列表跳转到 https://taiyi.top/competition-details?id=4fb6ad2c-bc98-11f1-8bb8-02420a000047 ，但浏览器报域名无法解析、网页工具也未取得详情。仅确认列表信息，未确认资格、任务、评审或该赛项是否真的涉及OS内核。
- 同一列表可看到开源鸿蒙原生AI应用、openKylin异构算力调度、openKylin开源实践等其他赛项，但本次可见的这些条目是2025截止且“已结束”，仅作赛事类型参考，不能作为2026年11月现有报名机会。
- [openEuler 2026年度规划](https://www.openeuler.org/zh/interaction/event-list/)列有8—10月Hackthon软件难题挑战赛；仅核实年度规划，未获得仍开放报名的具体赛项。开源之夏、开源实习与训练营应区分于学科竞赛。

后续技术方向建议属于评估：若继续发展现有内存工具，eBPF异常观测与根因定位是比完全重写内核更顺畅的扩展方向；需新增实际采集、更多故障场景、准确率和运行开销评测。赛事名额、下一届题目及学院奖项认定均未因此确认。

## 2026-11-11：同一大赛的其他赛项（用户澄清后的当前范围）

用户明确要看“全国大学生计算机系统能力大赛”自身其他赛道，排除当前七道OS功能挑战题；上一节其他赛事不是本轮需要的范围。通过官方门户实际看到六大类选项：CPU、编译、操作系统、数据库、智能计算、智能系统；也与[西安交大通知](https://due.xjtu.edu.cn/info/1172/9851.htm)相符。

- [编译系统实现赛](https://compiler.xtnl.org.cn/#/index?TYPE=26COM)：浏览器阅读“比赛内容与要求”。C/C++/Java/Rust开发，x86 Ubuntu24.04构建，SysY2026（页面注明初赛沿用SysY2022）输入，ARMv8-A64或RISC-V64汇编输出；完整前端、代码生成及优化，功能和目标程序运行性能测试，决赛需现场修改。此页仍链接2025测例/2024提交指南，未把这些旧链接误称为2026最新测例。
- [编译系统挑战赛官方平台](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=1mTsU6jaSZ0&my=false&tabDocID=10730949)：实际读取赛题和赛程，包含Triton自动优化、动态算子图编译与并行调度、Java虚拟线程、LoongArch二进制/SIMD优化等题；2026初赛8月5日截止、8月19日决赛提交、平台显示9月30日结束。[章程](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=1mTsU6jaSZ0&my=false&tabDocID=503583)确认实现/挑战两赛道及ARM/RISC-V后端。这里只核实挑战题目录，尚未逐题读取技术方案。
- [数据库赛官方页面](https://compiler.xtnl.org.cn/#/index?TYPE=26DB)：浏览器阅读“比赛内容与提交方式”，在官方C++原型框架上实现存取管理、查询处理、事务处理，执行正确性和性能评测；明确线下现场编程“不允许使用AI辅助编程”。[官方平台](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=6gutcJNDUrw&my=false&tabDocID=519146)显示初赛7月13日截止、8月17日线下决赛、9月1日结束。
- [CPU龙芯杯团体技术方案入口](https://www.nscscc.com/?p=837)：在线读取链接的7页官方PDF，要求FPGA上LoongArch微系统、指令正确性与性能；决赛含OS/应用运行展示、自定义指令、答辩；完整硬件工程含源码、管脚和下载文件。个人赛分MIPS/LoongArch入口亦已核实。[官网](https://www.nscscc.com/?cat=16)9月2日发布2026获奖名单。
- [智能系统小米杯页面](https://compiler.xtnl.org.cn/#/index?TYPE=26IS)：浏览器读取官方资源列表，并实际下载和全文提取官方GitLab赛题PDF，保存 `output/research/sibling-tracks-20261111/xiaomi-2026-task.pdf` 及同名txt。五页赛题要求四足机器人15分钟内全程自主完成“荒野寻宝”六赛段，包含运动控制、视觉目标识别、避障、语音播报、过桥/踢球等。原题链接在[官方GitLab](https://gitlab.eduxiji.net/csc1/csc-is/is2026/-/blob/main/2026%E5%B9%B4%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%B3%BB%E7%BB%9F%E8%83%BD%E5%8A%9B%E5%A4%A7%E8%B5%9B-%E6%99%BA%E8%83%BD%E7%B3%BB%E7%BB%9F%E5%88%9B%E6%96%B0%E8%AE%BE%E8%AE%A1%E8%B5%9B_%E5%B0%8F%E7%B1%B3%E6%9D%AF_%E8%B5%9B%E9%A2%98.pdf)。[官方赛事平台](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=y8uWyHEWHNo&my=false&tabDocID=12658760)显示本届已结束。
- [先导杯承办方同济大学通知](https://ci.tongji.edu.cn/c3/b4/c30674a377780/page.htm)：两题分别为国产加速卡Qwen推理服务优化、国产科学智算生态气象大模型推理部署优化；提供比赛算力及评测资源，报名6月15日截止，初赛7月15日截止，8月线下决赛。官方两题平台也显示已结束；本轮未读取两题全部技术方案。

当前判断：上述五大类2026全国赛的本届窗口均已结束，2027安排未核实。与用户AI开发偏好较相关的后续研究对象为编译挑战中的自动优化/算子图任务，以及先导杯推理优化；这是方向建议，不表示性能收益已经验证。当前OS区域赛另有内核实现赛道，与五个兄弟赛项的赛期不同。没有更改代码、重建环境或提交报名。

## 2026-11-11：内核实现赛制深化

详细分析和待确认项见 [OS_KERNEL_RULES.md](OS_KERNEL_RULES.md)。暂按用户此前排除七道功能挑战题的范围研究平行的内核实现赛道，尚未决定转向。

- 实际浏览[区域内核官网](https://os.educg.net/#/index?TYPE=26OS_ZXHNK)的大赛时刻、章程与技术方案、比赛内容和提交方式、技术报告、技术支持。官方要求内核源码、构建文件、Docker、官方功能与性能测试完整通过记录及有效成绩、设计文档与视频；通过指定 GitLab 项目链接评测，HTTPS 推拉。链接的提交指南仍是 2024 文件，未当作 2026 测例依据。
- [公开平台](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=z0ZUSt-KKQQ&doVisit=true&my=false)显示 10/10 19:26–12/27 23:59 阶段时间，另有 02/01 23:59 结束栏，后者不替代作品截止。[排行榜](https://course.educg.net/pages/contest/contest_rank.jsp?contestID=z0ZUSt-KKQQ&my=false&contestCID=0)提示当前提交结果暂未生成排行榜。官网当时 87 支队伍仅为报名数量，不用于估计有效竞争队数或获奖概率。
- 内核“进入初赛”跳转登录，没有取得账号内测例、提交次数、目标架构和性能计分细则。没有登录、报名或提交。
- 本地章程第 2–6 页重新视觉核查，技术方案 3 页文字重新读取。奖项无已确认配额；全国决赛资格须推荐和审核；AI 允许辅助但有实质贡献要求。具体答辩安排仍待通知。
- 实际读取 [oscomp/testsuits-for-oskernel final-2026](https://github.com/oscomp/testsuits-for-oskernel/tree/final-2026) README：明确是 2026 全国赛线上决赛 CAgent 与复杂软件构建测试，未视为本区域赛测试范围。

## 2026-11-11：用户明确继续当前功能挑战项目

用户答复“OS 区域赛功能挑战（当前内存工具项目）”。对应赛制分析见 [PROJ5_COMPETITION_ANALYSIS.md](PROJ5_COMPETITION_ANALYSIS.md)，内核赛研究降为备查，未换题。

- 实际复读第 5 题完整弹窗：命名日期 2026-10-17；任一课程方向即可，允许真实或模拟环境，鼓励机制观测、教学难点解析、工具复用；四项要点为功能、特色创新、教学实践价值、文档，未给四项比例。
- 官网“选题与提交”实际读到：平台选题后自动创建 GitLab 项目、HTTPS 推拉；完整代码与文档、功能／性能／创新分析、类似项目对比、研发与 AI 记录、网盘视频链接。没有套用内核赛 Docker 或官方内核测试要求。
- 重新读取本地原课程 maps.c、malloc.c、demand.c，路径见分析文档。原课例用 malloc，当前工具用受控 mmap，课程联系仍需补齐。1037.wiki 本轮超时，GitHub HUST PKE 正文在线获取失败；未称本轮读到这些在线报告。
- 只读检查历史 20261110T103503.315280Z 报告及当前诊断／校验代码，确认 18 个案例自测通过、诊断分级及真实 THP 未生效样本缺口。读取 Linux 官方 proc 和 THP 文档。没有新增运行。
- 官网第 5 题选题数当时为 5，仅作为页面观测，不用于推算获奖概率、配额或最终竞争人数。

## 2026-11-11：v0.3 课程桥接的实际阅读

- 实际读取本地 `应用层实验-学生版/应用层实验文档.pdf` 物理页 10–12 的文字，以及 `代码包/lab3/lab3_2/malloc.c`、`代码包/lab3/lab3_3/demand.c` 全文。完整位置与改编对照见 COURSE.md；三个原文件 SHA256 位于 `output/verification/v0.3-course/course-source-hashes.json`，没有修改原件。尚未读取匹配的理论 PPT，不能编造章节页码。
- 按 HUST 课程偏好先检索 [1037.wiki](https://1037.wiki/) 和 GitHub HUST OS/malloc/demand 相关资料。本轮 1037 访问超时，尝试的 [HUST PKE lab2_3](https://github.com/CubeLander/hust-pke-docs/blob/main/lab/lab2_3.md) 正文未取得；搜索中取得的其他 PKE README 属于不同课例，未当作本 malloc/demand 实验报告，也未采用其代码或实验数字。
- 实际读取 [Linux malloc(3)](https://man7.org/linux/man-pages/man3/malloc.3.html) 的分配器说明，帮助区分库函数返回的空间与内核映射；未将某个常见阈值写成当前机器的必然边界。当前实际结论依据本工程保存的环境、地址、program break 与 smaps。
- 没有复制往届姓名学号、个人经历、测试结果或贡献；未联系作者、组委会或提交作品。

## 2026-11-11：将比较研究落到 v0.4

复用前次已实际阅读并固定哈希的 OS-Barrier、BirdOS、smem、memory-watcher 研究材料；没有凭仓库名新增“已读报告”声明。学生任务/参考解分离借鉴 [OS-Barrier 学生版](https://github.com/HarvestMoons/OS-Barrier/blob/f48439e37e326efd6ab2484db36f29419675bc1c/barrier_empty.c) 的组织方式，内存代码仍为本项目课例改编。阶段性反例与证据对应借鉴 BirdOS 文档的讲解方式，未把其内核赛成果当作当前赛题要求。

进程控制依据 [Linux PR_SET_THP_DISABLE](https://man7.org/linux/man-pages/man2/PR_SET_THP_DISABLE.2const.html) 和 [内核 THP 文档](https://docs.kernel.org/admin-guide/mm/transhuge.html)。采用 flags=0 的进程全禁用，并在本机 6.6 系列两环境真实验证；不依赖更新内核的例外模式。技术效果以本轮原始状态与 smaps 对照为证，不能由接口文档代替实验。

## 2026-11-12 课内实验重新核查

实际阅读全文：原实验 PDF 27 页、代码包 27 个文件、Downloads 中的应用层实验报告模板；检索并重点阅读第七章主存管理 115 页课件及第四章进程控制部分。模板逐项对应 24 个实验，每项三栏目。第七章关键图页与实验第 11–12 页已渲染核查。资料路径、版本和完整课程对照见 COURSE_REVIEW_20261112.md；原件哈希与文字副本保存在 `output/research/course-reread-20261112/`。这项更新纠正此前未找到模板、理论页码未核对的状态，不改写此前运行记录。

先查询 [1037.wiki](https://1037.wiki/)（超时）和 GitHub。实际读取 [Wd1335032864/HUST-OS-Lab README](https://github.com/Wd1335032864/HUST-OS-Lab)，属于另一套 RISC-V PKE 内核课例；chapter4_memory.md 正文未获取成功，未声称已读报告，未用作本套应用层实验要求。未找到与当前 24 项完全对应的可核实往届完整报告。

补充核对 [Linux 6.6 proc 文档](https://docs.kernel.org/6.6/filesystems/proc.html)、[malloc](https://man7.org/linux/man-pages/man3/malloc.3.html)、[getrusage](https://man7.org/linux/man-pages/man2/getrusage.2.html) 以及 [上游 Linux v6.6 mm_types.h](https://github.com/torvalds/linux/blob/v6.6/include/linux/mm_types.h)。用于说明整映射统计、分配器与系统调用的区别、缺页是否涉及 I/O，以及课件旧链表结构与 6.6 上游定义的版本差异；不代替 openEuler 实际运行或发行版补丁审计。

## 2026-11-13 v0.5 地址任务与团队资料

- 先检索 [1037.wiki](https://1037.wiki/) 与 GitHub。1037 返回站点界面，未取得匹配课程正文；[Wd1335032864/HUST-OS-Lab](https://github.com/Wd1335032864/HUST-OS-Lab) 的 README 属于另一套 PKE 课例。未将这些仓库称为已读的当前课例完整报告，也未采用往届运行数据。
- 当前 3.1 依据仍为已提取的原 maps.c 和课程材料，记录在 `output/research/course-reread-20261112/code-all.txt`；原程序打印 PID 后暂停。新探针增加自行保存七类地址、完整 smaps 和加载后的程序头，改编范围见 COURSE.md 与地址任务单。
- 实际阅读 [dl_iterate_phdr](https://man7.org/linux/man-pages/man3/dl_iterate_phdr.3.html)、[proc_pid_maps](https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html)、[ELF](https://man7.org/linux/man-pages/man5/elf.5.html)，用于定义装载基址、PT_LOAD、映射权限与文件偏移；结论仍以保存的真实实验记录为准。
- 官方技术讨论 QQ 群 **1043068079** 取自 `outputs/2026操作系统中西部华南区域赛-技术方案.pdf` 第 3 页。本轮复核原文，官网与赛题入口见 TEAM_BRIEF.md。没有申请加群或发送消息。
# 2026-11-16 缴费条款复核

实际查看本地 `outputs/2026操作系统中西部华南区域赛-章程.pdf` 物理第 4 页“4.4 参赛费用”：中西部与华南区域赛不收报名费、参赛费、评审费、技术平台购买费等费用；参赛队员和指导老师交通、住宿、用餐等费用自理。该章程共同覆盖 OS 内核实现、OS 功能挑战两个赛道。

同时检索[官方平台的区域赛章程页面](https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=z0ZUSt-KKQQ&doVisit=true&my=false)，搜索返回的完整章程与本地费用条款一致；直接打开动态页面时仅得到比赛概要，因此具体逐字核查依据为本地章程页面。未使用全国赛、其他区域赛或其他赛事的收费标准。

## 2026-11-16 v0.6.1 连续 malloc 与调用证据

- 沿用 NATIONAL_REFERENCE_STUDY_20261116.md 对 F-Tutorials、RRAM、MIAYC 的原始材料研究，以及此前 1037/GitHub 课程资料检索；当前任务仍以已核对的华科 lab3_2/malloc.c 为准。
- 本轮实际读取 [strace 项目官网](https://strace.io/)、[strace 手册](https://man7.org/linux/man-pages/man1/strace.1.html)、[malloc 手册](https://man7.org/linux/man-pages/man3/malloc.3.html)。用于选择调用过滤、保留参数与返回值、区分 C 库接口与内核接口；不将文档中的一般行为当作本轮运行结果。
- 实际调用关系、相交映射及环境版本以 V06_SEQUENCE_20261116.md 指向的六项新实验原文为依据；第三方项目未执行。

## 2026-11-16 第4组

依据当期应用层实验文档物理12—16页和lab4五份原骨架。先检索GitHub与1037.wiki；1037请求超时，未取得同版完整历史实现。实际读取[pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)及[swapcontext(3)](https://man7.org/linux/man-pages/man3/swapcontext.3.html)，核对管道端点语义、独立栈与上下文返回。来源阅读与本轮真实结果详见GROUP4_COMPLETION_20261116.md。

## 2026-11-16 第1、2组

按要求先查GitHub/1037，1037超时；读取lyf1984/HUST_OS_LAB的README，属于不同课例。当前1—9页指导书与原代码为实施依据。实际克隆并读取openEuler社区README、CONTRIBUTING、AGENTS、LICENSE、iSulad SIG；浏览AtomGit issue 1422、PR 7765及实际diff；阅读isula-build官方用法和Git补丁文档。可定位链接、观察范围与本轮失败/成功记录见[第1、2组完成记录](GROUP12_COMPLETION_20261116.md)。
