# 11月18日操作系统实验验收速查

11月18日代码复查已完成。普通用户 GCC 演示依次使用 .i、.s、.o 生成下一阶段产物，运行后核对 hello 输出。容器通过宿主的 NSpid 和 cgroup 对应实际实例，中途失败会停止该容器。第3组校验 512 MiB 实验各阶段的分配地址，第4组直接记录 waitpid 返回的 PID。openEuler 第3组 8/8、第4组 14/14、容器 COW 2/2 均通过，本轮每种配置各跑一次。Git 两种补丁离线复测通过，另有 60 项自动检查通过。 [本轮复测记录](../output/verification/code-review-20261118/review.json) · [修订资料包](../output/acceptance-20261118/os-lab-groups1-4-20261118-reviewed.zip)

准备日期：2026-11-16。用户已更正为后天；老师未指定验收范围。按第1、2组优先，第3组、4.1/4.2随后，4.3/4.4备用的顺序准备，到老师要求的位置即可。下面是本机已验证入口，页码为27页《应用层实验文档.pdf》的物理页码。

## 先演示第1、2组

在项目根目录PowerShell运行：

```powershell
cd D:\Work\CodexWorkspace\2026-11-10\ba
./work/course-labs/group12/demo.ps1 status
./work/course-labs/group12/demo.ps1 basics
./work/course-labs/group12/demo.ps1 git
./work/course-labs/group12/demo.ps1 container
```

basics覆盖1.1/1.2/2.1/2.2；git覆盖1.3；container覆盖2.3。以上使用已保存的公开仓库与本地镜像，不需现场下载。需手工输入命令时用 `demo.ps1 shell`；能力赛容器联动用 `demo.ps1 linkage`。机器重启后先执行 `./work/vm.ps1 start`、`./work/vm.ps1 wait`。

优先看[第1、2组命令与思考题参考](../work/course-labs/group12/README.md)，对照[实际完成记录](GROUP12_COMPLETION_20261116.md)。普通用户权限演示显示644；原hello动态链接；除零和非法指针分别实测信号8/11；两类Git补丁完整树一致；容器原hello退出0，宿主PID与命名空间证据齐全。

## 第3、4组备用入口

在PowerShell运行：

```powershell
cd D:\Work\CodexWorkspace\2026-11-10\ba
.\work\vm.ps1 status
```

打开本轮已启动的[观察台](http://127.0.0.1:8766)。如重启电脑后网页未启动，在项目目录运行 `python work/launch.py --port 8766`；已有虚拟机需要启动时运行 `.\work\vm.ps1 start`，再运行 `.\work\vm.ps1 wait`。

- 先选“第3组完整实验”或“连续 malloc 与调用”，再在左侧选择相应历史记录。第3组完整记录是openEuler `20261116T083150.898289Z`；连续malloc专项是 `20261116T090129.522833Z`。
- 第4组选“第4组进程与线程”，左侧选择openEuler `20261116T092118.588077Z`。下拉框可回看每项输出；上方“运行所选实验”会在openEuler重新运行，4.1—4.3各6个重复案例，4.4为24个。
- 页顶“运行完整实验”保留能力赛原来的33个案例。要运行第4组，使用第4组页面自己的按钮。

不打开网页也可直接演示：

```powershell
# 两个进程：创建、执行另一程序、等待退出
wsl -d Ubuntu -- bash /mnt/d/Work/CodexWorkspace/2026-11-10/ba/work/course-labs/group4/demo.sh 4.1
# 两个工作线程：共享地址与无锁/加锁对照
wsl -d Ubuntu -- bash /mnt/d/Work/CodexWorkspace/2026-11-10/ba/work/course-labs/group4/demo.sh 4.2
# 若老师验收到后续部分，再运行
wsl -d Ubuntu -- bash /mnt/d/Work/CodexWorkspace/2026-11-10/ba/work/course-labs/group4/demo.sh 4.3
wsl -d Ubuntu -- bash /mnt/d/Work/CodexWorkspace/2026-11-10/ba/work/course-labs/group4/demo.sh 4.4
```

这里的命令运行WSL；课程默认openEuler的结果可通过网页查看或重新执行。openEuler命令行入口：`.\work\vm.ps1 retest --suite group4 --group4-task 4.1 --timeout 120`。

## 前面的内容先过一遍

| 顺序 | 对应材料 | 现在可展示什么 | 需要会解释什么 |
|---|---|---|---|
| 1 | 1.1，第1—3页；1.2，第3—4页 | 发行版/内核/CPU/内存/磁盘、目录权限、进程；原hello.c编译输出、file、ldd | 发行版与内核的区别；源程序经过编译得到可执行程序；动态链接依赖库 |
| 2 | 2.1，第6—7页；2.2，第7—8页 | hello的execve/openat/read/write/mmap记录；原zero.c在`-O0`下实际由SIGFPE终止 | 普通函数与系统调用的区别；异常由当前指令触发；本次信号8是实测结果 |
| 3 | 3.1—3.3，第9—12页 | 已完成的映射、动态/静态链接、连续分配、512 MiB分批访问、栈溢出 | 虚拟地址不等于物理地址；申请后不必立即全驻留；free不一定缩小堆；栈溢出与缺页按需分配不同 |
| 4 | 4.1—4.2，第12—14页 | 下面两项进程/线程演示 | 能指出代码中创建、等待、共享与加锁的位置 |
| 5 | 4.3—4.4，第14—16页 | 用户线程、管道、共享账户 | 老师进度到这里时再展开 |

第1、2组已在后续补齐，当前证据位于 `output/verification/group12-20261116/`。1.3对应第4—6页，展示分支、自己的练习提交、diff补丁及format-patch；2.3对应第8—9页，展示已缓存镜像、容器内编译输出与宿主进程观察。先前root基础预检保留为历史记录。

## 4.1：先讲这四句话

源码：`work/course-labs/group4/lab4_1/fork_exec_wait.c`、`child_prog.c`。

1. `fork()`在父进程返回子PID，在子进程返回0；两个执行流从fork后的代码继续。
2. 父子虚拟地址相同，子进程把值改成99，父进程仍为7，说明本例的私有变量各自独立。这个现象可衔接能力赛中的COW实验。
3. `exec`成功后PID不变，程序名称变成child_prog；成功时不会返回旧程序的后续语句。本轮正常子程序返回7。
4. 父进程用`waitpid`回收子进程，先判断正常退出还是信号终止，再读取退出码。找不到被执行程序时，本例记录ENOENT，并由子进程以127退出。

演示时指出“exec前/exec后”两行PID一致，以及“查看ps与内核观察”中的程序名称变化。程序用握手暂停在观察点，不需要抢时间打开ps。

## 4.2：只抓共享、线程身份、加锁

源码：`work/course-labs/group4/lab4_2/pthread_test.c`。

- 两个工作线程共享PID、全局变量地址和堆地址，内核TID与栈局部变量地址不同；包括主线程在内，观察到3个内核线程。
- 每个工作线程加一百万次，互斥版三轮均为2000000。`counter++`包含读、改、写，多个线程直接更新会产生数据竞争，`volatile`不提供互斥。
- openEuler无锁三轮为1230989、1400778、1601306。无锁结果随运行变化，不能预先写死。
- `pthread_create`创建线程，`pthread_join`等待完成；互斥锁围住每次更新。编译命令带`-pthread`。

如果问“线程是不是所有内容都共享”：地址空间共享，但每个线程有自己的执行上下文和栈；本例直接打印了共享地址与各自栈地址。

## 4.3—4.4备用说明

| 项目 | 本次可观察结果 | 最短解释 |
|---|---|---|
| 用户线程 | 3份1 MiB栈，0→1→2轮转各3步，内核TID相同 | 轮转是程序调度器显式选择；`yield`主动保存/切换上下文 |
| 阻塞 | 一个用户线程等待约200ms时，其他两个也未推进 | 三个用户线程共用一个内核线程，阻塞它就阻塞全部 |
| 管道 | 传完26字节；关完写端后read返回0 | 管道是字节流，读取边界不必等于写入边界；EOF取决于所有写端 |
| 非阻塞空管道 | 仍有写端时EAGAIN；关闭写端后为0 | 暂时无数据与没有后续写者是两种状态 |
| 无读端写入 | 忽略SIGPIPE得到EPIPE；默认处理由信号13终止 | 错误返回和信号处理要结合程序设置判断 |
| 条件变量 | 初值30，两次取款等待，存200后取80和50，剩100 | 在while中检查条件；wait释放互斥锁，唤醒后重新加锁并检查 |
| 转账 | 60次成功，最终800/1150/1050，总额3000 | 同时锁住涉及账户，并统一按账户ID顺序加锁，避免循环等待 |

账户无锁对照在openEuler出现100000、100000、76771；前两次碰巧正确仍有数据竞争。安全版均为100000。

## 携带包与自己练习

11月16日归档的便携包位于 `output/acceptance-20261118/os-lab-groups1-4-20261118.zip`，增加第1、2组源码、Git补丁、构建及容器观察日志、能力赛容器报告和本轮说明。镜像已缓存在本机虚拟机；包内包含的是源代码与证据，不能在新机器上代替完整环境。原包 `os-lab-ready-20261118.zip` 保留。含6份第4组C源码、公共头文件、构建/演示脚本、基础预检、实际输出和离线报告。解压后，在Linux终端进入文件夹：

```bash
bash basics/preflight.sh
bash group4/demo.sh 4.1
bash group4/demo.sh 4.2
# 需要时跑全部14种配置，每种一次
bash group4/demo.sh all
```

依赖GCC、Python3、ps、timeout；基础预检另需strace、file、ldd。脚本不联网安装。WSL下做chmod权限演示时，将解压文件夹放进Linux自己的目录，例如`~/os-lab-ready`；本轮直接在Windows挂载盘上测试时，chmod没有呈现Linux权限位，openEuler本地文件系统则显示了640。

建议本人先运行basics、git、container，能指出每步命令与对应现象；有时间再练第3组及4.1/4.2。当前保存的是AI实际运行与检查结果，教师验收、个人思考题和正式报告由后续真实记录补齐。
