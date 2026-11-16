# 结果格式 v1

格式标识：`schema_version = "vmobserve.run/v1"`。Python 3.10+，JSON UTF-8，内存计量为 KiB，动作计数无单位。原始探针 JSONL 保持兼容；报告是统一外壳，不能替代原始证据。

| 字段 | 含义 |
| --- | --- |
| run_id / started_at / finished_at | 执行环境 UTC 标识与时间，客体时钟未保证与宿主同步 |
| data_origin | 真实运行为 real_execution；单元测试构造数据为 synthetic_test |
| view_mode | 原记录 execution_record；重建结果 historical_replay |
| environment | OS、内核、架构、页尺寸、Python/libc、THP 策略/分尺寸策略、meminfo、执行环境 |
| sources | 相对于 source/ 的源码路径 → SHA256，包含实际 C/头文件与编排/展示源码 |
| artifacts | 原始数据/日志相对路径 → SHA256 |
| builds / compiler_check | 命令、进程结果、错误与起止时间；原始版本输出在 build 日志 |
| plan / cases | 计划参数、case ID、执行状态、原始文件、解析观测、验证结果 |
| diagnosis | 规则版本、证据引用、confidence、解释边界、同轮对照与复验建议 |
| related_run | 父报告 ID/SHA256、复验配方与关系；非同一轮对照 |
| integrity | 回放时新计算，verified / legacy_partial / failed |

## 状态与退出码

| 运行状态 | 退出码 | 含义 |
| --- | ---: | --- |
| completed | 0 | 全部请求的案例执行完整，校验通过 |
| failed | 1 | 编译、进程、采集或正确性失败 |
| unsupported | 2 | 非 Linux、目标系统不符或基础采集条件不足 |
| completed_with_deviations | 3 | 程序完成，但某些观测关系偏离基线 |
| cancelled | 130 | 运行器收到中断，保留已完成和部分证据 |
| running | 无 | 中间检查点；持久化记录可能来自异常退出，不能视为正在实时采集 |

案例可有 `not_run`、`running`、`completed`、`failed`、`timeout`、`unsupported`、`cancelled`。案例 validation 是另一维：passed / deviation / failed / insufficient_evidence。编译失败的案例为 not_run，错误明确引用 compile_failed。原始值校验失败是 correctness 失败，数值关系偏离只是 expectation 偏差。

## 兼容旧记录

旧版无 schema_version，按原来 6+12 个实验的文件布局适配。读取原始源文件并核对旧报告的 4 个源码哈希，重新解析全部原始 JSONL/smaps。旧版未保存原始数据哈希，所以标记 legacy_partial，不能追溯证明这些原始文件从未改变。旧 summary 的“仅 WSL”文案保留在原文件中，界面以对应实际 environment 为准。

回放不会改写原 report，不执行历史源码，不信任缓存的诊断内容。若需要迁移，导出到新目录；导出附带原报告哈希及当前规则版本。

## v0.2.0 的 COW 扩展

外层仍为 `vmobserve.run/v1`，增加字段，不改写历史记录。新基础案例的 `parameters.cow_fraction` 为字符串 `0`、`1/8`、`1/4`、`1/2` 或 `1`；`all` 只用于计划展开，不出现在单个案例里。

探针 environment 记录 `probe_version=2`、`cow_fraction`、`cow_stride_pages`、`total_pages`、`cow_pages`。后三项用整数表达页间隔、总页数与预期写入页数；stride 为 0 表示不写，其他值表示均匀间隔多少个基础页写一次。isolation 记录实际 `cow_written_pages`、父子页首值不符数量 `parent_mismatches` / `child_mismatches` 以及原有校验和。计划、声明和实际计数不符属于证据不一致；页首值不符属于正确性失败。

新探针最终阶段统一为 `child_write`；历史探针的 `child_write_quarter` 原样保留。解析后的 `data.cow` 包含 fraction、written_pages、total_pages、written_kib、phase 和 condition_origin。新记录来源为 `recorded`；不含新参数的历史记录才能适配为 `legacy_fixed_quarter`。含新参数却缺少探针元数据时拒绝退回旧格式。

诊断规则 `2026-11-11.1` 增加 `diagnosis.cow_observations`：逐案例保存 mib、repeat、fraction、written_pages、total_pages、expected_pss_kib、observed_pss_kib、confirmed。确认表示符合当前条件下的计账与值隔离证据，不能解释为物理页帧级跟踪。零写入只确认保留共享计账。CSV 相应增加 cow_fraction、cow_written_pages、cow_total_pages 三列；HTML 导出包含理论值与实测值对照表。

## v0.3.0 的课程实验扩展

外层版本仍为 v1；新增 `suite=course`，参数为 requested_kib（1/256/1024/16384）和 repeat。环境增加 allocator_environment，仅记录 GLIBC_TUNABLES、MALLOC_MMAP_THRESHOLD_、MALLOC_TRIM_THRESHOLD_、MALLOC_PERTURB_、LD_PRELOAD；变量未设置时相应值为 null。libc 与系统默认 THP 使用既有环境字段。

探针 condition 记录 probe_version=1、allocator=malloc、requested_kib、page_bytes、positions、thp_policy=system_default、allocation_sequence=fresh_process_single_block。六个 sample 顺序固定为 before_alloc、allocated、write_quarter、write_half、write_all、freed；每条记录 pid、role、十六进制字符串 address/program_break、written_positions、action_minor/major。written_positions 是当前有效对象已写的位置数量，申请前后及释放后为 0；不是“累计历史写次数”。values 记录 checked_positions、mismatches、ok，检查每个已写位置，不覆盖每个字节。

每个原始 smaps 块保存全进程映射；解析后样本 `scope=overlapping_vmas`。metrics 为与申请虚拟区间相交的整个 VMA 之和；mappings 保留各段 header、start/end 和数值。mapping_present 只表示存在相交映射，mapping_kind 为 heap/other/absent；kernel_page_kib 为 null，不能将合计后的多个映射虚构成同一页大小。申请前和释放后以保存的申请地址查找，地址来自记录，不访问释放后的对象。

验证拒绝阶段、身份、地址、声明条件、实际写入数、值检查或相关原始字段不一致；申请有效期间要求虚拟区间被映射覆盖。值错误导致 failed。RSS 不增长、没有新增次缺页或释放后映射保留，不自动构成失败；它们由诊断解释。规则版本更新为 `2026-11-11.2`，新增 malloc_mapping、malloc_demand、malloc_free。

CSV 增加 scope、requested_kib、address、program_break、written_positions、mapping_present；course 有值，旧案例缺失字段留空。HTML 明确 whole-VMA 范围，JSON 保留完整 condition 和 mappings。历史文件不迁移或覆盖；导出按当前规则只读重建。

## v0.4.0：任务检查与真实受控阻断

外层仍为 `vmobserve.run/v1`，规则版本 `2026-11-11.3`。增量字段：

- course 参数和 probe_version=2 条件增加 `course_code=reference|student`；v1 历史没有此字段仍按原规则解析。v2 保存实际累计位置，格式合法但未达到阶段目标时保留六步数据并令 validation=failed、整轮 status=failed；采集 case.status 仍可 completed。新增三个 positions_* 检查。不把错误动作解释为已完成的标准按需分配实验。
- THP 参数增加 `process_thp=inherit|allow|disable`（pair 为计划展开项，不是案例值）；条件增加 `process_thp_disabled`（PR_GET_THP_DISABLE 回读）、`madvise_result`。stderr 增加 `BEGIN_PROCESS pid=...` / `END_PROCESS` 原始完整 `/proc/self/status`。解析器验证该 PID、THP_enabled 与回读一致，派生 `status_thp_enabled`。旧记录缺少此证据保持未知。
- `diagnosis.policy_comparisons` 仅匹配同轮、同模式/尺寸/步长/重复编号、同为请求大页的 allow/disable 组。两组状态证明、无交换/主缺页、校验通过且允许组实际大页 > 0、禁止组为 0 才标 control_valid=true；两组都为 0 不确认策略效果。
- `thp_process_disabled` 确认已观测的阻断条件；`thp_process_control` 确认本轮受控干预的对照差异。均不推断自然碎片。普通未观测规则补 next_steps；关联复验 recipe 为 thp_sparse_process_pair / thp_full_process_pair。
- CSV 增加 course_code、process_thp、process_thp_disabled、status_thp_enabled、madvise_result；旧数据留空。HTML 加入进程条件和任务检查，JSON 保留全部。

学习记录独立使用 `vmobserve.worksheet/v1`，answer_origin=learner_notes、assessment=not_graded。草稿与保存记录分开；保存时固化 run_id、原报告 SHA256、源码哈希、完整性与来源。切换历史不改写已存答案。浏览器验证用独立存储键和 answer_origin=ui_verification，不能充当学习者记录。

## 2026-11-12 回放与导出修复

规则版本更新为 `2026-11-12.1`，外层仍为 v1。单个案例的原始文件哈希或解析失败只影响该案例；整轮 integrity 仍为 failed，其余案例独立重建 validation 和 integrity。共享源码／环境等证据失败仍阻止整轮确认。原执行 status 保留历史含义。

CSV 新增 `run_status`、`case_status`、`validation_status`、`run_integrity`、`case_integrity`。前者分别来自原运行、案例执行、重算检查；后两者为回放后的整轮与逐案例完整性。没有成功解析样本的案例也保留一行状态，phase 和指标为空，不用零代替。未进行逐案例校验时 case_integrity 留空。

页面任务保留退出码 3；仅在同时取得唯一的新报告且其状态为 completed_with_deviations 时，把任务显示为“完成 · 有偏差”。缺失／不匹配报告或其他错误码仍报执行失败。

## v0.5.0：地址与装载段

外层仍为 `vmobserve.run/v1`；规则版本为 `2026-11-13.1`。新增 `suite=layout`，默认重复三次。探针记录 condition（probe_version=1、pid、page_bytes、executable、method=dl_iterate_phdr+smaps）、七个 point、实际加载的 PT_LOAD segment，以及独立完整 smaps 块。

`data.samples` 的 scope 为 `address_containing_vma`。每项保留 symbol、symbol_label、address、mapping_start/end、permissions、pathname、mapping_header、elf_object、elf_segment_index 与所在整个映射的指标。地址为十六进制字符串；堆和栈没有对应 ELF 段时段字段为 null。多个地址可能属于同一映射，不能把它们的 RSS 重复相加。

`data.segments` 保留 object、is_main、index、load_bias、vaddr、offset、filesz、memsz、flags，以及派生的 start/end 和实际映射头列表；`data.mappings` 保留完整映射。解析检查身份、七类地址、段覆盖、文件偏移和原始指标；权限偏离预期为 validation=deviation，采集/格式错误仍是 failed。确认地址关联不等于知道物理页框或地址变化根因。

CSV 增加 symbol、mapping_start/end、permissions、pathname、elf_object、elf_segment_index。未采集的缺页数留空；HTML 单独显示地址和段表，JSON 保留完整数据。原有失败状态列和历史格式兼容保持不变。


## v0.6 第3组原课例

新增suite：link-dynamic、link-static、sequence、demand512、stack，外层仍为v1；group3是计划入口，默认3次共24案例（含原layout3次）。完整smaps重建每个地址所在整个VMA，scope为address_containing_vma。count在sequence中为已分配块数，在demand512中为累计写入位置数，在stack中为递归深度；CSV新增count、total_minor/major及process_rss_kib/process_size_kib。

link保存file/ldd/readelf原文、ELF装载段与映射关系；sequence保存带动作标记的syscalls证据；所有补充文件必须进入artifacts哈希清单。stack父进程的采集退出状态和子进程outcome（signal/exit_code）分别记录；预期SIGSEGV仍保留为11，不能改写成子进程正常返回。512 MiB与栈对照的原始条件及输出说明见GROUP3_COMPLETION_20261116.md。

## v0.6.1：连续分配专项

外层保持 v1；`--suite sequence` 只展开三次连续分配，不修改 all/group3 的计划。新增顶层 `trace_tool` 为 strace 版本检查的执行状态、命令和输出文本；build/strace 两份日志加入哈希清单。缺少该工具时案例 status=unsupported、error.code=trace_tool_unavailable、validation=insufficient_evidence，整轮返回 1。

`data.actions` 保留原 syscalls 字符串列表，同时增加 phase、begin_line/end_line 和 events（line/text/name/result/success）。行号从 1 开始，对应案例原始 syscalls.txt。前三项增加 requested_bytes、returned_address、allocation_source；仅地址范围匹配时为 new_brk_range/new_mmap_range 并附 source_line，无调用为 no_memory_syscall，其他情况 unresolved。状态描述实际观测，不把未匹配直接判为复用或泄漏。

`samples.blocks` 增加 requested_bytes、alive 和完整相交 mappings，保留旧 mapping 字段。释放阶段 alive=false；旧指针只作为数字范围查询。`related_scope=whole_vmas_intersecting_live_or_former_blocks`，新增 related_vma_count 和 related_size/rss/pss/private_dirty/shared_dirty/huge/swap_kib，为相交整段 VMA 去重合计。原 address_containing_vma 指标保留，不能将两种范围混用。CSV 新增 related_scope、related_vma_count、related_size_kib、related_rss_kib、related_pss_kib，其他完整关系在 JSON/HTML 原始证据展开区。

回放从原始记录重建新字段；旧报告没有 trace_tool 时不补造工具版本。已只读验证旧两轮 group3 和两轮 v0.5，不回写历史 JSON。

## v0.7.0 group4事件

新增suite：g4-fork、g4-pthread、g4-uthread、g4-pipe、g4-bank。仍使用vmobserve.run/v1。每个案例的artifacts为jsonl与kernel；kernel保存原始/proc/status和ps，不冒充smaps。回放兼容旧artifacts.smaps。

data包含condition、summary、kernel_status、ps_threads、samples；samples.scope为process_thread_event，保留event、pid、tid、time_ns及各项字段。CSV追加事件、身份、地址、信号和金额字段，RSS/PSS留空。无锁配置校验采集结构和身份，不要求一定产生错误计数，诊断明确其数据竞争。exec失败、SIGPIPE等预期对照由父进程保存状态，观察程序自身正常结束。
