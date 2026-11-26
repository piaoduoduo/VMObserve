# 队友从这里开始

本页用于同步选题、代码和文档分工。更新于 2026-11-26。下面的分工供三人在群里认领。

## 这轮谁改哪一块

11 月 25 日发布的主线是 [`7732437`](https://github.com/piaoduoduo/VMObserve/commit/7732437fa8d3dd2e32892ce2faffda0cb71c9ebf)。当天晚上，`cdh_version` 新增的 7 个提交（至 [`b89ca75`](https://github.com/piaoduoduo/VMObserve/compare/3c2edf2..b89ca75)）已在本地完成合入（`09b8c1c`）并补齐边界修复与全量验证，待同步推送主线。

| 成员 | Git 上能对到的工作 | 建议这轮负责的文档和小任务 |
| --- | --- | --- |
| 岑栋海（haaland0325） | 3.2 地址与 RSS 自测、3.3 大页对照和学习笔记。晚间分支又加入首次作答记录与进程禁用大页的对照。 | [实验数据](FOCUS_BASELINE.md)和[学生试用单](FOCUS_TRIAL.md)。可以先请一位没用过实验台的同学做一道题，记下他的依据，以及哪里需要提示。 |
| 丁俊文（FoggyCry） | [环境自检提交](https://github.com/piaoduoduo/VMObserve/commit/fe52ac87c187be6cab26e24a8815027e603c9971)已进主线，代码在 [doctor 模块](../work/vmobserve/doctor/)。 | [环境自检与复现](ENVIRONMENT_DOCTOR.md)。有空时从自己电脑的新目录按 README 启动一次，记下版本、命令和能否打开 3.2。先做内置样例回放即可。 |
| 队长（piaoduoduo） | 主线集成、3.2 报告取数修复、3.3 笔记回跳修复。 | [技术总报告](FOCUS_TECHNICAL_REPORT.md)和[整体验证记录](VERIFICATION.md)。汇总前两块内容，维护共用后端与导出接口，处理分支重叠的文件。 |

新任务从最新 `main` 开分支。现有工作保留在原分支，需要一起改同一个文件时，先在群里说一声。交付时发提交链接和一句验证结果即可。

已有[模拟评委量表](COMPETITION_JUDGE.md)，覆盖功能、特色、教学和文档，并已同步最新复评记录与扣分依据。下一轮可以沿用这张表，在合并后的同一版本上复评。

## 我们参加什么

- 队名：**怎么分都队**。
- 比赛：[2026 年操作系统设计赛中西部与华南区域赛](https://os.educg.net/#/index?TYPE=26OS_ZXHNF)。
- 赛道：**OS 功能挑战**；主选[第 5 题“课程实践案例”](https://os.educg.net/#/sList?TYPE=26OS_ZXHNF)。
- 项目名为 **VMObserve · 重点任务可视化实验台**。主案例用华科 OS 课内的两项实验解释虚拟内存的申请和写入。
- 当前提交目标日期：2026-12-27。官方技术讨论 QQ 群：**1043068079**（来源为已核对的比赛技术方案；这是官方讨论群）。
- 代码及更新入口：[piaoduoduo/VMObserve](https://github.com/piaoduoduo/VMObserve)。

第 4 题多智能体协作、第 6 题 xv6 功能扩展仍是研究备选，当前开发集中在第 5 题。

## 目前已经做到哪里

首页介绍实验台的用法。从侧栏选 3.2 看三次 malloc，再选 3.3 看 512 MiB 内存从申请到释放的六次采样。点圆形步骤可以跳到任一阶段，复制链接可以让队友打开同一步。全部 24 项课程实验收在侧栏「原始证据」下方的「完整课程目录」。

- 内存主线：程序地址与映射、连续三次 malloc 与系统调用、按需调页、fork 写时复制、透明大页对照。
- 课程配套：静态/动态链接、栈增长/溢出，以及第 4 组进程、线程、管道、互斥与同步实验。
- 工具：C 实验程序、Python 采集与校验、本地交互网页、历史回放及 HTML/JSON/CSV 导出。
- 验证记录：连续 malloc 在 WSL/openEuler 各 3 次通过，第 4 组各 42 次通过；v0.7.1 的 63 项自动检查通过。运行记录与测试来源见[验证记录](VERIFICATION.md)。

实际学习者试用、个人机制解释、教师验收与正式参赛报告仍需完成。QEMU 软件模拟的记录用于机制和功能验证。

## 先查看，不必配置虚拟机

直接在 GitHub 阅读[项目说明](../README.md)、[课程阅读指南](COURSE.md)、[连续 malloc 任务单](../work/lessons/sequence/WORKSHEET.md)。源码在 `work/`，网页源码在 `work/vmobserve/web/`，测试在 `tests/`。

想在自己电脑查看交互页面，先安装 Python 3.10+ 和 Git。在 PowerShell、终端中依次运行：

```sh
git clone https://github.com/piaoduoduo/VMObserve.git
cd VMObserve
python work/launch.py --executor local
```

打开 [3.2 连续三次 malloc](http://127.0.0.1:8765/labs/3.2)，从回放里找出三次申请的差别。看历史记录可以离线完成，点采集按钮后才会启动新实验。[十分钟试用单](V071_CLASSROOM.md#首次独立试用)可用于记录实际体验。

如果首页仍是旧版「程序地址与映射」，先核对拿到的版本；v0.7.0 只有旧版基础和大页夹具，不能直接回放这份新样例。

`127.0.0.1` 指自己的电脑。仓库提供网页源码及本地运行方式，没有托管一个公共在线实验服务。只查看旧记录不需要 Linux；Windows 上直接点击真实运行会提示环境不支持。

## 在自己的 Linux 上运行新实验

需要 Python 3.10+、GCC；连续 malloc 还需要 strace。完整第 3 组还使用 file、ldd、readelf 与静态 libc 开发文件。依赖说明见[运行说明](../work/RUNNER.md)。

```sh
python3 work/run_all.py --suite sequence
python3 work/launch.py --executor local
```

随后刷新网页，查看新记录。也可使用 `--suite layout`、`--suite course`，或 `--suite group4 --group4-task 4.1 --timeout 120`。每轮数据独立保存。

仓库里的 `work/vm.ps1` 和 openEuler 脚本供原开发机复用既有虚拟机。仓库没有附带镜像、SSH 密钥或报名资料；新电脑先用自己的 Linux 环境运行即可。

## 怎样更新代码和文档

任何人都可以查看和下载；直接写入需要收到并接受协作邀请。尚未接受邀请的队友，注册账号后可以先通过 Fork 提交改动：

1. 打开仓库，点击 **Fork**，复制到自己的 GitHub 账号。
2. 克隆自己的 Fork。下面的 `<你的用户名>` 需要替换为实际用户名：

```sh
git clone https://github.com/<你的用户名>/VMObserve.git
cd VMObserve
git remote add upstream https://github.com/piaoduoduo/VMObserve.git
git switch -c feat/说明这次改动
```

3. 修改后查看差异，只提交本次相关文件。例如只改任务说明：

```sh
git diff
git add docs/TEAM_README.md
git commit -m "完善队友使用说明"
git push -u origin HEAD
```

4. 回到自己的 GitHub Fork，点击 **Compare & pull request**，目标选择 `piaoduoduo/VMObserve` 的 `main`。写清改了什么、怎么验证，由项目仓库审阅合并。

之后开始一项新改动前，保持工作区已提交或无改动，再同步最新主线：

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c feat/下一项改动
```

把 GitHub 用户名发给队长，收到邀请后登录该账号打开[仓库邀请页](https://github.com/piaoduoduo/VMObserve/invitations)并接受。之后可以直接克隆项目仓库，在自己的分支推送，再向 `main` 发 Pull Request，无需 Fork。邀请尚未接受时，直接推送可能提示没有权限。

## 提交时保留哪些信息

- 代码改动：运行 `python -m unittest discover -s tests -v`，写明测试结果；涉及 Linux 行为时再记录实际运行环境和新实验 ID。
- 文档改动：核对来源与实现，不把历史回放、合成测试或建议安排写成自己完成的实验。
- 新问题：在 [Issues](https://github.com/piaoduoduo/VMObserve/issues) 写复现步骤、环境和错误；不要贴账号凭据、证件、联系方式或报名文件。
- 原始实验记录、私钥、虚拟机镜像和临时截图保留本地，按现有忽略规则处理。不要覆盖已有实验目录。

项目最新进展见[接手说明](HANDOFF.md)。旧的 [TEAM_BRIEF](TEAM_BRIEF.md) 保留了早期备选研究和未认领的分工草案，当前队友上手以本 README 为准。
