# 任务一：申请内存，何时真正用到物理页？

建议用 20–30 分钟，只完成这一个问题。对应虚拟地址、页表、缺页处理和按需分配；理论 PPT 具体页码尚未核对。

## 先预测，再运行

1. malloc(16 MiB) 刚返回时，RSS 一定增加 16 MiB 吗？写下理由。
2. 按基础页步长，每隔一页写 1 字节，写到 1/4、1/2、全部时，驻留和缺页会怎样变化？
3. 1 KiB 小块第一次写入，缺页数能否为 0？free 后映射是否一定消失？

## 用自己的 C 代码驱动实验

把同目录的 `student.h` 另存为自己的 `student.c`，只实现 `course_touch`。从 written 继续到 limit，不重写前阶段的位置；每次向 memory[位置 × page_bytes] 写入 7，并返回累计位置数。不要读写已释放的内存。采集器、malloc/free、原始文件与校验器由框架提供。

本任务按相对块首地址的基础页步长访问，并非宣称块首地址页对齐。1 KiB 也有一个待写位置。三阶段目标采用向上取整，因此小块的后两阶段可能不再写新位置。

先在目标 Linux 的项目根目录执行：

```sh
python3 -B work/doctor.py --profile student
python3 -B work/run_all.py --suite course --course-code student --student-source ./student.c --repeats 1
```

第一次先用空白模板看失败，改完后重跑。自动判题用独立缓冲区检查空阶段、首个位置、前缀是否被重写、4096 和 65536 字节步长下是否只修改要求的字节。通过后用同一份源码跑 1、256、1024、16384 KiB 的真实采样。网页的「C 编程实战」区可以选择判题记录，把通过的实测绑定到作答笔记，并进入原始证据。使用默认输出目录 `work/runs` 便于同一项目的网页发现记录。

在已配置的 openEuler 客体内可运行上面的 Linux 命令。也可以在 Windows 直接把自己的 C 文件交给客体，采样会取回到 `work/openeuler-vm/guest-runs`：

```powershell
python work/doctor.py --profile vm --connect --guest-lab student
.\work\vm.ps1 retest -StudentSource .\student.c --suite course --course-code student --repeats 1
```

Windows 入口在客体编译前校验上传文件的 SHA256，回传报告也包含实际参与判题与采样的源码哈希。在负责运行 QEMU 的 Linux 中，可用 `bash work/openeuler-vm/retest.sh --suite course --course-code student --student-source ./student.c --repeats 1`。只运行自己编写或可信的代码。

未填写的起始文件应检查失败。先看失败项，再自己改。参考实现位于 ../../proj5-course/access_pattern.h；按需查看，不要求先看答案。

## 检查标准

- 写入契约通过后，4 种尺寸各有指定次数的独立采样。快速练习用一轮，正式复验可用 `--repeats 3`。
- 每阶段累计位置数符合目标；所有指定位置最终值为 7。
- 不把“首次写一定一次缺页”“free 一定立即归还内核”写成检查公式。
- 选一轮记录，填写运行 ID、源码哈希、观察到的 RSS/缺页/映射，与预测比较。
- 用自己的话解释一个不符合直觉的样本，指出仅凭本工具还不能证明什么。

自动检查只能验证规定动作，不能证明理解程度、任意程序的内存安全或教学效果。未写完的代码可能产生无效访问、超时或错误数据，这些均保留为失败记录。网页笔记是学习者自述，不是系统观测；不自动评分。

## 跨机验收

将整个运行目录交给队友。队友用 Python 3.10+ 在另一设备执行 `python -B work/verify_submission.py --student-run 路径`，可离线核对源码哈希、判题日志、四种尺寸和原始采样。两台机器各自重新运行同一份源码后，用两个 `--student-run` 比较，收据分别列出源码、轮次、编译器和环境差异。不同环境仍可各自通过，RSS 和缺页按各自读数解释。复制同一份报告再复验时，收据会标明是同一运行。

## 参考解释（看完证据后再读）

malloc 可能使用已有的分配器空间，也可能申请新的虚拟映射。分配器自身可能先触碰部分页，所以申请后 RSS 不必为 0。写到尚未有可写物理映射的位置可能引发缺页，随后驻留增长；已驻留的小块首次写可以没有新增缺页。free 交还给分配器，不保证每次立刻解除映射。

这里按与块范围重叠的整个 VMA 合计 RSS，并非块本身的精确物理成本；进程级缺页也可能包括其他访问。用隔离 mmap 对照进一步缩小干扰，不能直接把理论页数与 malloc 的所有观测强行画等号。

结构借鉴 OS-Barrier 的学生空缺版、参考版和分阶段任务；本题内存动作与实现来自本项目华科课例改编，未复制他人实验结果。来源见 docs/REGIONAL_COURSE_COMPARISON.md 和 docs/SOURCES.md。
