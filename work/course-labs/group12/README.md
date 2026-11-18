# 第1、2组：11月18日演示入口

在项目根目录的PowerShell运行。虚拟机已启动时直接用以下命令；重启电脑后先运行 `./work/vm.ps1 start` 和 `./work/vm.ps1 wait`。

```powershell
cd D:\Work\CodexWorkspace\2026-11-10\ba
# 查看普通用户、容器服务和已保存的镜像
./work/course-labs/group12/demo.ps1 status
# 1.1、1.2、2.1、2.2：普通用户操作、编译阶段、系统调用、异常
./work/course-labs/group12/demo.ps1 basics
# 1.3：查看练习提交，生成两类补丁，在两个干净副本中验证
./work/course-labs/group12/demo.ps1 git
# 2.3：使用本地镜像，容器内编译运行，宿主进程与命名空间观察
./work/course-labs/group12/demo.ps1 container
# 能力赛补充：同一容器内跑16/64 MiB的COW探针
./work/course-labs/group12/demo.ps1 linkage
# 需要手工输入课堂命令时，进入普通用户登录shell
./work/course-labs/group12/demo.ps1 shell
```

`basics`、`git`、`container`使用现有本地材料，不重新下载。输出路径会打印在末尾，每次新建目录；基础操作与Git使用普通用户oslab，容器管理使用虚拟机root。oslab未设置登录密码，通过现有SSH连接切换用户，不需要为演示修改账户权限。

## 文件与结果

- `basics/hello.c`、`basics/zero.c`、`container/Dockerfile`、`container/hello.c`与当期原包逐字节相同。
- `basics/invalid_pointer.c`为非法指针拓展示例；`run_basics.sh`完成实际命令和结果保存。
- `git_workflow.sh`保存首次创建分支、修改、提交、导出和验证的完整过程，只适用于首次准备。`git_demo.sh`可重复演示已有练习提交的补丁生成与应用。
- `container/observe_container.sh`可重复运行；`--linkage`复用已上传的能力赛源码包。
- `container/build_original.sh`是首次构建的过程记录。重建时建议按下面的原命令执行，避免重复使用已存在的演示容器名称。
- 容器现场演示从虚拟机管理员目录 /root/os-course/group12/container 运行；退出时停止本轮观察容器。宿主进程状态中的 NSpid 给出宿主 PID 与容器 PID 1 的对应。
- 普通用户材料在 `/home/oslab/os-course/group12-20261116`；宿主保存的日志与摘要在 `output/verification/group12-20261116/`。

## 1.3 Git要能指出的步骤

首次克隆的是公开镜像 `https://github.com/openeuler-mirror/community.git`，读取README、贡献指南和iSulad SIG说明；AtomGit克隆曾返回HTTP 418，已保留记录。练习分支为 `lab-patch`，只增加 `oslab-practice.md`，提交身份明确标为AI辅助的本地课程练习。

```bash
git switch -c lab-patch
# 编辑自己的练习文件后，新文件先加入意向索引，让diff能够看到
git add -N oslab-practice.md
git diff -- oslab-practice.md > ../lab.patch
git add oslab-practice.md
git commit -m 'docs: add local OS-course practice notes'
git format-patch -1 HEAD
```

先提交自己的修改再执行format-patch。普通补丁用 `git apply --check`、`git apply`；提交补丁用 `git am`。本次验证比较完整Git树，确认两种方式都恢复相同文件内容。真实issue/PR只作阅读，课程真实PR为选做。

## 2.3 构建与运行要能指出的步骤

```bash
# 在虚拟机管理员终端，进入已准备的课程目录
cd /root/os-course/group12/container
systemctl is-active isulad isula-build
cat Dockerfile
isula-build ctr-img build -f Dockerfile -o isulad:gcc-lab:course-20261116 .
isula images
isula run --rm gcc-lab:course-20261116
bash observe_container.sh
```

原Dockerfile保持22.03 LTS基础镜像，宿主为24.03 LTS。首次完整构建需要下载镜像、GCC并执行安装，QEMU软件模拟下耗时较长；第一次600秒超时中断的日志已保留，第二次放宽至1800秒后成功。后天使用已缓存的镜像即可，构建过程可查日志。

运行脚本额外启动一个短时容器，在里面再次用GCC编译hello。用inspect获得宿主PID，再读取宿主的ps、status、cgroup及命名空间，并与容器内部PID 1及uname比较。容器停止后保留inspect证据；共享内核和隔离要结合这些实际输出解释。

## 课堂思考题简要口径

| 实验 | 直接联系本次操作的解释 |
|---|---|
| 1.1 | 发行版包括内核、工具、库和软件包管理；内核管理CPU、内存、设备等资源。CLI便于脚本组合、自动执行和保存可复查的命令输出，AI也可调用这些接口。 |
| 1.2 | C源码经预处理、编译和汇编得到目标文件，再链接成可执行文件。本次file和ldd显示动态链接：运行时还需要动态链接器与共享库。 |
| 1.3 | issue描述问题、需求和复现方法；PR提交具体改动供审查合并。分支和提交历史帮助多人并行工作、追踪修改与恢复版本。 |
| 2.1 | 普通程序受权限和地址空间约束；需要文件、内存映射等内核服务时，通过系统调用进入内核执行检查和操作。普通函数调用一般仍在用户态；strace显示系统调用请求与返回，并非硬件特权级测量。 |
| 2.2 | 除零和非法地址访问由当前指令触发，属于同步异常。本次分别观察到SIGFPE和SIGSEGV；合法映射的按需缺页可能补页后重试，无法满足的非法访问通常终止。C语言未定义行为的结果与编译和运行条件有关，不能把这次信号固定到所有情况。 |
| 2.3 | 容器是宿主内核管理的隔离进程，命名空间隔离资源视图，控制组组织、统计或限制资源；容器运行时负责配置与管理这些机制。虚拟机运行自己的客户机内核，容器通常省去每实例内核启动的开销；本次没有开展性能比较。 |

这是演示和理解用的参考说明。个人练习、正式报告与教师验收按实际完成情况另行记录。
