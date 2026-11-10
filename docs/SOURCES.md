# 来源与阅读记录

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
