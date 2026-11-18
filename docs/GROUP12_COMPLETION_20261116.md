# 第1、2组补齐与实际运行记录

核对日期：2026-11-16。目标为11月18日可能进行的验收；老师未指定范围，先准备第1、2组，已有第3、4组作为后续。六项基础实验已实跑并保存证据，个人练习、正式报告及教师验收另行记录。

## 直接使用

在项目根目录PowerShell运行 `./work/course-labs/group12/demo.ps1 status`，再依次运行同一入口的 `basics`、`git`、`container`。详细命令与六项思考题参考见[第1、2组演示说明](../work/course-labs/group12/README.md)。`linkage`另跑容器中的能力赛COW探针；`shell`进入普通用户登录终端。

## 逐项结果

| 项目及原文位置 | 本轮已完成 | 保存位置（相对本轮审计目录） |
|---|---|---|
| 1.1，第1—3页 | openEuler 24.03 LTS；创建并使用普通用户oslab，UID 1000；环境、目录、复制/移动/删除、chmod 644、ps/top均检查 | basics/20261116T094441-4025/ |
| 1.2，第3—4页 | 原hello.c分别预处理、生成汇编、生成目标文件、链接并运行；file/ldd检查动态链接 | 同上，hello.i/s/o、hello-output.txt、file.txt、ldd.txt |
| 1.3，第4—6页 | 阅读社区/SIG/README/issue/PR；克隆、分支、自己的练习文件、提交、两种补丁；两个干净副本恢复完整Git树一致 | git/；git-demo-entry.log；sig-read.log；community/ |
| 2.1，第6—7页 | strace跟踪echo和hello；逐项定位execve/openat/read/write/mmap并保存注释 | basics目录的echo.strace、hello.strace及summary.json |
| 2.2，第7—8页 | 原zero.c用默认未优化编译，直接执行及strace均观察SIGFPE 8；新增非法指针拓展均观察SIGSEGV 11 | basics目录的zero.strace、invalid_pointer.strace及summary.json |
| 2.3，第8—9页 | 安装并启用iSulad/isula-build；原Dockerfile构建成功、原hello退出0；容器内重新编译运行，核对宿主PID、命名空间、内核和cgroup | guest/container/results/；container-linkage-entry.log；status-entry.log |

本轮审计目录为 `output/verification/group12-20261116/`；机器可读汇总为 `audit.json`。原29份课程材料哈希一致，能力赛57份运行源码与此次容器快照一致。本轮没有修改既有VMObserve核心实现，版本仍为0.7.0；此前60项测试结果保持历史含义。

## Git的具体证据

- AtomGit克隆返回HTTP 418，随后成功克隆公开GitHub镜像 `openeuler-mirror/community`；真实issue和PR仍在AtomGit页面读取。
- 基线提交：`30324d6b24bef17f6accf2fdcec7c3d081276595`。
- 本地分支：`lab-patch`；本次练习提交：`19dd41ac89e3ee4cc1560c5be70ffa776b651d1d`，只增加17行 `oslab-practice.md`。
- 提交身份为 `OS Course Practice (AI-assisted) <oslab@localhost>`，含AI协作说明；没有使用用户姓名/邮箱，也没有推送或提交真实PR。
- `lab.patch`用git apply恢复；提交补丁用git am恢复。两者与目标提交的完整树均为 `8d6e0dfe7066b0cc7dd3d581f8cf1747fe7cf5c7`。
- 已通过Windows演示入口再次生成和应用两类补丁，结果目录 `git-results/20261116T100435-5892`。已有公开仓库副本保存在虚拟机中，演示无需联网。

## 容器的具体证据

宿主为openEuler 24.03 LTS，容器用户空间为原Dockerfile指定的22.03 LTS。两边 `uname -r` 均为 `6.6.0-28.0.0.34.oe2403.x86_64`。iSulad为2.1.5-18、isula-build为0.9.6-23；两个服务均active/enabled。

镜像为 `gcc-lab:course-20261116`，完整ID `d78e448681c2694474f03282d43b9cb1065d9c1b2954f011d016a6c673e9caea`，已留在虚拟机本地。原hello容器退出码0，输出 `Hello from iSulad Container!`。另一个观察容器在内部重新用GCC 10.3.1编译并运行同一源码。

观察记录 `observe-20261116T121414-6369`：容器内部PID 1对应宿主PID 6459；pid、mnt、uts、ipc、net五类命名空间均与宿主不同；宿主ps/status与inspect PID相符，cgroup位于 `/isulad/<容器ID>`。观察完成后执行stop，短时sleep容器被停止并记录退出137；这是演示收尾，原hello的正常退出仍为0。

第一次构建设600秒时限，GCC安装过程中被取消；第二次保持原Dockerfile和hello不变，放宽至1800秒后构建并导入iSulad成功。两份完整日志分别为 `build-original.log`、`build-original-retry.log`，不把失败尝试删掉。后天运行缓存镜像，无需现场重新下载构建。

## 与能力赛联动

直接复用VMObserve 0.7.0源码，在该容器中编译并执行16 MiB、64 MiB的基础COW案例，每种一次。运行ID `20261116T121454.736703Z`，两项均completed/passed/verified，执行上下文明确记为 `isulad-container-in-qemu-tcg`。容器Python为3.9.9，本次这条采集路径实际通过；工程通用依赖说明仍为Python 3.10+，未扩大兼容性承诺。

原始JSONL与smaps、源码快照、环境与报告都已保存；取回后用现有回放器重新校验，通过并导出HTML/JSON/CSV至 `competition-export/`。这些是容器中的机制与功能验证。网页原有执行器保持原样，容器联动通过本轮命令行入口运行。

## 社区阅读与来源

本轮先检索GitHub与[1037.wiki](https://1037.wiki/)；1037访问超时，实际读取[HUST_OS_LAB的README](https://github.com/lyf1984/HUST_OS_LAB)，属于另一套NASM/内核课例，未套用为当前任务要求。当前实现以27页应用层实验指导书第1—9页及原代码为准。

- [openEuler社区入口](https://www.openeuler.org/zh/)与[SIG列表](https://www.openeuler.org/zh/sig/sig-list/)：了解社区、文档和项目组织。克隆仓库中实际读取 `sig/iSulad/README.md`，该SIG负责容器引擎技术决策、软件包维护与用户反馈，项目含iSulad/lcr/clibcni/isula-build。
- [社区仓库README](https://github.com/openeuler-mirror/community/blob/30324d6b24bef17f6accf2fdcec7c3d081276595/README_cn.md)及CONTRIBUTING、AGENTS、LICENSE已保存于git证据目录。
- [issue 1422](https://atomgit.com/openeuler/community/issues/1422)：贡献指南问题模板出现重复问题，是问题报告实例。
- [PR 7765](https://atomgit.com/openeuler/community/pull/7765)及[实际差异](https://atomgit.com/openeuler/community/pull/7765/diffs)：观察来源分支到master的请求、提交/文件、讨论与检查；实际差异为 `sig/ai/sig-info.yaml` 增加5行维护者信息。这是他人的公开记录。
- [isula-build官方用法](https://docs.openeuler.org/en/docs/24.03_LTS/docs/Container/isula-build_user_guide.html)、[Git format-patch](https://git-scm.com/docs/git-format-patch)、[git am](https://git-scm.com/docs/git-am)：用于核对构建出口与补丁语义。

合并便携资料包为 `output/acceptance-20261118/os-lab-groups1-4-20261118.zip`，原第4组便携包保留。完整虚拟机和803 MiB容器镜像留在本机，不装入小型资料包。
