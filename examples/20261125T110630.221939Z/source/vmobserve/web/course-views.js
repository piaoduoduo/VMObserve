import { $, state, labels, esc, kib, table, diagnosisHTML, findingFor, evidenceButtons, loadOriginalPs, stepNavigation, stepExplanation, demandPair, url, replayOriginLabel } from './ui.js';

import { newestReplay, demandEnvironmentReplays } from './curriculum.js';
import { demandPairTimeline, demandMetricData, demandRepeatReadings, demandRepeatMetric, demandMeasurement, demandExerciseReadings } from './comparison-data.js';

function renderLayout() {
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验 3.1 · 虚拟地址与映射</small>
    <h2>程序里的地址都在哪里？</h2>
    <p>对照《第七章 主存管理》课件第 9、12、43–49 页，先想一想：程序的函数代码和栈上的局部变量能放在同一块可写内存里吗？只读常量应该是什么权限？</p>
    <div class="sequence-controls">
      <button id="run-layout" class="primary">重新采集地址空间实验</button>
      <span class="picker-hint">会运行 3 次独立进程并保存各自的地址、装载段和 smaps</span>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => c.suite === 'layout');
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有“程序地址”实验，请点顶部“切换记录”选一条“程序地址”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], d = c.data;
  const short = name => name ? name.split('/').at(-1) : '匿名映射';
  const selector = `<label class="selector"><span>换一次实验：</span><select id="case-select">${cases.map((item, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>第 ${item.parameters.repeat} 次实验 · ${esc(labels[item.status] || item.status)}</option>`).join('')}</select></label>`;

  const addressStack = d ? `<div class="addr-stack-card">
    <div class="addr-stack-head">
      <span class="section-label">虚拟地址空间分布（由高地址到低地址）</span>
      <div class="semantic-legend" aria-label="映射颜色语义">
        <span class="legend-item"><i class="swatch swatch-heap"></i>堆区 [heap]</span>
        <span class="legend-item"><i class="swatch swatch-mmap"></i>匿名映射</span>
      </div>
    </div>
    <div class="addr-stack">
      ${[...d.samples].sort((a, b) => BigInt('0x' + b.address) > BigInt('0x' + a.address) ? 1 : -1).map(s => {
        const perm = s.permissions.slice(0, 3);
        const permClass = perm.includes('x') ? 'perm-exec' : perm.includes('w') ? 'perm-write' : 'perm-ro';
        const regionClass = s.pathname === '[heap]' ? 'slot-heap' : !s.pathname ? 'slot-anon' : '';
        return `<div class="addr-slot ${regionClass}">
          <span class="perm-badge ${permClass}">${esc(s.permissions)}</span>
          <div class="addr-slot-main">
            <strong>${esc(s.symbol_label)}</strong>
            <small>${esc(short(s.pathname))}${s.elf_object ? ` · ${esc(short(s.elf_object))} #${s.elf_segment_index}` : ''}</small>
          </div>
          <code>0x${esc(s.address)}</code>
        </div>`;
      }).join('')}
    </div>
  </div>` : '';

  const points = d
    ? table(['程序对象', '虚拟地址', '权限', '所在映射', '对应 ELF 段'], d.samples.map(s => [s.symbol_label, '0x' + s.address, s.permissions, short(s.pathname), s.elf_object ? short(s.elf_object) + ' · #' + s.elf_segment_index : '堆 / 栈（运行时分配）']))
    : '<p class="empty">本次采集没有拿到完整结果，点下方按钮可查看原始记录。</p>';
  const segments = d
    ? table(['程序 / 库 · 段号', '装载基址', 'ELF 段虚拟地址', '运行起点', 'ELF 权限', '跨映射数'], d.segments.map(s => [short(s.object) + ' · #' + s.index, '0x' + s.load_bias, '0x' + s.vaddr, '0x' + s.start, s.flags, s.mappings.length]))
    : '';
  const repeats = cases.filter(item => item.data).map(item => [`第 ${item.parameters.repeat} 次`, ...['function', 'stack'].map(symbol => '0x' + item.data.samples.find(s => s.symbol === symbol).address)]);
  const findings = findingFor([c.id], ['address_mapping', 'layout_permissions', 'incomplete_evidence']);

  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">
    ${selector}
    <p class="muted">当前进程 PID ${esc(d?.condition.pid ?? '未知')} · ${c.validation.status === 'passed' ? '权限检查通过' : '权限与常见默认值不同'}</p>
    ${addressStack}
    <details class="secondary-fold"><summary>展开 7 类对象的完整对照表</summary>
      ${points}
      <div class="explanation-box"><span class="explain-tag">怎么看权限和地址</span><p>权限里 r=可读、w=可写、x=可执行，p 表示私有映射（写时复制）。表格展示的是虚拟地址；映射区间和权限告诉你能在哪里读写；有多少页已驻留，要看 RSS。</p></div>
    </details>
    <details class="secondary-fold"><summary>进一步看：程序和动态库是怎么装进地址空间的？</summary>
      <p class="detail-copy">装入后的段起点 = 装载基址 + ELF 段虚拟地址。一个 ELF 装载段（PT_LOAD）有时会横跨多条映射，装载器还可能收紧部分页面的写权限。</p>
      ${segments}
      ${d ? `<details><summary>展开各段相交的映射原文</summary><pre>${esc(d.segments.map(s => short(s.object) + ' #' + s.index + '\n' + s.mappings.join('\n')).join('\n\n'))}</pre></details>` : ''}
    </details>
    <details class="secondary-fold"><summary>${repeats.length > 1 ? `对比 ${repeats.length} 次实验的地址` : "查看这次实验的函数与栈地址"}</summary>
      ${table(['实验轮次', '函数地址', '栈变量地址'], repeats)}
      <p class="detail-copy">${repeats.length > 1 ? "逐行比较：函数和栈的地址有哪些变化？结合编译方式和地址随机化解释。" : "当前只有一份完整的地址记录。重新采集后，可比较不同进程的地址。"}</p>
    </details>
    <p class="course-question">想一想：知道了某个变量的虚拟地址和所属映射，能直接算出它占用的物理页框号吗？</p>
    ${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c)}</div>` : ''}
  </div>${diagnosisHTML(findings)}</div>`;
}

const courseSteps = [
  { title: '申请之前', code: '尚未调用 malloc', question: '程序即将拿到的地址，和内存条上的物理位置是一回事吗？', theory: 'C 程序拿到的是虚拟地址。操作系统通过页表把虚拟页映射到物理页；这一步先把“申请前”的映射存下来做基准对照。' },
  { title: '申请完成，尚未写入', code: 'memory = malloc(size)', question: '申请了这么大空间，物理内存占用（RSS）会立刻涨这么多吗？', theory: 'malloc 返回了可用的虚拟地址，但操作系统此时大多只登记了映射范围。小块申请时，分配器写管理信息会先触碰第 1 页，所以有时能看到 4 KiB 的初始驻留。' },
  { title: '写入前四分之一', code: '每隔一页写 1 字节，累计写到 1/4', question: '往刚申请的内存里第一次写数据，RSS 和缺页数会怎么变？', theory: '首次写入尚未建立物理页映射的虚拟页时，会触发一次缺页异常，内核趁此时分配物理页框并建好映射。如果是 1 KiB 小块，因为所在页之前已经驻留，这里的缺页可以是 0。' },
  { title: '写到一半', code: '继续按页写入，累计写到 1/2', question: '接着往后面的新页写，RSS 和缺页是不是同步增长？', theory: '对照上一步看：这里“本步次缺页”记录这一步新发生的缺页增量，“相关映射 RSS”记录采样时的总物理驻留。' },
  { title: '写完全部页位置', code: '按页写入剩余所有位置', question: '为什么测到的“相关映射 RSS”有时比申请的字节数还大？', theory: '因为 malloc 块可能和其他管理信息或对象共处同一段 VMA，RSS 统计的是整段映射的物理占用；而即使每页只写 1 字节，内核也是整页整页分配物理内存。' },
  { title: '释放之后', code: 'free(memory)', question: '调用 free 之后，原来那段映射一定会立刻从 smaps 里消失吗？', theory: 'free 只是把内存交还给用户态分配器。大块（mmap 分配）通常会立刻 munmap 归还内核；小块（brk 堆区）往往被分配器留在进程里给下次复用。记住释放后的指针千万不要再读写。' }
];

function renderCourse() {
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验 3.2 / 3.3 · 按需分配</small>
    <h2>申请了内存，就已经用上物理页了吗？</h2>
    <p>改编自课内 <code>lab3_2/malloc.c</code> 与 <code>lab3_3/demand.c</code>（对应第七章第 57–60 页请求调页）：用 1 KiB、256 KiB、1 MiB 和 16 MiB 单块对比，一步步看清什么时候才分配物理内存。</p>
    <div class="sequence-controls">
      <button id="run-course" class="primary">重新采集按需分配</button>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => c.suite === 'course').sort((a, b) => b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有按需分配实验，请点顶部“切换记录”选一条“按需分配”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  state.phase = Math.min(Math.max(0, state.phase), courseSteps.length - 1);
  const c = cases[state.selected], step = courseSteps[state.phase];
  const sample = c.data?.samples[state.phase];
  const relevantRule = state.phase <= 1 ? 'malloc_mapping' : state.phase === 5 ? 'malloc_free' : 'malloc_demand';
  const findings = findingFor([c.id], [relevantRule, 'incomplete_evidence', 'course_task_incomplete']);
  const selector = `<label class="selector"><span>选择内存大小与实验轮次：</span><select id="case-select">${cases.map((item, index) => `<option value="${index}" ${index === state.selected ? 'selected' : ''}>${kib(item.parameters.requested_kib)} · 第 ${item.parameters.repeat} 次实验</option>`).join('')}</select></label>`;

  const reqKib = c.parameters.requested_kib;
  const rssRatio = sample ? Math.round((sample.rss_kib / Math.max(1, reqKib)) * 100) : 0;
  const fillPct = Math.min(100, rssRatio);
  const stepTabs = courseSteps.map((st, i) => `<button data-course-step="${i}" ${i === state.phase ? 'aria-current="step"' : ''}><span>${i + 1}</span>${esc(st.title)}</button>`).join('');

  const metrics = sample ? `<div class="step-metrics-grid">
    <div><small>申请大小</small><strong>${kib(reqKib)}</strong></div>
    <div><small>已写位置 / 总位置</small><strong>${sample.written_positions} / ${c.data.condition.positions}</strong></div>
    <div><small>物理驻留 RSS</small><strong class="kpi-accent">${kib(sample.rss_kib)}</strong></div>
    <div><small>本步次缺页</small><strong>${sample.action_minor} 次</strong></div>
    <div><small>原地址映射</small><strong>${sample.address === '0' ? '尚未取得地址' : sample.mapping_present ? '存在' : '未发现'}</strong></div>
    <div><small>返回地址</small><strong><code>${sample.address === '0' ? '尚未申请' : `0x${esc(sample.address)}`}</code></strong></div>
  </div>
  <div class="residency-meter">
    <div class="residency-head"><span>相关整段映射 RSS / 申请大小</span><strong>${kib(sample.rss_kib)} / ${kib(reqKib)}（${rssRatio}%）</strong></div>
    <div class="vma-meter-bar large"><span style="width:${fillPct}%"></span></div>
    <p class="detail-copy">RSS 包含相交映射的其他内容，比例可以超过 100%。进度条最高显示 100%，上方保留实际比例。</p>
  </div>` : '<p class="empty">本实验数据不完整，请点下方按钮查看原始日志。</p>';

  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">
    ${selector}
    <div class="stepper-bar">
      <nav class="step-strip">${stepTabs}</nav>
      <div class="step-arrows">
        <button data-course-step="${state.phase - 1}" ${state.phase === 0 ? 'disabled' : ''}>← 上一步</button>
        <button class="primary" data-course-step="${state.phase + 1}" ${state.phase === 5 ? 'disabled' : ''}>下一步 →</button>
      </div>
    </div>
    <div class="step-evidence">
      <div class="step-evidence-head">
        <span class="step-badge">第 ${state.phase + 1} / 6 步</span>
        <h3>${esc(step.title)}</h3>
      </div>
      <p><code>${esc(step.code)}</code></p>
      <p class="course-question">${esc(step.question)}</p>
      ${metrics}
      <div class="explanation-box"><span class="explain-tag">原理解释</span><p>${esc(step.theory)}</p></div>
    </div>
    <details class="secondary-fold"><summary>展开六个阶段汇总表（当前高亮第 ${state.phase + 1} 步）</summary>${c.data ? table(['阶段', '已写位置', '物理驻留 RSS', '本步次缺页'], c.data.samples.map((s, i) => [courseSteps[i].title, s.written_positions, kib(s.rss_kib), s.action_minor]), state.phase) : ''}</details>
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c, { phase: sample?.phase, stepLabel: step.title })}</div>` : ''}
  </div>${diagnosisHTML(findings)}</div>`;
}

const demandActions = {
  before_alloc: ['申请前', '程序先记录自己的内存状态，作为后面几步的起点。', 'Linux 已经为进程建立了代码、栈等映射，此时还没有这块缓冲区的地址。'],
  allocated: ['申请内存', '调用 malloc 申请 512 MiB，记下返回的指针，暂时不往里面写。', '分配器拿到可用的虚拟地址范围。首次访问时，Linux 才需要为相应的地址准备物理页。'],
  write_quarter: ['写到 ¼', '从开头写到 128 MiB，每隔 4 KiB 写入一个 A。', '写到尚无可写物理页的地址时，CPU 触发缺页异常。Linux 建立可写映射后，程序继续完成这次写入。'],
  write_half: ['写到 ½', '从四分之一处接着写 B，到 256 MiB 停下。前面写过的 A 保留。', '后续地址也开始被访问，更多物理页驻留在内存里。比较本步与上一步的 RSS，就能看到新增的部分。'],
  write_all: ['全部写完', '从一半处接着写 C，到 512 MiB 末尾停下，每个访问位置都已写过。', '新触及的地址也获得了可写映射。此时可以把目标映射的驻留量和最初申请的大小放在一起看。'],
  freed: ['释放后', '程序读回 A、B、C 检查写入结果，再调用 free，最后核对旧地址。', '分配器可以把整段映射还给内核。查看原指针所在的地址，就能判断这次释放后映射是否还在。']
};

function demandSteps(c) {
  return (c.data?.samples || []).map(sample => {
    let [title, program, kernel] = demandActions[sample.phase] || [sample.phase, '程序在这里记录了一次采样。', '可以用本步的原始映射核对驻留量。'];
    if (c.parameters.thp_advice && sample.phase === 'allocated') {
      program = '程序建立一段独立的 512 MiB 匿名映射，再对整段设置透明大页建议。';
      kernel = '映射建立后，内核可以等实际访问时再分配物理页。大页建议和实际驻留量可在下方对照。';
    }
    if (c.parameters.thp_advice && sample.phase === 'freed') {
      program = '程序读回 A、B、C 核对写入值，再用 munmap 释放整个保留区。';
      kernel = 'Linux 撤掉目标映射及两侧保护区。';
    }
    let result;
    if (sample.phase === 'before_alloc') {
      result = '尚未取得目标地址，整进程此时的驻留量为 ' + kib(sample.process_rss_kib) + '。';
    } else if (sample.phase === 'allocated') {
      result = `包含返回指针的整段映射为 ${kib(sample.size_kib)}，其中 ${kib(sample.rss_kib)} 已经驻留。`;
    } else if (sample.phase === 'freed') {
      result = sample.mapping_present ? `原地址仍落在一段映射中，整段驻留 ${kib(sample.rss_kib)}。` : '在本轮 smaps 中，原地址已经没有对应映射。';
      if (c.data.values) result += ` 释放前共核对 ${c.data.values.checked} 个写入位置，发现 ${c.data.values.mismatches} 处不一致。`;
    } else {
      result = `累计写过 ${sample.count} 个位置，本步发生 ${sample.action_minor} 次轻微缺页。`;
      if (sample.huge_kib > 0) result += ` 其中，映射里有 ${kib(sample.huge_kib)} 匿名大页，一张大页覆盖多个写入位置。`;
    }
    return {title, program, kernel, result, sample};
  });
}

function stackSteps(c) {
  const data = c.data;
  if (!data?.samples?.length) return [];
  const [first, ...recursive] = data.samples;
  const steps = [{
    title: '递归前', program: `子进程把软栈上限设为 ${kib(data.condition.limit_kib)}，在进入递归前采样。`,
    kernel: 'Linux 记录进程的栈上限，此时只需为已经访问的栈页提供物理内存。',
    result: `准备进入第 1 层，当前栈映射大小为 ${kib(first.size_kib)}。`, sample: first
  }];
  if (recursive.length) {
    const last = recursive.at(-1);
    steps.push({title: '递归增长', program: `每进入一层，程序建立 ${kib(data.condition.frame_bytes / 1024)} 的局部数组并写入其中几个位置，前面的栈帧一直保留。`,
      kernel: '递归让程序逐步触及新的栈页。在允许的地址范围内，Linux 可以扩展栈映射，并在缺页时分配物理页。',
      result: `最后一次采到第 ${last.count} 层。栈的驻留量从起初的 ${kib(first.rss_kib)} 变为 ${kib(last.rss_kib)}。`, sample: last});
  }
  if (data.outcome) {
    const {signal, exit_code} = data.outcome;
    steps.push({title: '进程结束', program: '父进程用 wait4 等待子进程，读取这次递归的退出状态。',
      kernel: signal === 11 ? '这组递归触及栈上限后，Linux 无法继续扩展栈，向子进程发出 SIGSEGV。' :
        signal ? 'Linux 把终止子进程的信号报告给等待它的父进程。' : '递归返回后，Linux 回收子进程，并把退出码传给父进程。',
      result: signal ? `子进程被信号 ${signal}${signal === 11 ? '（SIGSEGV）' : ''} 终止。` : `子进程正常退出，退出码为 ${exit_code}。`});
  }
  return steps;
}



function demandEnvironmentNav(parameters) {
  const env = state.report.environment || {};
  const options = demandEnvironmentReplays(state.runs, state.id, parameters, state.phase);
  const distro = env.distribution?.PRETTY_NAME || env.system || '环境未记录';
  const contextName = name => ({
    'qemu-tcg': 'QEMU TCG', wsl2: 'WSL2', 'linux-local': '本地 Linux'
  })[name] || name;
  const pageInfo = [
    distro, contextName(env.execution_context), env.kernel,
    Number.isFinite(env.page_bytes) ? '基础页 ' + kib(env.page_bytes / 1024) : null,
    env.thp_enabled ? '系统 THP ' + env.thp_enabled : null
  ].filter(Boolean).join(' · ');
  const links = options.length > 1 ? `<nav class="demand-environments" aria-label="切换同轮实验环境">
    ${options.map(({run, index, step, current}) => {
      const label = [run.distribution, contextName(run.execution_context)].filter(Boolean).join(' · ');
      if (current) return `<span aria-current="true">${esc(label)}</span>`;
      const hash = new URLSearchParams({run: run.id, topic: 'group3', case: index, step});
      return `<a href="/${esc(location.search)}#${esc(hash)}" title="${esc(run.kernel)}">${esc(label)} →</a>`;
    }).join('')}
  </nav><p class="detail-copy">切换环境会保留当前轮次、策略组和采样步骤。两组的条件对照在各自环境内进行。</p>` : '';
  return `<div class="demand-environment"><p class="detail-copy">当前环境 · ${esc(pageInfo)}</p>${links}</div>`;
}

const demandChartMetrics = [
  ['rss_kib', '目标映射 RSS', kib],
  ['huge_kib', '匿名大页驻留量', kib],
  ['action_minor', '本步次缺页', value => value.toLocaleString('zh-CN') + ' 次']
];
const demandChartGroups = ['禁用大页建议', '使用大页建议'];
let demandTimelineView;

function demandChart(rows, activePhase, [metric, label, format], selected) {
  const {readings, maximum} = demandMetricData(rows, metric);
  const bar = (value, index) => {
    const width = value === null || maximum === 0 ? 0 : value / maximum * 100;
    const text = value === null ? (metric === 'action_minor' ? '未记录' : '—') : format(value);
    return `<div class="demand-bar" data-group="${index}">
      <span class="demand-bar-track" aria-hidden="true"><span style="width:${width}%"></span></span>
      <b><span class="demand-chart-group">${demandChartGroups[index]}：</span>${esc(text)}</b>
    </div>`;
  };
  const scale = maximum > 0 ? `统一量程 0 – ${format(maximum)}`
    : readings.some(row => row.values.includes(0)) ? '已有读数均为 0' : '暂无读数';
  return `<div class="demand-chart" data-metric="${metric}"${selected ? '' : ' hidden'}>
    <p class="demand-chart-scale">${esc(scale)}</p>
    <ol class="demand-chart-rows" aria-label="${label}分步对照">
      ${readings.map(({phase, values}) => `<li${phase === activePhase ? ' aria-current="step"' : ''}>
        <strong>${esc(demandActions[phase]?.[0] || phase)}</strong>
        <div>${values.map(bar).join('')}</div>
      </li>`).join('')}
    </ol>
  </div>`;
}

function demandTimeline(c, pair, activePhase) {
  if (state.report.integrity?.status !== 'verified' || state.report.data_origin !== 'real_execution') return '';
  const rows = demandPairTimeline(pair);
  if (!rows.length) return '';
  const rss = sample => sample.mapping_present ? kib(sample.rss_kib) : '无目标映射';
  const huge = sample => sample.mapping_present ? kib(sample.huge_kib) : '—';
  const csvUrl = url('/api/export', {id: state.id, format: 'demand-pair-csv', case: c.id});
  const repeat = c.parameters.repeat;
  if (!demandTimelineView || demandTimelineView.run !== state.id || demandTimelineView.repeat !== repeat) {
    demandTimelineView = {run: state.id, repeat, metric: 'rss_kib', open: false};
  }
  const {metric, open} = demandTimelineView;
  return `<details class="secondary-fold demand-timeline"${open ? ' open' : ''}><summary>对照本轮六个阶段</summary>
    <div class="demand-chart-toolbar">
      <label>比较指标 <select id="demand-chart-metric">${demandChartMetrics.map(([key, label]) =>
        `<option value="${key}"${key === metric ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <ul class="demand-chart-legend" aria-label="策略组图例">${demandChartGroups.map((name, index) =>
        `<li data-group="${index}">${name}</li>`).join('')}</ul>
    </div>
    ${demandChartMetrics.map(spec => demandChart(rows, activePhase, spec, spec[0] === metric)).join('')}
    <p class="detail-copy">RSS 和匿名大页量来自目标映射。每步次缺页取自各自进程。映射尚未建立或已释放时，图中显示「—」，CSV 对应单元格留空。</p>
    <details class="secondary-fold"><summary>查看六阶段数据表</summary>
      ${table(['阶段', '禁用 RSS', '请求 RSS', '禁用大页量', '请求大页量', '禁用次缺页', '请求次缺页'],
        rows.map(({phase, disabled, enabled}) => [demandActions[phase]?.[0] || phase, rss(disabled), rss(enabled),
          huge(disabled), huge(enabled), disabled.action_minor, enabled.action_minor]),
        rows.findIndex(row => row.phase === activePhase))}
    </details>
    <div class="raw-links"><a class="btn-link" href="${esc(csvUrl)}" download>下载本轮两组 CSV</a></div>
  </details>`;
}

function bindDemandTimeline() {
  const timeline = $('.demand-timeline');
  if (!timeline) return;
  const view = demandTimelineView;
  const select = timeline.querySelector('#demand-chart-metric');
  timeline.addEventListener('toggle', () => {
    if (timeline.isConnected) view.open = timeline.open;
  });
  select.addEventListener('change', () => {
    view.metric = select.value;
    for (const chart of timeline.querySelectorAll('.demand-chart')) {
      chart.hidden = chart.dataset.metric !== view.metric;
    }
  });
}

function demandRepeatReview(rows, activePhase, currentRepeat) {
  if (!rows.length) return '';
  const previous = $('#demand-repeat-review');
  const open = previous?.dataset.run === state.id && previous.open;
  const issues = {
    pair: '两组未唯一配对',
    validation: '案例未完成或未通过校验',
    phase: '阶段或写入量不一致'
  };
  const metrics = demandChartMetrics.map(([key, label, format]) => ({
    label, format, ...demandRepeatMetric(rows, key)
  }));
  const signed = (value, format) => (value > 0 ? '+' : value < 0 ? '−' : '') + format(Math.abs(value));
  const matched = rows.filter(row => !row.issue).length;
  return `<details class="secondary-fold demand-repeat-review" id="demand-repeat-review" data-run="${esc(state.id)}"${open ? ' open' : ''}>
    <summary>跨轮核对本步</summary>
    <p class="detail-copy"><strong>${esc(demandActions[activePhase]?.[0] || activePhase)} · ${matched}/${rows.length} 轮可配对</strong>。汇总当前记录中的同一阶段。配对差为使用大页建议组减去禁用组。</p>
    ${matched ? `<dl class="sample-readings demand-repeat-metrics">
      ${metrics.map(({label, format, summary}) => `<div><dt>${label} · 差值中位数</dt>
        <dd>${summary ? signed(summary.median, format) : '—'}</dd>
        <small>${summary ? `范围 ${signed(summary.min, format)} 至 ${signed(summary.max, format)} · ${summary.count} 轮`
          : '没有两组均可用的读数'}</small></div>`).join('')}</dl>` : ''}
    <p class="detail-copy">每格按「禁用 / 使用」列出两组原始读数。「—」表示没有该指标的读数。</p>
    ${table(['轮次', ...metrics.map(({label}) => label), '配对状态'], rows.map(({repeat, issue}, index) => [
      `第 ${repeat} 轮`,
      ...metrics.map(({values, format}) => issue ? '—' : values[index].map(value => value === null ? '—' : format(value)).join(' / ')),
      issue ? issues[issue] : '已配对'
    ]), rows.findIndex(row => row.repeat === currentRepeat))}
  </details>`;
}

function demandEvidencePractice(practice) {
  if (!practice) return '';
  return `<form class="demand-evidence-exercise">
    <p class="detail-copy">在两组 <code>smaps</code> 查本步目标映射的 <code>Rss</code> 与 <code>AnonHugePages</code>。第三项查同阶段 JSONL 的 <code>action_minor</code>，并结合探针的 <code>getrusage</code> 采集口径判断。</p>
    <div class="demand-exercise-fields">
      <label>使用组的 RSS 相对禁用组<select name="rss" required>
        <option value="">请选择</option><option value="-1">更小</option><option value="0">相同</option><option value="1">更大</option>
      </select></label>
      <label>使用组的 AnonHugePages<select name="huge" required>
        <option value="">请选择</option><option value="present">有匿名大页驻留</option><option value="zero">实测为 0 KiB</option>
      </select></label>
      <label>本步次缺页采用的统计范围<select name="scope" required>
        <option value="">请选择</option><option value="mapping">目标 VMA</option><option value="process">各组各自的进程</option>
      </select></label>
    </div>
    <button class="primary" type="submit">核对三项判断</button>
    <div class="demand-exercise-feedback" role="status"></div>
  </form>`;
}

function bindDemandEvidencePractice(practice) {
  const form = $('.demand-evidence-exercise');
  if (!form || !practice) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const answers = new FormData(form);
    const checks = [
      [answers.get('rss') === String(practice.rss), `禁用组 RSS ${kib(practice.disabledRss)}，使用组 RSS ${kib(practice.enabledRss)}。依据是两组目标 VMA 的 Rss。`],
      [answers.get('huge') === practice.huge, `使用组 AnonHugePages 为 ${kib(practice.enabledHuge)}。实际驻留量由这一项读出，madvise 的返回值用于判断建议调用是否成功。`],
      [answers.get('scope') === 'process', '次缺页取自各组进程本步的 getrusage 增量，统计范围覆盖整个进程。']
    ];
    const correct = checks.filter(([passed]) => passed).length;
    form.querySelector('.demand-exercise-feedback').innerHTML =
      `<strong>答对 ${correct} / ${checks.length} 项</strong><ol>${checks.map(([passed, explanation]) =>
        `<li>${passed ? '正确' : '再核对'} · ${esc(explanation)}</li>`).join('')}</ol>`;
  });
}

function demandPolicyPanel(c, sample, rounds, practice) {
  const recipe = c.parameters.thp_advice;
  if (!recipe) {
    const next = newestReplay('3.3', 'group3', 'demand512-thp');
    const collect = state.config?.executor === 'openeuler-vm' || state.config?.host_system === 'Linux'
      ? '<button id="run-demand-thp">采集三轮策略对照</button>' : '';
    return `<section class="seq-panel demand-policy">
      <h2>同样写入 512 MiB，改一个条件再试</h2>
      <p>预测允许透明大页后，次缺页增量和目标映射的 RSS 会怎么变。</p>
      <div class="raw-links">${next ? `<a class="btn-link" href="${esc(next.href)}">查看透明大页实测对照 →</a>` : ''}${collect}</div>
      ${!next && !collect ? '<p class="detail-copy">可在 Linux 运行 <code>python3 work/run_all.py --suite demand512-thp</code> 生成对照。</p>' : ''}
    </section>`;
  }

  const repeat = c.parameters.repeat;
  const pair = demandPair(state.report.cases, c);
  const available = pair.length ? pair : [c];
  const phase = sample?.phase || 'before_alloc';
  const readings = available.map(item => item.data?.samples.find(row => row.phase === phase));
  const policyName = item => item.parameters.thp_advice === 'off' ? '禁用大页建议' : '使用大页建议';
  const matched = demandPairTimeline(pair).find(row => row.phase === phase);
  const observed = matched?.enabled.huge_kib;
  const interpretation = !pair.length ? '本轮缺组或存在重复策略案例，当前仅展示所选案例。'
    : !matched ? '本轮缺少通过校验的配对证据。可查看已有原文和各组状态。'
    : !matched.disabled.mapping_present || !matched.enabled.mapping_present ? '本阶段至少一组缺少目标映射，驻留量无法配对。'
    : observed > 0 ? '使用大页建议组本步采到了匿名大页。对照缺页增量时，注意它是进程级计数。'
    : '使用大页建议组在本步的匿名大页驻留为 0 KiB。可继续查看后续写入阶段。';
  const baseline = newestReplay('3.3', 'group3', 'demand512');
  return `<section class="seq-panel demand-policy" aria-labelledby="policy-title">
    <h2 id="policy-title">512 MiB 透明大页对照 · 第 ${esc(repeat)} 轮</h2>
    <p>两个独立进程各用一个带保护页的匿名映射。按相同的 4096 字节步长分批写入，仅切换映射的大页建议。</p>
    ${demandEnvironmentNav(c.parameters)}
    <div class="demand-prediction"></div>
    <details class="secondary-fold demand-evidence"><summary>${practice ? '读原文，核对三项判断' : pair.length ? '查看本步两组原文' : '查看当前案例原文'}</summary>
    ${available.map((item, i) => `<div class="raw-links"><strong>${policyName(item)}</strong>
      ${evidenceButtons(item, practice ? {phase, stepLabel: demandActions[phase]?.[0]} : {recordKind: 'policy'}, ['jsonl'])}
      ${evidenceButtons(item, {phase, vmaStart: readings[i]?.mapping_header?.split('-')[0]}, ['smaps'])}</div>`).join('')}
    ${demandEvidencePractice(practice)}
    </details>
    <details class="secondary-fold demand-result"><summary>${pair.length ? '查看本步两组采样' : '查看当前案例采样'}</summary>
    ${table(['组别', 'madvise', 'VmFlags', '累计写入位置', '映射 RSS', 'AnonHugePages', '本步次缺页', '检查状态'], available.map((item, i) => {
      const row = readings[i];
      const policy = item?.data?.policy;
      return [policyName(item), !policy ? '未采集' : policy.result === 0 ? '成功' : '失败 · errno ' + policy.errno,
        row?.vm_flags?.filter(flag => flag === 'hg' || flag === 'nh').join(' ') || '—',
        demandMeasurement(row, 'count'), kib(demandMeasurement(row, 'rss_kib')), kib(demandMeasurement(row, 'huge_kib')),
        demandMeasurement(row, 'action_minor'), item.validation?.status === 'passed' ? '通过' : '待核对'];
    }))}
    <p>${esc(interpretation)}</p>
    </details>
    ${demandTimeline(c, pair, phase)}
    ${demandRepeatReview(rounds, phase, repeat)}
    ${baseline ? `<p class="detail-copy"><a href="${esc(baseline.href)}">返回原版 malloc 实验</a></p>` : ''}
  </section>`;
}

function renderMemorySteps(c, cases) {
  const demand = c.suite === 'demand512';
  const controlled = demand && Boolean(c.parameters.thp_advice);
  const steps = demand ? demandSteps(c) : stackSteps(c);
  state.phase = Math.max(0, Math.min(state.phase, steps.length - 1));
  const step = steps[state.phase];
  const sample = step?.sample;
  const rounds = controlled ? demandRepeatReadings(state.report, sample?.phase || 'before_alloc') : [];
  const practice = demandExerciseReadings(rounds.find(row => row.repeat === c.parameters.repeat));
  const title = demand ? '申请 512 MiB，什么时候用上物理页？' : '递归到哪一步，栈会撑不住？';
  const options = cases.map((item, i) => {
    if (item.suite !== c.suite) return '';
    const label = demand ? (item.parameters.thp_advice ? (item.parameters.thp_advice === 'on' ? '使用大页建议 · ' : '禁用大页建议 · ') : '') : `${item.parameters.mode === 'normal' ? '正常返回组' : '栈溢出组'} · 栈上限 ${kib(item.parameters.limit_kib)} · `;
    return `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${esc(label)}第 ${esc(item.parameters.repeat)} 次实验</option>`;
  }).join('');
  const stackIndex = cases.findIndex(x => x.suite === 'stack' && x.parameters.repeat === c.parameters.repeat);
  const stackLink = stackIndex < 0 ? '/labs/3.3?replay=stack' : '/#' + new URLSearchParams({run:state.id, topic:'group3', case:stackIndex});
  const next = state.phase + 1 < steps.length ? `<button class="primary" data-course-step="${state.phase + 1}">下一步 →</button>` :
    demand ? `<a class="btn-link primary" href="${esc(stackLink)}">看栈增长与溢出 →</a>` : '<a class="btn-link primary" href="/lesson">记下实验结果 →</a>';
  const samples = c.data?.samples || [];
  const rows = samples.map(s => [
    demand ? demandActions[s.phase]?.[0] || s.phase : `递归 ${s.count} 层`,
    demand ? demandMeasurement(s, 'count') : s.count,
    demand && !s.mapping_present ? '无映射' : kib(s.size_kib),
    demand ? kib(demandMeasurement(s, 'rss_kib')) : kib(s.rss_kib),
    s.action_minor, s.total_minor
  ]);
  const rawOpts = sample ? {phase:sample.phase, stepLabel:step.title, count:sample.count,
    occurrence:samples.filter(s => s.phase === sample.phase).indexOf(sample),
    vmaStart:sample.mapping_header?.split('-')[0]} : {};
  $('#content').innerHTML = `<section class="seq-reading${demand ? ' lab-replay demand-reading' : ''}">
    <header class="focus-intro"><small class="question-kicker">实验 3.3 · ${demand ? '按需调页' : '栈增长与溢出'} · ${replayOriginLabel(state.report)}</small><h1>${title}</h1></header>
    ${stepNavigation(steps.map(s => s.title), state.phase, 'data-course-step')}
    <section class="seq-panel" id="sequence-result" aria-labelledby="memory-heading">
      <div class="demand-heading"><h2 id="memory-heading">${esc(step?.title || '缺少采样')}</h2><label>回放记录 <select id="case-select">${options}</select></label></div>
      ${controlled ? '<details class="secondary-fold"><summary>查看这一组的单步记录</summary>' : ''}
      ${step ? `${stepExplanation(step.program, step.kernel, step.result)}
        ${sample ? `<dl class="sample-readings"><div><dt>映射大小</dt><dd>${demand && !sample.mapping_present ? '无映射' : kib(sample.size_kib)}</dd></div>
          <div><dt>映射驻留 RSS</dt><dd>${demand && !sample.mapping_present ? '—' : kib(sample.rss_kib)}</dd></div><div><dt>本步次缺页</dt><dd>${esc(sample.action_minor)} 次</dd></div></dl>` : ''}` : '<p>这次没有采到分步记录，可以切换记录或打开原文。</p>'}
      ${c.validation.status !== 'passed' ? `<p class="phase-note">本次核对结果：${esc(c.error?.message || c.validation.status)}</p>` : ''}
      ${controlled ? '</details>' : ''}
      <div class="seq-navigation replay-next">${next}</div>
    </section>
    ${demand ? demandPolicyPanel(c, sample, rounds, practice) : ''}
    <details class="secondary-fold"><summary>完整采样、原文与诊断</summary>
      <div class="raw-links">${evidenceButtons(c, rawOpts)}</div>
      ${table(['采样时刻', demand ? '已写位置' : '递归深度', '映射大小', '映射驻留 RSS', '本步次缺页', '累计次缺页'], rows, sample ? samples.indexOf(sample) : -1)}
      ${diagnosisHTML(findingFor([c.id], ['group3', 'incomplete_evidence']))}
    </details>
    ${demand ? `<details class="secondary-fold" id="original-demand"><summary>课内原程序的五次 ps 输出 · 整个进程</summary>
      <div id="demand-original-ps"></div></details>` : ''}
    ${demand || state.phase + 1 < steps.length ? '<p class="detail-copy"><a href="/lesson">查看思考题与课程笔记</a></p>' : ''}
  </section>`;
  if (demand) {
    bindDemandTimeline();
    bindDemandEvidencePractice(practice);
    loadOriginalPs($('#demand-original-ps'));
  }
}

function renderGroup3() {
  const suites = ['link-dynamic', 'link-static', 'sequence', 'demand512', 'stack'];
  const names = { 'link-dynamic': '3.1 动态链接', 'link-static': '3.1 静态链接', sequence: '3.2 连续 malloc', demand512: '3.3 按需调页 512 MiB', stack: '3.3 栈增长 / 溢出' };
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验第 3 组 · 链接、调页与栈</small>
    <h2>从程序装入到栈溢出</h2>
    <p>对比同一段代码在静态/动态链接下的映射差异；在同进程里连续申请三块内存；按原课例分批写入 512 MiB；以及观察递归深度超过栈限制时的段错误（SIGSEGV）。</p>

  </div>`;
  const cases = state.report.cases.filter(c => suites.includes(c.suite));
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">这份记录里没有第 3 组实验。可在顶部更换记录，或从侧栏重新采集第 3 组。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], d = c.data;
  if (c.suite === 'demand512' || c.suite === 'stack') return renderMemorySteps(c, cases);
  const selector = `<label class="selector"><span>选择要看的实验：</span><select id="case-select">${cases.map((x, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${names[x.suite]} ${x.parameters.mode || ''} ${x.parameters.limit_kib ? x.parameters.limit_kib + ' KiB' : ''} · 第 ${x.parameters.repeat} 次</option>`).join('')}</select></label>`;
  let detail = '';
  if (d?.symbols) detail = table(['对象', '虚拟地址', '权限', '所在映射'], d.symbols.map(x => [x.name, '0x' + x.address, x.mapping.permissions, x.mapping.header])) + `<p class="detail-copy">动态链接器（解释器）：${d.interpreter ? '有' : '无（静态链接）'} · 依赖共享库：${esc(d.needed.join(', ') || '无')}</p><details class="secondary-fold"><summary>展开 ELF 段与运行映射详情</summary><pre>${esc(JSON.stringify(d.segments, null, 2))}</pre></details>`;
  if (d?.actions) detail = table(['动作', '这一步捕获的系统调用'], d.actions.map(x => [x.action, x.syscalls.join('\n') || '无新增系统调用'])) + `<details class="secondary-fold"><summary>展开各阶段三块地址与映射详情</summary><pre>${esc(JSON.stringify(d.samples.map(s => ({ phase: s.phase, program_break: s.program_break, blocks: s.blocks })), null, 2))}</pre></details>`;
  const countLabel = c.suite === 'sequence' ? '已分配块数' : '动作计数';
  const samples = d ? table(['阶段', countLabel, '映射大小', '已驻留物理内存 (RSS)', '本步次缺页', '累计次缺页'], d.samples.map(s => [s.phase, s.count, kib(c.suite === 'sequence' ? s.related_size_kib : s.size_kib), kib(c.suite === 'sequence' ? s.related_rss_kib : s.rss_kib), s.action_minor, s.total_minor])) : '';

  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">
    ${selector}
    <p class="muted">检查状态：${c.validation.status === 'passed' ? '全部核对通过' : esc(c.validation.status)}</p>
    ${samples}${detail}
    <p class="detail-copy">上表统计的是目标内存映射的已驻留物理内存（RSS）。要核对指导书第 12 页的整进程统计，可在<a href="/labs/3.3#original-demand">实验 3.3 页面展开原版五次 ps 输出</a>，或<a href="/lesson">记录思考题小结</a>。</p>
    ${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c)}</div>` : ''}
  </div>${diagnosisHTML(findingFor([c.id], ['group3', 'incomplete_evidence']))}</div>`;
}

function renderGroup4() {
  const names = { 'g4-fork': '4.1 fork / exec / wait', 'g4-pthread': '4.2 pthread 多线程', 'g4-uthread': '4.3 用户级线程', 'g4-pipe': '4.4 匿名管道', 'g4-bank': '4.4 共享账户同步' };
  const modes = { normal: 'exec 成功', 'exec-failure': 'exec 失败对照', unsafe: '故意无锁（观察并发冲突）', mutex: '互斥锁保护', 'round-robin': '协作轮转', blocking: '阻塞调用影响', basic: '传递字符串', eof: '关闭全部写端', eagain: '空管道保留写端', epipe: '忽略 SIGPIPE', sigpipe: '默认 SIGPIPE 终止', comparison: '无锁与互斥对照', condition: '条件变量等待存款', transfer: '按账户顺序加锁防死锁' };
  const events = { begin: '开始', before_exec: 'exec 前', after_exec: 'exec 后', parent_after_fork: '父进程 fork 返回', exec_error: 'exec 失败', summary: '结果', worker_start: '线程启动', worker_end: '线程结束', created: '分配用户栈', dispatch: '调度切换', step: '运行一步', finished: '结束返回', block_begin: '阻塞开始', block_end: '阻塞结束', sent: '发送', received: '接收', empty_with_writer: '有写端的空读', before_write: '无读端的写入', write_result: '写入结果', deposit_worker: '存款线程', counter_result: '计数结果', waiting: '等待余额', deposited: '存入并唤醒', withdrawn: '取款成功', transferred: '转账成功' };
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验第 4 组 · 进程与线程</small>
    <h2>进程与线程怎样隔离和协作？</h2>
    <p>先猜一猜：<code>fork</code> 之后父子进程打印出一样的变量地址，代表它们真的共享同一份物理内存吗？<code>pthread</code> 线程之间，全局变量和局部变量栈各自属于谁？</p>
    <div class="sequence-controls">
      <label>运行范围：<select id="group4-task">${[['all', '第 4 组全部'], ['4.1', '4.1 进程创建与替换'], ['4.2', '4.2 pthread 线程'], ['4.3', '4.3 用户级线程'], ['4.4', '4.4 管道与同步']].map(([v, t]) => `<option value="${v}" ${state.group4Task === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <button id="run-group4" class="primary">运行所选实验</button>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => c.suite.startsWith('g4-'));
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有第 4 组实验，请点顶部“切换记录”选一条“进程与线程”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], d = c.data;
  const selector = `<label class="selector"><span>选择实验项目：</span><select id="case-select">${cases.map((item, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${names[item.suite]} · ${modes[item.parameters.mode]} · 第 ${item.parameters.repeat} 次</option>`).join('')}</select></label>`;

  let headers = ['事件', 'PID', '内核 TID', '线程编号', '值 / 余额', '期望值'];
  let values = r => [events[r.event] || r.event, r.pid, r.tid, r.worker, r.value ?? r.balance, r.expected];
  if (c.suite === 'g4-fork') {
    headers = ['事件', 'PID', 'PPID', '子进程 PID', '私有变量值', '退出码 / errno'];
    values = r => [events[r.event] || r.event, r.pid, r.ppid, r.child_pid, r.value, r.exit_code ?? r.errno];
  } else if (c.suite === 'g4-uthread') {
    headers = ['事件', '内核 TID', '用户线程', '步骤', '栈地址', '相对时间 (ms)'];
    values = r => [events[r.event] || r.event, r.tid, r.worker, r.step, r.stack_address ?? r.stack_base, ((r.time_ns - d.condition.time_ns) / 1e6).toFixed(2)];
  } else if (c.suite === 'g4-pipe') {
    headers = ['事件', 'PID', '读 / 写字节', 'errno', '信号', '传递文本'];
    values = r => [events[r.event] || r.event, r.pid, r.read_bytes ?? r.write_bytes, r.errno, r.signal, r.message];
  } else if (c.suite === 'g4-bank' && c.parameters.mode === 'transfer') {
    headers = ['事件', '线程', '来源 → 目标', '金额', '加锁顺序', '转后双方余额'];
    values = r => [events[r.event] || r.event, r.worker, r.from == null ? '' : r.from + '→' + r.to, r.amount, r.first_lock == null ? '' : r.first_lock + '→' + r.second_lock, r.from_balance == null ? r.value : r.from_balance + ' / ' + r.to_balance];
  }

  let addresses = '';
  if (c.suite === 'g4-pthread' && d) {
    addresses = table(['工作线程', '内核 TID', '全局变量地址（共享）', '共享堆地址', '各自栈地址（独立）'], d.samples.filter(s => s.event === 'worker_start').map(s => [s.worker, s.tid, s.address, s.heap_address, s.stack_address]));
  }
  const unsafe = c.parameters.mode === 'unsafe' || c.parameters.mode === 'comparison';

  $('#content').innerHTML = intro + `<div class="experiment process-events"><div class="observation">
    ${selector}
    <p class="muted">${c.validation.status === 'passed' ? '数据检查通过' : esc(c.validation.status)}${unsafe ? ' · 本组刻意未加锁，用来对照观察数据竞争算错的结果' : ''}</p>
    ${d ? table(headers, d.samples.map(values)) : ''}${addresses}
    ${d ? `<details class="secondary-fold"><summary>展开内核进程状态与汇总 JSON</summary><pre>${esc(JSON.stringify({ status: d.kernel_status, result: d.summary }, null, 2))}</pre></details>` : ''}
    ${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c)}</div>` : ''}
    <div class="explanation-box"><span class="explain-tag">串联前后知识</span><p>fork 后父子各自改写私有变量互不干扰，这验证了父子进程的私有数据相互独立；要观察何时复制页面，再看“写时复制”的 PSS 对照；pthread 共享全局和堆地址、只保留各自独立的栈，可以切到“程序地址”页对照看。</p></div>
  </div>${diagnosisHTML(findingFor([c.id], ['group4', 'incomplete_evidence']))}</div>`;
}

export { renderLayout, renderGroup3, renderGroup4, renderCourse };
