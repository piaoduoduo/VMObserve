import { esc, state } from './ui.js';

const guides = {
  "1.1": [
    "确认 openEuler 与运行身份",
    "发行版名称、内核版本和用户身份分别由什么决定？",
    [
      "按顺序运行 id、uname -r、cat /etc/os-release，保存命令与输出。",
      "在自己的练习目录创建文件，再用 ls -l 核对属主、权限和路径。"
    ],
    "把 ID、内核版本与 os-release 的 PRETTY_NAME 分别圈出。",
    "对照历史摘录的来源、环境和命令，填写自己终端里的实际输出。",
    "在另一个可用用户终端重复 id 与文件属主检查，只改变登录身份。"
  ],
  "1.2": [
    "从源文件到可执行文件",
    "hello.o 能像 hello 一样直接运行吗？",
    [
      "依次用 gcc -E、-S、-c 生成预处理文件、汇编和目标文件，分别保存到自己的实验目录。",
      "链接目标文件生成程序，对两个 ELF 文件运行 file 与 readelf -h，再运行最终程序。"
    ],
    "比较 ELF Type、入口地址与程序输出，分清编译错误、链接错误和运行退出。",
    "保留每一步命令、返回码和 file/readelf 原文。",
    "只改变一个输出字符串，重新构建，核对新程序输出与改动一致。"
  ],
  "1.3": [
    "还原 Git 补丁",
    "同一改动用 git apply 和 git am 应用后，文件树与提交历史会如何变化？",
    [
      "在练习仓库记下起点提交，创建分支、修改一个文件并提交，用 format-patch 导出。",
      "从同一起点建立两个练习分支，分别应用补丁，检查状态和历史。"
    ],
    "比较 git diff、git log 与最终 tree，分别核对内容和提交元数据。",
    "保存起点提交号、补丁与应用日志。",
    "在干净起点再次应用，比较结果 tree。把重复应用的错误作为另一次记录保存。"
  ],
  "2.1": [
    "定位一次真实系统调用",
    "echo 输出文字时，哪条调用真正写入标准输出？",
    [
      "运行 strace 跟踪 /bin/echo hello，保存标准输出和跟踪日志。",
      "依次寻找 execve、动态库打开、write 与退出事件。"
    ],
    "核对 write 的文件描述符、缓冲内容、请求字节数与返回字节数。",
    "用原始日志行号串起装入、输出、退出三个动作。",
    "只改输出文本，比较 write 的长度和输出内容。"
  ],
  "2.2": [
    "区分异常与终止信号",
    "无效指针与整数除零会收到相同信号吗？",
    [
      "分别编译课程异常程序，并记录编译选项。",
      "每个程序独立运行，用 strace 保存异常与退出结果。"
    ],
    "看实际的 SIGSEGV、SIGFPE 或其他结果，结合对应的出错语句解释。",
    "保留终止日志和进程退出状态。编译器优化会影响未定义行为的表现。",
    "只改变编译优化选项重跑，记录信号是否一致及能支持的解释。"
  ],
  "2.3": [
    "对照容器内外的进程",
    "容器里的 PID 与宿主 PID、内核版本有什么关系？",
    [
      "在配置好的课程容器运行时构建镜像并运行 hello，保存镜像标识和输出。",
      "容器内运行 id、uname 与进程查询，在宿主定位同一进程。"
    ],
    "对照 PID、命名空间标识和内核版本，指出每行来自哪一侧。",
    "保存容器构建日志与两侧进程观察。",
    "保持镜像不变，重建一个容器，比较隔离标识和内核版本。"
  ],
  "layout": [
    "七类地址与真实映射",
    "先为函数、常量、全局变量、堆、栈预测 r/w/x 权限。",
    [
      "展开地址分布，选择程序函数和栈变量，逐项核对所在区间。",
      "再展开装载段，比较装载基址、段虚拟地址和映射范围。"
    ],
    "用 start ≤ address < end 核对地址归属，观察跨映射的 PT_LOAD 与 BSS 尾部。",
    "在 JSONL 找对象地址，在同一进程 smaps 找对应映射头与权限。",
    "切换独立运行，记录绝对地址是否变化、归属和权限是否稳定。"
  ],
  "link": [
    "静态与动态链接",
    "两种构建的解释器、共享库依赖和运行时映射会怎样变化？",
    [
      "选择同轮动态链接案例，读 file、readelf 和实际映射。",
      "切换到同轮静态链接案例，按相同字段逐项比较。"
    ],
    "把 INTERP、DT_NEEDED、程序地址和库路径对应起来，保留各自编译参数。",
    "readelf 证明文件中的段和依赖，smaps 证明当次运行时存在的映射。",
    "重新构建并独立运行一轮，比较相同构建方式的地址与装载归属。"
  ],
  "sequence": [
    "连续三次 malloc 与去重计账",
    "三块申请需要几段映射？申请字节数与 RSS 会相等吗？",
    [
      "从申请前回放到第三次申请，每一步核对新增块、返回指针和相关映射。",
      "对照第三次申请前后，再看全部释放后的旧地址范围。"
    ],
    "分开记录存活块申请量、VMA 数量和整段 RSS，同一 VMA 只加一次。",
    "打开当前动作 strace，核对 mmap/brk 返回值，再在 smaps 找同一地址区间。",
    "换一次运行或环境，逐步比较调用与映射。没有新增调用时，只确认本次窗口里的观测。"
  ],
  "demand512": [
    "512 MiB 按需调页",
    "申请完成尚未写入时，RSS 会立即接近 512 MiB 吗？",
    [
      "依次看申请前、申请后、写到 1/4、1/2、全部和释放后的六个阶段。",
      "每批按 4 KiB 间隔写一个字节，核对累计写入位置与读回检查。"
    ],
    "比较每步 RSS、次缺页增量和 AnonHugePages，解释与上一阶段的差值。",
    "JSONL 核对动作与计数，smaps 核对驻留。另看五次 ps 的整进程统计口径。",
    "在条件一致的新轮次重复，再与小尺寸入门课例比较。解释页粒度与统计范围。"
  ],
  "course": [
    "单块申请与首次访问",
    "1 KiB 和 16 MiB 在首次写入与 free 后会表现相同吗？",
    [
      "先选择 16 MiB，回放六步并记下每步已写位置、RSS 与本步缺页。",
      "切到 1 KiB，按同样顺序比较申请后和释放后的映射。"
    ],
    "RSS 统计相交的整个映射，可能包含其他对象；次缺页属于进程。",
    "选择本步 JSONL 和 smaps，核对时间点、地址与读回值检查。",
    "只改变申请大小，保留写入规则，比较六步趋势并记录反例。"
  ],
  "stack": [
    "栈增长与受限终止",
    "正常递归与两种栈软限制能到达相同的采样深度吗？",
    [
      "选择正常返回组，查看递归前、增长和进程结束。",
      "切到同轮的受限组，对照软限制、最后一次完整采样与父进程等待结果。"
    ],
    "比较栈映射大小、RSS、局部变量地址方向和退出信号。",
    "smaps 证明采样时的 [stack]，outcome 证明子进程结束状态。",
    "只改变已有对照里的栈限制。最后采样深度与具体出错深度分别记录。"
  ],
  "g4-fork": [
    "fork、exec 与 wait",
    "exec 成功后 PID 会改变吗？失败后父进程收到什么结果？",
    [
      "沿 before_exec、after_exec 和父进程等待事件读取，标记父子 PID 与 PPID。",
      "切换 exec 失败组，查看 errno、子进程退出码及父进程获知的结果。"
    ],
    "分别核对私有变量、进程身份与程序替换前后事件。",
    "JSONL 对应事件顺序，kernel 记录核对进程身份；跨进程输出顺序需要结合同步点。",
    "固定父程序，只比较 exec 成功和目标不存在两组。"
  ],
  "g4-pthread": [
    "线程共享地址与计数",
    "全局、堆和线程栈地址中，哪些会相同？",
    [
      "选择 mutex 组，标记各工作线程的 PID、TID 和三类地址。",
      "切到 unsafe 组，比较最终计数、预期值及检查结果。"
    ],
    "同进程共享数据，工作线程保留各自栈；无锁偶尔得到正确值也需保留。",
    "用 worker_start 核对地址，用 summary/counter_result 核对最终值。",
    "同一模式重复三次，再只改变加锁方式比较。"
  ],
  "g4-uthread": [
    "用户线程切换与阻塞",
    "用户线程切换时内核 TID 是否也随之改变？",
    [
      "从 created、dispatch、step 到 finished，追踪线程编号和各自栈。",
      "切换 blocking 组，定位 block_begin 和 block_end 期间其他用户线程是否前进。"
    ],
    "用同一内核线程上的事件顺序解释协作调度和阻塞影响。",
    "核对内核 TID、用户线程号与相对时间，保留时间单位。",
    "保持工作量一致，比较主动轮转和阻塞两组，记录实际事件序列。"
  ],
  "g4-pipe": [
    "管道数据、EOF 与错误",
    "空管道什么时候返回 EOF，什么时候出现 EAGAIN？",
    [
      "先看 basic 的发送与接收，再分别切换 eof 与 eagain，核对端点是否仍打开。",
      "再看 epipe 与 sigpipe，比较写入无读端管道时的错误和终止。"
    ],
    "逐组记录读写字节数、errno、信号及字符串，结合端点存活状态解释。",
    "JSONL 定位 read/write 结果，kernel 观察核对进程；信号组结合等待结果。",
    "每次只改变读写端状态或 SIGPIPE 处理方式，比较原有模式。"
  ],
  "g4-bank": [
    "共享账户与条件同步",
    "只保护余额修改，能保证等待取款的线程在正确时机继续吗？",
    [
      "比较 comparison 的无锁与互斥结果。",
      "读 condition 的 waiting、deposited、withdrawn，再看 transfer 的账户与加锁顺序。"
    ],
    "核对余额、转账金额和总额，以及谓词满足后等待线程是否继续。",
    "从原始事件寻找等待与通知，结合每次加锁的账户编号核对顺序。",
    "固定工作量比较同步模式，记录最终不变量和实际事件顺序。"
  ],
  "5.1": [
    "单槽生产者与消费者",
    "只有互斥锁时，怎样避免覆盖尚未读取的数据？",
    [
      "读 empty/full 对应的等待与发布，按顺序观察放入和取出。",
      "核对 32 次交接、消费次数和顺序不一致次数。"
    ],
    "比较生产数量、消费数量和顺序，解释两个信号量各代表的条件。",
    "在 JSONL 核对三项原始计数及检查结果。",
    "重复同一配置；修改同步逻辑的练习请在课程工作副本保存单独记录。"
  ],
  "5.2": [
    "锁顺序与死锁条件",
    "两个线程各持一把锁时，试取第二把会发生什么？",
    [
      "先看反向持锁组的 trylock 返回值。",
      "再看统一顺序加锁组，核对完成双锁操作的线程数。"
    ],
    "把两个 EBUSY 与锁持有关系画出来，再解释同序加锁怎样消除环路。",
    "核对原始观测的 EBUSY 数和完成数。trylock 的受控冲突不能当作进程已永久挂死的证据。",
    "重复两组，保留加锁顺序和完成计数。"
  ],
  "5.3": [
    "release/acquire 发布数据",
    "读端看到了标志，凭什么能读取已经准备好的数据？",
    [
      "读端等待原子标志，写端先写数据再以 release 发布。",
      "读端用 acquire 看到标志后读取载荷，核对发布值与读取值。"
    ],
    "指出数据写入、标志发布、标志读取和数据读取的先后约束。",
    "在原始观测中找到发布值与读回值，并对照当前源码的内存序。",
    "重复运行，解释正确性依据来自同步规则与值校验的结合。"
  ],
  "6.1": [
    "文件读写与偏移共享",
    "dup 与再次 open 是否会共享同一文件偏移？",
    [
      "观察顺序写、定位覆盖和 O_APPEND 下的写入结果。",
      "再从 dup 描述符读取一个字节，比较原描述符和独立 open 的偏移。"
    ],
    "逐次写出文件内容，区分描述符编号与其引用的打开文件状态。",
    "JSONL 核对每次内容与偏移，结合实际调用参数解释。",
    "只改变定位位置或打开方式，另存一轮文件内容与偏移。"
  ],
  "6.2": [
    "硬链接、符号链接与 inode",
    "删除原路径后，两个链接分别还能读到什么？",
    [
      "比较原文件、硬链接和符号链接自身的 inode，再看链接数与权限。",
      "删除原路径后读硬链接，检查符号链接本身与其目标是否存在。"
    ],
    "区分路径名、inode 与符号链接保存的目标路径。",
    "原始记录核对 inode 数组、链接数、权限和删除后的读取结果。",
    "在练习目录仅改变删除的路径，观察剩余硬链接的读取行为。"
  ],
  "6.3": [
    "挂载信息与伪文件系统",
    "为什么 /proc 中的信息会随进程或内核状态改变？",
    [
      "对照 mountinfo 找根目录、/proc、/sys、/dev/shm 的文件系统。",
      "读取内核版本与回环接口类型，关联它们的挂载来源。"
    ],
    "分别记录普通文件系统、proc、sysfs、tmpfs 的观测。",
    "核对原始读取路径与值，保留当前环境。",
    "换一个可用环境比较挂载类型，只对观察到的差异作解释。"
  ],
  "7.1": [
    "字符设备的读写返回值",
    "读到 0 个字节与读到 8 个值为零的字节有什么区别？",
    [
      "核对 null、zero、random、urandom 的字符设备类型及主次设备号。",
      "对各设备请求读 8 字节，再向 null 写 4 字节。"
    ],
    "记录每次返回长度，分别解释 EOF、零填充和随机内容。",
    "核对原始观测中的长度、zero 字节串和写入返回值。",
    "只改请求长度，比较返回值；随机内容按当次读取记录。"
  ],
  "7.2": [
    "FIFO、非阻塞与 select",
    "写端关闭和写端仍在的空 FIFO，read 会如何返回？",
    [
      "先观察无写端，再建立写端但暂不写数据。",
      "比较写 A 前后的 select 就绪数，读取 A，再关闭最后一个写端。"
    ],
    "把 EOF、EAGAIN 和可读就绪对应到端点与缓冲区状态。",
    "逐项核对 read 字节数、errno、select 结果及收到的 A。",
    "保持非阻塞模式不变，只改变写端是否存在与是否写入。"
  ],
  "7.3": [
    "块设备与网络接口",
    "设备名、挂载点和网络计数分别来自哪里？",
    [
      "查看 lsblk 的设备类型与挂载关系。",
      "读取 sysfs 中的接口列表和回环接口收发字节计数。"
    ],
    "区分块设备、分区、挂载点和网络接口，标记采样时刻。",
    "核对 lsblk 摘录和 sysfs 路径，读取累计计数。",
    "间隔一段时间再次采样，记录变化；吞吐率计算需要实际时间差。"
  ],
  "7.4": [
    "内核模块加载与卸载",
    "初始化与退出日志分别会在什么时候出现？",
    [
      "准备课程虚拟机、匹配运行内核的开发包和编译器，阅读 init/exit 与 Makefile。",
      "编译模块，依次保存加载前、加载后、卸载后的模块列表和内核日志。"
    ],
    "把模块标识、当前内核和 init/exit 日志对应起来。",
    "本项目前是课程操作任务；需要自己补采命令返回值、模块列表和内核日志。",
    "在同一课程虚拟机重复一次加载与卸载，核对状态恢复与日志。"
  ],
  "7.5": [
    "用 eBPF 定位 openat",
    "怎样证明某条 openat 事件来自指定进程的一次打开操作？",
    [
      "在具备权限的课程实验环境准备 eBPF 工具链并挂接 openat 跟踪点。",
      "让已知 PID 打开已知路径，保存事件后退出跟踪程序。"
    ],
    "按 PID、路径、事件时间和调用返回结果关联一次操作。",
    "本项目前是课程操作任务；保存实际工具版本、挂接日志与事件输出。",
    "固定进程只改文件路径，再核对事件中的路径与调用结果。"
  ],
  "baseline": [
    "fork 与写时复制",
    "父子 RSS 都包含共享页时，直接相加会不会重复计账？",
    [
      "按顺序回放只读、部分写、全部写与 fork 后的父子快照。",
      "再看子进程按比例改写后，两边的 PSS 与页首值检查。"
    ],
    "父子在相同阶段配对，比较 PSS 合计与本轮改写页数；零改写组保留为共享对照。",
    "按 phase 与 role 在 smaps 找父子记录，JSONL 核对改写比例和隔离检查。",
    "固定大小比较 0、1/8、1/4、1/2、全部改写。计账与值隔离支持机制解释，未直接跟踪物理页框。"
  ],
  "thp": [
    "透明大页与受控对照",
    "同样数量的稀疏写入，关闭与请求大页的 RSS 会如何不同？",
    [
      "先核对区域大小、对齐、写入步长和次数，再看写入前后两组数据。",
      "读回核对后，另看进程允许/禁止对照，保持组内其余条件一致。"
    ],
    "区分 madvise 返回成功、进程允许状态和 AnonHugePages 实际驻留。",
    "JSONL 的 condition/values 与 smaps 的 RSS、AnonHugePages 共同核对。",
    "每次只改变大页建议或进程级允许状态，允许组没有大页时保留这次结果再取证。"
  ]
};

const labKeys = {
  '3.1': ['layout', 'link'], '3.2': ['sequence'], '3.3': ['demand512', 'stack'],
  '4.1': ['g4-fork'], '4.2': ['g4-pthread'], '4.3': ['g4-uthread'], '4.4': ['g4-pipe', 'g4-bank']
};

function guideHTML(key) {
  const guide = guides[key];
  if (!guide) return '';
  const [title, prediction, actions, observation, evidence, repeat] = guide;
  const steps = [
    ['先预测', esc(prediction)],
    ['按顺序操作', '<ol>' + actions.map(action => '<li>' + esc(action) + '</li>').join('') + '</ol>'],
    ['读哪些结果', esc(observation)],
    ['怎样核对原文', esc(evidence)],
    ['改变条件复验', esc(repeat)]
  ];
  return `<section class="experiment-guide" data-guide="${esc(key)}"><h3>${esc(title)}</h3>
    <dl>${steps.map(([label, text]) => `<div><dt>${label}</dt><dd>${text}</dd></div>`).join('')}</dl>
    <p class="detail-copy">完成后，留下自己的预测、一条带案例编号的原文证据，以及复验后得到的解释。</p></section>`;
}

export function renderLabFlow(id) {
  const keys = labKeys[id] || (guides[id] ? [id] : []);
  return keys.length ? `<details class="experiment-flow" open><summary>实验流程与核对清单</summary>
    ${keys.map(guideHTML).join('')}</details>` : '';
}

export function attachReplayFlow() {
  let cases = state.report?.cases || [];
  if (state.tab === 'group3') cases = cases.filter(c => ['link-dynamic', 'link-static', 'sequence', 'demand512', 'stack'].includes(c.suite));
  else if (state.tab === 'group4') cases = cases.filter(c => c.suite.startsWith('g4-'));
  else if (state.tab === 'systems') cases = cases.filter(c => ['sync', 'io'].includes(c.suite));
  else cases = cases.filter(c => c.suite === state.tab);
  if (state.tab === 'course') cases.sort((a, b) => b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  const selected = cases[state.selected];
  const key = state.tab === 'thp' ? 'thp'
    : selected?.suite.startsWith('link-') ? 'link'
    : selected?.parameters.lab || selected?.suite;
  const content = guideHTML(key);
  if (!content) return;
  const anchor = document.querySelector('#content .focus-intro, #content .course-intro');
  if (!anchor) return;
  const context = state.tab === 'thp' ? '核对当前选中的配对条件与轮次。'
    : selected ? `当前案例 ${selected.id} · 第 ${selected.parameters.repeat ?? 1} 次 · 检查 ${selected.validation?.status || '待核对'}` : '';
  anchor.insertAdjacentHTML('afterend', `<details class="experiment-flow"><summary>本实验的完整操作与核对流程</summary>
    <p class="detail-copy">${esc(context)}</p>${content}</details>`);
}
