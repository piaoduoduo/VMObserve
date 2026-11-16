# 队友从这里开始

本页用于同步选题、当前进度和协作方法，暂不安排分工。更新于 2026-11-16。

## 我们参加什么

- 队名：**怎么分都队**。
- 比赛：[2026 年操作系统设计赛中西部与华南区域赛](https://os.educg.net/#/index?TYPE=26OS_ZXHNF)。
- 赛道：**OS 功能挑战**；主选[第 5 题“课程实践案例”](https://os.educg.net/#/sList?TYPE=26OS_ZXHNF)。
- 项目：**VMObserve——虚拟内存实验观察与诊断工具**，基于华科 OS 课内实验，把程序动作、真实观测、解释和复验联系起来。
- 当前提交目标日期：2026-12-27。官方技术讨论 QQ 群：**1043068079**（来源为已核对的比赛技术方案；这是官方讨论群）。
- 代码及更新入口：[piaoduoduo/VMObserve](https://github.com/piaoduoduo/VMObserve)。

第 4 题多智能体协作、第 6 题 xv6 功能扩展仍是研究备选，当前开发集中在第 5 题。

## 目前已经做到哪里

当前代码版本为 **v0.7.0**：

- 内存主线：程序地址与映射、连续三次 malloc 与系统调用、按需调页、fork 写时复制、透明大页对照。
- 课程配套：静态/动态链接、栈增长/溢出，以及第 4 组进程、线程、管道、互斥与同步实验。
- 工具：C 实验程序、Python 采集与校验、本地交互网页、历史回放及 HTML/JSON/CSV 导出。
- 验证记录：连续 malloc 在 WSL/openEuler 各 3 次通过，第 4 组各 42 次通过；发布前当前版本 60 项自动检查通过。运行记录与测试来源见[验证记录](VERIFICATION.md)。

实际学习者试用、个人机制解释、教师验收与正式参赛报告仍需完成。QEMU 软件模拟的记录用于机制和功能验证。

## 先查看，不必配置虚拟机

直接在 GitHub 阅读[项目说明](../README.md)、[课程阅读指南](COURSE.md)、[连续 malloc 任务单](../work/lessons/sequence/WORKSHEET.md)。源码在 `work/`，网页源码在 `work/vmobserve/web/`，测试在 `tests/`。

想在自己电脑查看交互页面，先安装 Python 3.10+ 和 Git。在 PowerShell、终端中依次运行：

```sh
git clone https://github.com/piaoduoduo/VMObserve.git
cd VMObserve
python -c "import shutil; shutil.copytree('tests/fixtures/legacy-run', 'work/runs/example-legacy')"
python work/launch.py --executor local
```

然后打开 **http://127.0.0.1:8765**，选择左侧示例记录，再切换到“按需分配与写时复制”或“透明大页对照”。第三条命令只需执行一次；目标目录已存在时不用再次复制。Linux 上如没有 `python` 命令，使用 `python3`。

示例是仓库内置的 **18 项真实历史记录**，页面会标为旧格式，来源校验显示 `legacy_partial`；它不是新运行，也不是模拟数据。它不含最新的连续 malloc 和第 4 组历史；这些功能的代码及任务单已在仓库，完整开发机实验档案仍保存在本地。选择其他主题时显示“本轮没有该实验”是正常情况。

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
