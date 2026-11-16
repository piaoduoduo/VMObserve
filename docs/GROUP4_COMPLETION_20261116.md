# 第4组进程与线程：实现、联动与实测记录

2026-11-16，VMObserve v0.7.0。依据当期《应用层实验文档.pdf》物理12—16页及五份教学骨架完成4.1—4.4。原材料29份文件哈希保持不变；完成版另存 `work/course-labs/group4/`，新增缺失的child_prog.c。

## 完成范围

| 课程项 | 实现和对照 | 配置数×重复 | 与能力赛关联 |
|---|---|---:|---|
| 4.1 fork/exec/wait | 创建、父子私有值、exec前后身份、waitpid回收；exec成功和失败 | 2×3 | fork私有地址与既有COW课例衔接 |
| 4.2 pthread | 两工作线程各加1000000次；共享全局/堆、各自栈、PID/TID；无锁与mutex | 2×3 | 对照第3组的进程地址空间、线程栈 |
| 4.3 用户线程 | 3份1 MiB栈、getcontext/makecontext/swapcontext、yield和结束返回；轮转与单线程阻塞 | 2×3 | 显式展示用户态调度、栈及内核线程关系 |
| 4.4 管道 | 字符串传输、EOF、EAGAIN、EPIPE、默认SIGPIPE | 5×3 | 复用运行、原始事件、回放及导出链路 |
| 4.4 账户 | 无锁/互斥存款、余额条件等待与通知、按账户ID加锁转账 | 3×3 | 同一观察台保存同步行为及逐笔金额证据 |

合计是4项课程实验、14种配置、每环境42个重复/对照案例。5份原骨架对应6份完成版C文件；不是新增42项课程实验。课程要求中的PID/PPID、线程共享、条件变量、管道和转账均有实际输出。

## 两环境真实结果

| 环境 | 运行目录（相对项目根目录） | 结果 | 导出事件行数 |
|---|---|---|---:|
| WSL Ubuntu 22.04，GCC11.4 | `work/runs/20261116T091932.046340Z` | 42/42 completed、passed；完整性verified | 525 |
| openEuler24.03，GCC12.3.1，QEMU TCG2核2GiB | `work/openeuler-vm/guest-runs/20261116T092118.588077Z` | 42/42 completed、passed；完整性verified | 525 |

openEuler由网页“运行所选实验”真实触发，任务 `20261116T092105.320066Z`，传输目录 `work/openeuler-vm/transfers/20261116T092105-884/`。原始事件、内核status与ps输出、编译命令、退出状态、环境和57份源码哈希随每轮保存。

- fork正常退出码7，失败路径ENOENT/127；父进程值7、子进程值99。exec前后子PID不变，内核观察名称由g4-fork变为child_prog。
- pthread互斥计数两环境三轮均2000000。无锁WSL为1073467/1020925/1061091，openEuler为1230989/1400778/1601306。
- 用户线程各3步，顺序(0,1,2)重复3次，均返回调度器；3份栈范围互不重叠，只有1个内核TID。阻塞区间内无其他用户线程推进。
- 管道完整传输`Hello from Parent Process!`共26字节；EOF=0、EAGAIN=11、EPIPE=32、SIGPIPE=13分别实测。
- 账户安全存款均100000；条件等待后余额100；转账60次全部成功，最终800/1150/1050，总额3000。逐笔日志重新计算余额通过。
- 账户无锁WSL为67013/54836/81833；openEuler为100000/100000/76771。无锁程序故意保留C数据竞争；“passed”表示采集与预期故障示例检查完成，不把其计数认定为线程安全。

独立脚本另外在openEuler重新编译并运行14种配置一次，记录在 `output/verification/v0.7-group4/standalone-openeuler/`。便携包还在WSL Linux目录中解压、重新编译运行，最终核验索引见同目录 `delivery-audit.json`。

## 合并与验证

开发中发现能力赛另一个对话已完成v0.6.1连续malloc专项。本轮基于共同v0.6.0进行三方合并，保留其sequence模块、独立运行入口、动作标记、行号、映射去重、工具版本及7项测试；没有覆盖为旧版。新增group4模块、统一采集/回放/导出、页面与8项有意义的回归测试。

- 合并后60项自动检查通过；测试中的录制输入和故意篡改数据与新Linux实测分开计数。
- 旧第3组两轮24/24、连续malloc两轮3/3、v0.5两轮33/33只读回放通过，报告哈希未改写。
- 默认完整计划仍为33；第3组仍24；连续malloc独立计划仍3；第4组通过新suite和范围参数单独运行。
- 两轮新记录各导出HTML/JSON/CSV，CSV各525行；事件保留PID/TID、地址、值、信号与金额，不填造RSS/PSS。
- 网页实际展示fork与pthread地址表，能打开原始kernel观察，下载CSV与本地导出一致，SHA256为`874c99ac6e0547ec1355e14fb2655d47ebab143a0f3ba6e0c45d67ec1792db98`。截图见 `output/playwright/group4-completed.png`、`group4-pthread.png`。仅favicon请求404，无应用脚本错误。
- 综合索引：`output/verification/v0.7-group4/audit.json`、`delivery-audit.json`、`merged-tests.log`。

## 与教学骨架的必要差异

原骨架继续只读保留。完成版修复空参数、空条件、拼写、线程创建/回收和同步TODO；另补child_prog。参数选择各个演示，统一输出JSONL，演示脚本显示中文事件名。进程与pthread观察点用握手保留，避免靠sleep猜测ps采样时机。

用户线程明确实现轮转，原骨架每次从0扫描READY不自动轮转；新增200ms阻塞对照解释其与内核线程的区别。条件变量用“两个取款线程均已等待”的通知替换原2秒延时，其金额和等待语义保留。管道读取刻意采用小块，验证字节流拼接；默认SIGPIPE与忽略SIGPIPE在独立子进程中分别运行。

本轮验证进程、调度和同步机制；没有测量切换性能或物理页复制数量。教师验收、用户亲自练习与正式报告尚待完成。

## 复现与后天优先项

Linux：`python3 work/run_all.py --suite group4 --group4-task all --repeats 3 --timeout 120`。

PowerShell/openEuler：`.\work\vm.ps1 retest --suite group4 --group4-task 4.1 --timeout 120`。网页本轮入口 <http://127.0.0.1:8766>。

独立演示：`bash work/course-labs/group4/demo.sh 4.1`，可换4.2/4.3/4.4/all。不依赖make或网页。

[11月18日速查单](ACCEPTANCE_20261118.md)按基础工具、第3组、4.1、4.2优先安排。前序基础预检实际运行了环境/权限、原hello.c、strace与原zero.c，在两环境观察到SIGFPE；未把1.3 Git完整流程、2.3容器或普通用户操作标为完成。

## 来源

主要依据当期实验文档12—16页和原lab4五份源码。本轮按课程偏好先检索GitHub与[1037.wiki](https://1037.wiki/)；1037访问超时，GitHub未取得同版完整参考实现，不将检索线索当已读报告。

实际读取[Linux pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)核对字节流、EOF、非阻塞与SIGPIPE/EPIPE；读取[makecontext/swapcontext(3)](https://man7.org/linux/man-pages/man3/swapcontext.3.html)核对独立栈、uc_link和上下文切换。所有实验数值来自本轮运行，未使用他人的实验结果。
