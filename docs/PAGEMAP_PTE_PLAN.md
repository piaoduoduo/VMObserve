# 短板 A 解决方案：`/proc/<pid>/pagemap` 页表项（PTE）与物理页帧（PFN）双层观测规划

制定日期：2026-11-26  
适用版本：`vmobserve.run/v1`（增量向后兼容，不改写历史实测记录）  
Gemini 设计了展示和数据契约。Codex 已接入 C 探针、Python 回放、诊断、导出和环境自检。第 6 节记录本机两种权限的实测结果。

---

## 1. 问题定义与技术选型

### 1.1 当前短板
截至 `39574c8`，VMObserve 的观测层基于 `strace`、`/proc/<pid>/smaps` 与 `getrusage`，在 VMA 汇总与进程计账层已经高度严谨，但在页表项（PTE）和物理页帧（PFN）层仍有三处“间接推论”：
1. **3.3 按需调页**：只能看到整段 VMA 的 `RSS` 涨落，无法逐页直接观测“申请后页表项 `Present = 0`，首次写入后该页 `Present = 1`”。
2. **拓展实验 COW（写时复制）**：`memory_probe.c` 只能通过父子 `PSS` 守恒和读回校验和间接推论写时复制，无法直接观测 `fork` 后父子同一虚拟页指向**相同 PFN**、子进程改写后**已写页 PFN 分裂而未写页 PFN 仍共享**，也无法直接实锤 `read_all` 阶段全部未写匿名页指向同一共享零页 PFN。
3. **拓展实验 THP（透明大页）**：稀疏写场景下，只能通过 `smaps` 看到 `64 KiB vs 32 MiB`，不能在页表粒度直观展示“只写第 0 页首字节时，关大页仅第 0 页 `Present = 1`，而开大页连带第 1、256、511 页全部 `Present = 1` 且 PFN 连续 2 MiB 对齐”。

### 1.2 为什么选择 `/proc/<pid>/pagemap`（而不是改内核或强绑 eBPF）
- 本工具使用内核提供的只读接口。已在 openEuler 24.03 LTS 与 Ubuntu WSL2 核验。打开失败会保留原因，原有 smaps 采集照常完成。
- **天然适配普通学生与特权演示两种环境（双层观测）**：
  - 这里的两个 6.6 内核可向普通用户提供 Present、Swapped 和 Soft-Dirty。Linux 4.0、4.1 会拒绝非特权打开，4.2 起采用屏蔽 PFN 的方式。[内核接口说明](https://docs.kernel.org/admin-guide/mm/pagemap.html)
  - **特权环境（openEuler 虚拟机 / WSL `sudo`）**：具备 `CAP_SYS_ADMIN` 时可同时读出 `bit 0..54` 的真实 **PFN（Physical Frame Number）**，直接实锤 COW 共享零页、父子同 PFN 共享、写时分裂不同 PFN 及 THP 2 MiB 连续物理帧。
- 每个有效阶段用 `pread` 读取 6 或 8 个固定页的条目，每项 8 字节。探针不读写目标页内容。程序单独记录其写入动作的缺页数。

---

## 2. 前后端增量数据契约（JSON Schema）

外层 `schema_version` 维持 `"vmobserve.run/v1"`。所有历史记录不修改、不迁移；前端在缺少 `pagemap` 字段时保持完全兼容。

### 2.1 `sample.pagemap` 对象结构（挂载于 `case.data.samples[i].pagemap`）

```json
{
  "source": "/proc/12345/pagemap",
  "status": "available",
  "pfn_access": "visible",
  "page_bytes": 4096,
  "region_start": "7f8a10000000",
  "region_pages": 4096,
  "sampled_count": 8,
  "present_count": 8,
  "swapped_count": 0,
  "entries": [
    {
      "page_index": 0,
      "vaddr": "7f8a10000000",
      "label": "第 0 页（改写目标）",
      "expected_written": true,
      "raw_hex": "8180000000123400",
      "present": true,
      "swapped": false,
      "soft_dirty": false,
      "file_shared": false,
      "pfn": "123400"
    }
  ]
}
```

### 2.2 字段语义与防造假铁律

| 字段 | 类型 | 必填 | 语义与严格边界 |
| --- | --- | --- | --- |
| `source` | `string` | 是 | 实际读取路径，如 `"/proc/self/pagemap"` 或 `"/proc/<pid>/pagemap"`。 |
| `status` | `string` | 是 | 枚举：`"available"`（正常读出）、`"unmapped"`（如 `before_alloc` / `freed` 无目标映射，不伪造读数）、`"unavailable"`（打开失败或内核未开放）、`"error"`（`pread` 短读/异常）。 |
| `pfn_access` | `string` | 是 | 枚举：`"visible"`（具备 `CAP_SYS_ADMIN` 且测得真实非零 PFN）、`"masked"`（内核已按非特权策略屏蔽 `bit 0..54`）、`"not_applicable"`（`unmapped` 或本步全部 `present=false` 无物理页帧）。 |
| `reason` | `string \| null` | 否 | 当 `status != "available"` 或 `pfn_access == "masked"` 时的原因说明（如 `"requires_cap_sys_admin"`、`"errno=13"`）。 |
| `page_bytes` | `number` | 是 | 基础页大小（字节，常见 `4096`）。 |
| `region_start` | `string \| null` | 否 | 目标映射起始虚拟地址（十六进制，不带 `0x`）。 |
| `region_pages` | `number \| null` | 否 | 目标映射包含的基础页总数。 |
| `sampled_count` | `number` | 是 | 本次抽样页数（等于 `entries.length`）。 |
| `present_count` | `number` | 是 | `entries` 中 `present === true` 的页数。 |
| `swapped_count` | `number` | 是 | `entries` 中 `swapped === true` 的页数。 |
| `entries` | `Array<Entry>` | 是 | 抽样页明细数组（`unmapped` / `unavailable` 时为 `[]`）。 |

**单条 `Entry` 字段约束**：
- `page_index` (`number`): 相对目标映射起点的基础页下标（从 `0` 开始）。
- `vaddr` (`string`): 十六进制虚拟地址（小写、不带 `0x`）。前端显示时自动补 `0x`。
- `label` (`string | null`, 可选): 位置语义标签（如 `"A 段首"`、`"2 MiB 块次页"`）；缺省时前端按 `第 N 页` 自动生成。
- `expected_written` (`boolean | null`, 可选): 程序截至本阶段是否已经写入该页（用于前端标出“已写页 / 未写页”及核对一致性）。
- `raw_hex` (`string | null`): 原始 64 位小端整数的 16 位定宽十六进制原文（例如 `"8180000000123400"`），便于人工核对位段。
- `present` (`boolean`): `Boolean((raw >> 63) & 1)`。
- `swapped` (`boolean`): `Boolean((raw >> 62) & 1)`。
- `file_shared` (`boolean | null`): `Boolean((raw >> 61) & 1)`。
- `soft_dirty` (`boolean | null`): `Boolean((raw >> 55) & 1)`。
- `pfn` (`string | null`): **铁律——仅当 `present === true && pfn_access === "visible"` 时填写非零十六进制字符串（不带 `0x`）；否则必须为 `null`！绝不允许把内核屏蔽产生的 `0` 写成 `pfn: "0"`。**

### 2.3 `pfn_access` 后端判定算法
1. 在采集条件中记录当前进程的有效 UID 和 `CapEff` 第 21 位。是否能展示页帧号要结合实际读到的条目判断。
2. 解析每个 `present === true` 的 `raw` 值：取 `pfn_val = raw & ((1ULL << 55) - 1)`。
3. 判定：
   - 本步没有驻留页时记录 `not_applicable`，PFN 均为 `null`。
   - 驻留页遇到权限屏蔽时记录 `masked`、`requires_cap_sys_admin` 和 `null`。若已具备权限却出现零帧号，或能力位读不到，原因写作 `pfn_not_disclosed`。
   - 有效能力位为 1，且所有驻留样本都读出非零帧号时记录 `visible`。换出条目的低位属于交换信息。

### 2.4 可选扩展：原始证据与诊断规则（供后端按需接入）
- **原文挂载**：探针可在 `stdout.jsonl` 中新增 `{"kind": "pagemap", "phase": "...", "role": "...", ...}` 事件（复用现有 `jsonl` 证据，零新增文件类型），或单独保存 `pagemap.jsonl` 并登记到 `artifacts.pagemap`（前端已提前在证据按钮与弹窗名称中兼容 `pagemap` 类型）。
- **诊断规则升级（`diagnosis.py`）**：
  - `anonymous_zero_page`：当 `read_all` 阶段 `pfn_access == "visible"` 且所有抽样页 `present == true` 且指向同一 `pfn` 时，可从 `probable` 升级为 `confirmed`（直接实锤共享零页）！
  - 新增 `cow_pfn_split`：当 `fork_shared` 全共享且 `child_write` 中已改写抽样页全部 `parent.pfn != child.pfn`、未改写抽样页全部 `parent.pfn == child.pfn` 时，输出 `confirmed` 级物理页分裂确认。
  - 新增 `demand_pte_present`：当 3.3 `allocated` 全 `present=false` 且各写入阶段已写哨兵页 `present=true`、未写哨兵页 `present=false` 时，输出 `confirmed` 级按需建表确认。

---

## 3. 三大实验的抽样哨兵页设计

### 3.1 实验 3.3 按需调页（`group3_demand.c`，512 MiB = 131,072 页）
抽取 **8 个固定哨兵页**（每次采样仅读 64 字节）：

| 抽样顺序 | `page_index` | 位置含义 | `allocated` 预期 `Present` | `write_quarter` (0..32767) | `write_half` (0..65535) | `write_all` (0..131071) |
| ---: | ---: | --- | :---: | :---: | :---: | :---: |
| 1 | `0` | A 段首（第 1 个 2 MiB 块首） | `0` | `1` | `1` | `1` |
| 2 | `1` | A 段第 2 页（验证 THP 连续性） | `0` | `1` | `1` | `1` |
| 3 | `511` | 第 1 个 2 MiB 块末页 | `0` | `1` | `1` | `1` |
| 4 | `32767` | A 段末页（1/4 边界前） | `0` | `1` | `1` | `1` |
| 5 | `32768` | B 段首页（1/4 边界后） | `0` | `0` | `1` | `1` |
| 6 | `65535` | B 段末页（1/2 边界前） | `0` | `0` | `1` | `1` |
| 7 | `65536` | C 段首页（1/2 边界后） | `0` | `0` | `0` | `1` |
| 8 | `131071` | C 段末页（512 MiB 末尾） | `0` | `0` | `0` | `1` |

- `before_alloc` 与 `freed` 阶段记为 `status: "unmapped"`, `pfn_access: "not_applicable"`, `entries: []`。
- 在 3.3 的 THP 对照中：若 `pfn_access == "visible"`，前端自动检查同一 2 MiB 块内 `page 0, 1, 511` 的 PFN 是否满足 `pfn(0) % 512 == 0` 且 `pfn(k) == pfn(0) + k`，与 `smaps` 的 `AnonHugePages` 形成**页表层 + VMA 层双重互证**。

### 3.2 拓展实验 COW（`memory_probe.c`，16 / 64 MiB）
抽取前 **8 个连续基础页** `page_index = 0, 1, 2, 3, 4, 5, 6, 7`（天然覆盖 `cow_stride` 为 `0 / 8 / 4 / 2 / 1` 的全部改写与未改写模式）：
- **采样时机**：复用 `memory_probe.c` 现有同步点——父进程在 `snapshot()` 中同时读 `/proc/<pid>/pagemap`（`fork_shared` 和 `child_write` 时子进程正阻塞在管道等待，父进程直接读 `/proc/<parent_pid>/pagemap` 与 `/proc/<child_pid>/pagemap`，零竞态）。
- **核心教学爆点**：
  - `untouched`：8/8 `Present = 0`；
  - `read_all`：8/8 `Present = 1`，特权态下 8 页全部指向**同一个共享零页 PFN**；
  - `write_quarter`（每 4 页写 1 页）：`0, 4` 获得独立 PFN，`1, 2, 3, 5, 6, 7` 仍停留在共享零页 PFN；
  - `write_all`：8 页各自独立 PFN；
  - `fork_shared`：**8/8 `父 PFN == 子 PFN`**（实锤未复制物理页）；
  - `child_write`（如 `1/4` 改写 `0, 4`）：**`0, 4` 标红/橙显示 `子 PFN ≠ 父 PFN（已复制分裂）`，`1, 2, 3, 5, 6, 7` 标绿显示 `子 PFN == 父 PFN（仍共享）`**！

### 3.3 拓展实验 THP（`thp_probe.c`，32 MiB，2 MiB 对齐）
抽取 **6 个关键哨兵页** `page_index = 0, 1, 256, 511, 512, 513`（横跨第 0 个与第 1 个 2 MiB 大页边界）：
- `untouched`：两组均 6/6 `Present = 0`。
- `after_write`（稀疏写：每 2 MiB 只写第 1 字节，即只写 `page 0` 和 `page 512`）：
  - **关闭大页组**：仅 `0, 512` 为 `Present = 1`，中间的 `1, 256, 511, 513` 全为 `Present = 0`（2/6 驻留）；
  - **请求大页成功组**：`0, 1, 256, 511, 512, 513` **6/6 全为 `Present = 1`**，且特权态下前 4 页满足 `pfn(0) % 512 == 0`、`pfn(k) == pfn(0) + k`，后 2 页满足 `pfn(512) % 512 == 0`、`pfn(513) == pfn(512) + 1`！

---

## 4. 前端实现规划（本轮由 Gemini 完成）

1. **新增独立前端模块 [pagemap-view.js](../work/vmobserve/web/pagemap-view.js)**（并在 [server.py](../work/vmobserve/server.py) `WEB_PAGES` 中注册 `/pagemap-view.js`）：
   - **纯计算导出函数**（便于 Node 单元测试，无 DOM 依赖）：
     - `inspectDemandPagemap(sample)`：汇总哨兵页 `Present` 数量、已写/未写页命中率、2 MiB 块 PFN 连续对齐判定（`contiguous2MiB`）。
     - `compareCowPagemap(parentSample, childSample, cowInfo)`：按 `page_index` 严格配对父子抽样页，区分 `shared_same_pfn`、`split_diff_pfn`、`pfn_masked`、`not_present`、`mismatch`，并识别单进程阶段的同零页模式（`allSamePfn`）。
     - `compareThpPagemap(offSample, onSample)`：并排对比关闭大页与请求大页在同哨兵页上的 `Present` 扩散与 2 MiB 连续性。
   - **渲染函数**：
     - `renderDemandPagemapPanel(sample, options)`：接入 3.3 按需调页与 3.3 透明大页对照（受控两组还可并排展示两组页表摘要）；带直观的「哨兵页格阵（Present=1 绿 / Present=0 灰）」+ 按需展开的「页表项原始位段表（含 `raw_hex`、`Present`、`Swapped`、`Soft-Dirty`、`PFN`）」。
     - `renderCowPagemapPanel(sample, peerSample, cowInfo)`：接入 COW 8 步，单进程阶段显示 8 页格阵与共享零页 PFN 核对；`fork_shared` / `child_write` 阶段显示「父进程 PFN ⇄ 子进程 PFN」双行共享/分裂对照视图与统计徽标。
     - `renderThpPagemapPanel(samples, labels)`：接入 THP 第 ②、③ 步，并排对比两组 6 个跨 2 MiB 边界哨兵页的 `Present` 格阵与 2 MiB 连续对齐实锤。
   - **历史旧记录零干扰兼容**：当旧记录没有 `sample.pagemap` 时，不捏造任何数字，仅在折叠原文区域旁或页表位置克制降级（完全不占用首屏、不破坏已有布局与测试）。
2. **接入页面与样式**：
   - [course-views.js](../work/vmobserve/web/course-views.js)：在 3.3 单步与受控对照视图挂载 `renderDemandPagemapPanel`。
   - [memory-views.js](../work/vmobserve/web/memory-views.js)：在 COW 挂载 `renderCowPagemapPanel`，在 THP 挂载 `renderThpPagemapPanel`。
   - [ui.js](../work/vmobserve/web/ui.js) / [app.js](../work/vmobserve/web/app.js) / [learning-report.js](../work/vmobserve/web/learning-report.js)：预留 `pagemap` 原文按钮中文名与学习报告页表摘要输出（存在时自动带出）。
   - [style.css](../work/vmobserve/web/style.css)：延续现有一致的 Slate + Cobalt Blue 语义色板（绿 = `Present=1`/共享同 PFN，琥珀橙 = COW 分裂不同 PFN，紫 = 2 MiB 连续大页对齐，浅灰 = `Present=0` 未驻留），适配桌面与手机窄屏。
3. **前端单元测试**：新建 `tests/test_pagemap_view.mjs`，覆盖 3.3、COW、THP、无权限屏蔽、旧记录降级、共享零页与 2 MiB 对齐校验全部路径。

---

## 5. 给 GPT（Codex）的后端实施清单

GPT 接手后端时只需按第 2、3 节契约逐项补齐，前端无需修改即可自动亮起：

1. **新增 C 公共头文件 `work/common/pagemap_probe.h`**
   - 实现 `sample_pagemap(pid_t pid, const char *phase, const char *role, uintptr_t region_start, size_t region_bytes, size_t page_bytes, const size_t *indices, const char **labels, const int *expected_written, size_t count)`。
   - 使用 `open("/proc/<pid>/pagemap", O_RDONLY)` + `pread(fd, &entry, 8, (off_t)((vaddr / page_bytes) * 8))`，严禁解引用目标虚拟地址。
   - 读取 `/proc/self/status` 的 `CapEff` 判断 `CAP_SYS_ADMIN`（`bit 21`）并结合 `present && pfn == 0` 准确输出 `pfn_access`。
   - 以单行 JSONL `{"kind":"pagemap", ...}` 打印到 stdout（与其他探针事件共用 `stdout.jsonl` 并自然纳入 SHA-256 校验）。
2. **接入三个 C 探针**
   - `work/proj5-course/group3_demand.c`：在 `before_alloc`、`allocated`、`write_quarter`、`write_half`、`write_all`、`freed` 后调用，抽样 8 个哨兵页 `[0, 1, 511, 32767, 32768, 65535, 65536, 131071]`。
   - `work/proj5-memory-pilot/memory_probe.c`：在 `untouched`、`read_all`、`write_quarter`、`write_all`、`fork_shared`（父/子）、`child_write`（父/子）后调用，抽样 `[0, 1, 2, 3, 4, 5, 6, 7]`；按 `cow_stride` 填写 `expected_written`。
   - `work/proj5-round2/thp_probe.c`：在 `untouched`、`after_write` 后调用，抽样 `[0, 1, 256, 511, 512, 513]`。
3. **Python 解析、校验与诊断**
   - `work/vmobserve/evidence.py` & `work/vmobserve/group3.py`：解析 `kind == "pagemap"` 记录并挂载到对应 `(phase, role)` 的 `sample["pagemap"]`；校验 `vaddr == region_start + page_index * page_bytes`、位解析与 `raw_hex` 一致、以及防造假校验（`pfn_access == "masked"` 时不允许出现非空 `pfn`）。
   - `work/vmobserve/diagnosis.py`：新增 `cow_pfn_split`、`demand_pte_present`，并在特权态全同 PFN 时将 `anonymous_zero_page` 升级为 `confirmed`。
   - `work/vmobserve/export.py`：HTML/JSON 导出保留 `pagemap` 摘要（CSV 可保持列稳健或追加 `pagemap_present` / `pagemap_pfn_access`）。
   - `work/vmobserve/replay.py`：若新增独立 `pagemap` 文件类型，加入 `read_evidence` 白名单（若复用 `stdout.jsonl` 则无需改动）。
4. **环境自检与实测归档**
   - 配合 `work/vmobserve/doctor/` 增加 `/proc/self/pagemap` 可读性与 `CAP_SYS_ADMIN` 检测（区分“可观测 Present 位”与“可观测真实 PFN”）。
   - 在 openEuler 24.03 LTS 虚拟机（root 可见 PFN）与普通用户 Linux/WSL（非特权仅见 Present）各实跑一组 3.3 + COW + THP，补齐 Python 单元测试。

## 6. 本地实测与回放

2026 年 11 月 26 日采集了下列八份记录，共 12 个案例、60 次阶段快照。每份均从原始 JSONL 和 smaps 重建，并与 HTML、JSON、CSV 导出核对。原始记录位于各自目录的 `cases/<案例>/stdout.jsonl`。本轮保存在本机。

| 环境与目录 | 3.3 原版 malloc | 3.3 受控开关 | COW，改写 1/4 | THP，稀疏写 |
| --- | --- | --- | --- | --- |
| openEuler 24.03，UID 0，`work/openeuler-vm/guest-runs` | `20261126T124107.942264Z` | `20261126T123820.509224Z` | `20261126T123621.058829Z` | `20261126T125647.453427Z` |
| Ubuntu 22.04 / WSL2，UID 65534，`work/runs` | `20261126T123850.803106Z` | `20261126T123853.603542Z` | `20261126T125354.524045Z` | `20261126T125634.218882Z` |

- **按需调页。** 两种环境的受控映射从申请、写四分之一、写一半到写完，8 个抽样页的驻留数都是 **0、4、6、8**。原版 `malloc` 首次返回时，两边第 0 页都已驻留。随后 openEuler 是 **5、7、8**，WSL2 是 **4、6、8**。openEuler 的第 32768、65536 页分别在程序写到那一段之前就已驻留，同步的 smaps 分别记有 128、256 MiB 匿名大页。快照能确认先后顺序，分配器管理信息和大页覆盖是可继续对照的解释。
- **写时复制。** openEuler 中，先逐页读取 16 MiB 匿名内存，读值之和为 0，前 8 页共用一个 PFN。父进程写满后再 fork，父子在 8 个地址上的 PFN 一一相同。子进程每 4 页改写一次后，第 0、4 页的父子 PFN 分开，其余 6 页仍然相同。普通用户看到这 8 页都驻留，PFN 均为 `null`，父子值和 PSS 仍可核对。
- **透明大页。** 程序每个 2 MiB 区间只写首字节。两个环境关闭大页时只有第 0、512 页驻留，共 2/6。请求大页时 6/6 驻留，smaps 记录 32 MiB 匿名大页。openEuler 的六个 PFN 与各自在 2 MiB 区间中的偏移吻合。每次实际读取六个位置。
- **原文与权限。** 页表项是内核通过 pagemap 导出的 64 位字。只读固定抽样页，COW 还读取本实验正在等管道的子进程。原版 malloc 的起点向下对齐到基础页，首尾可能与分配器共页。每个条目的 `vaddr` 是真实虚拟页首。配对 COW 阶段的 `expected_written` 表示子进程在 fork 之后改写过该页。

进入 COW 的「刚 fork」和「子进程改写」两步，点「查看这一步的原文」里的「页表项采样 pagemap」，会在同一份 JSONL 里高亮对应阶段和进程的行。旧记录按原有 RSS、PSS 和缺页数回放。Edge 实际核对了这两个步骤、普通用户的 8 个屏蔽项、3.3 的逐步读数、THP 的 4 个未写邻页和一份旧记录。随后补齐 `humanizeFinding` 非 `confirmed` 防误写守卫、诊断空集/零页边界与 `pagemap_probe.h` 缓冲与零长数组加固，117 项 Python 与 60 项 Node 回归测试全部通过（本机浏览器验收原始 JSON 归档于被 Git 忽略的 `output/playwright/pagemap-20261126/browser-result.json`）。

课程动作沿用本期 512 MiB 实验的步长和 A、B、C 三段写入。[当期课程任务对照](COURSE_ALIGNMENT.md) 本轮也检索了[往届华科实验仓库](https://github.com/lyf1984/HUST_OS_LAB)和 [1037 资料站](https://1037.wiki/)。后者可打开检索首页，两处均未取得与本期 3.3 对应的报告正文。上表数字全部取自本轮运行。

第一次用 WSL 普通用户往 Windows 挂载盘归档时，复制文件后恢复修改时间触发了 `EPERM`，记录 `20261126T123659.465803Z` 在采集前终止。运行器现在在内容复制成功后单独尝试恢复文件属性，仍逐文件计算 SHA-256。表中的普通用户 COW 和 THP 都通过默认归档入口复测。

本机可用 `python work/launch.py` 打开实验台。采集可选 `python3 work/run_all.py --suite demand512-thp --repeats 1`、`--suite baseline --baseline-mib 16 --cow-fraction 1/4 --repeats 1` 或 `--suite thp --pattern sparse --repeats 1`。保存的每份报告都有本轮源文件和原始数据的哈希（本机验收清单与实测截图留存于被 Git 忽略的 `output/verification/pagemap-20261126/acceptance.json` 及 `output/playwright/pagemap-20261126/cow-openEuler.png`）。
