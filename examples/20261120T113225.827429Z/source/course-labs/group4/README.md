# 第4组独立演示程序

依据当期应用层指导书12—16页和五份教学骨架完成，原材料只读保留。需要Linux、GCC、Python3、ps和timeout；不需要make或网页。

```bash
bash demo.sh 4.1  # fork、exec成功/失败、waitpid
bash demo.sh 4.2  # 两个pthread：无锁观察与互斥保护
bash demo.sh 4.3  # 三个用户线程轮转、阻塞影响
bash demo.sh 4.4  # 管道关闭端点、共享账户和条件变量
bash demo.sh all # 全部14种配置各运行一次
```

脚本先编译6个程序，再显示中文事件说明；JSONL原文及ps、/proc观察另存到results下的独立时间目录。手动编译命令在build.sh；可以单独打开lab4_1—lab4_4中的源文件讲解。fork_exec_wait需传入child_prog路径，例：`.build/fork_exec_wait .build/child_prog normal`。

1. fork：父进程值7，子进程改为99；相同虚拟地址分别属于不同进程。exec成功后PID不变、程序名称变为child_prog、退出码7；失败示例为ENOENT/127。
2. pthread：同PID和共享地址，不同内核TID和栈；每个线程加一百万次，加锁版应为2000000。无锁版故意有C数据竞争，volatile不是锁，结果偶尔正确也不能说明同步正确。
3. ucontext：三份独立栈，同一内核TID，0→1→2轮流各运行三步；结束返回调度器。阻塞案例在用户线程0中等待约200ms，其他用户线程期间也不能推进。轮转是本次实现的明确策略，原骨架每次从0找READY并不自动轮转。
4. 管道：完整传递26字节；全部写端关闭后read为0；空管道且仍有写端的非阻塞读取为EAGAIN；忽略SIGPIPE时write返回EPIPE，默认处理时子进程由信号13终止。
5. 账户：加锁存款为100000；两个取款先等余额，存入200后30+200−80−50=100；60次双账户转账按账户ID升序加锁，总额3000，结束余额800/1150/1050。

此独立入口用于课堂演示；能力赛工程中`run_all.py --suite group4 --group4-task all`会额外保存源码哈希、环境、编译日志、校验和三格式导出。`--group4-task 4.1`可只运行当前验收项；默认每种配置重复3次，共42个案例。第4组与COW、共享地址和用户栈对应，未据此测量切换开销或物理页框。
