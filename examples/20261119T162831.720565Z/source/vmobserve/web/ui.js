const $ = (selector) => document.querySelector(selector);
const state = {
  runs: [],
  id: null,
  report: null,
  tab: 'sequence',
  selected: 0,
  phase: 0,
  timer: null,
  job: null,
  sequenceTrial: null,
  config: null,
  cowFraction: 'all',
  group4Task: 'all'
};

const labels = {
  completed: '已跑完',
  completed_with_deviations: '跑完（有偏差）',
  failed: '运行失败',
  timeout: '运行超时',
  cancelled: '已中断',
  unsupported: '环境不支持',
  running: '正在运行',
  not_run: '未运行'
};

const confidence = {
  confirmed: '已确认',
  probable: '可能原因',
  insufficient_evidence: '证据不足'
};

const phases = {
  untouched: '刚建好映射，还没读写',
  read_all: '逐页只读一遍',
  write_quarter: '每 4 页写 1 页',
  write_all: '把每页都写一遍',
  fork_shared: '刚 fork 出来，谁也没改写',
  child_write_quarter: '子进程改写 1/4 页',
  after_write: '按步长写完之后'
};

const esc = (v) => String(v ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kib = (n) => n == null ? '—' : n >= 1024 && n % 1024 === 0 ? `${n / 1024} MiB` : `${n} KiB`;
const url = (route, params) => route + '?' + new URLSearchParams(params);

async function api(route, options) {
  const res = await fetch(route, options);
  const value = await res.json();
  if (!res.ok) throw new Error(value.error || `HTTP ${res.status}`);
  return value;
}

export function stepNavigation(titles, selected, attr = 'data-sequence-step') {
  return `<nav class="seq-steps" aria-label="实验步骤"><ol>${titles.map((title, i) =>
    `<li><button type="button" ${attr}="${i}" aria-controls="sequence-result" ${i === selected ? 'aria-current="step"' : ''}>
      <span class="step-number">${i + 1}</span><span class="step-name">${esc(title)}</span>
    </button></li>`
  ).join('')}</ol></nav>`;
}

export function stepControls(index, count, after = '') {
  return `<div class="step-controls"><button data-course-step="${index - 1}" ${index === 0 ? 'disabled' : ''}>上一步</button>
    ${index + 1 < count ? `<button class="primary" data-course-step="${index + 1}">下一步 →</button>` : after}</div>`;
}

export function sampleReadings(items) {
  return `<dl class="sample-readings">${items.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
}

export function stepExplanation(program, kernel, result) {
  return `<dl class="step-explanation"><div><dt>程序做了什么</dt><dd>${esc(program)}</dd></div>
    <div><dt>Linux 怎么处理</dt><dd>${esc(kernel)}</dd></div>
    <div class="observed"><dt>实际结果</dt><dd>${esc(result)}</dd></div></dl>`;
}

export function thpPairs(cases) {
  const groups = new Map();
  for (const c of cases.filter(c => c.suite === 'thp')) {
    const p = c.parameters;
    const policy = ['allow', 'disable'].includes(p.process_thp);
    const key = [policy, p.pattern, p.repeat].join('/');
    if (!groups.has(key)) groups.set(key, { policy, pattern: p.pattern, cases: [] });
    groups.get(key).cases.push(c);
  }
  return [...groups.values()].sort((a, b) => Number(a.policy) - Number(b.policy));
}

export function missingReading() {
  return `<p class="integrity-warning">这一步缺少可核对的实测结果。<a href="/#${new URLSearchParams({run: state.id, topic: 'evidence'})}">查看原始证据和原因</a></p>`;
}

export function lessonPractice(mode, caption, reading, settings = '') {
  const trial = state.lessonTrial;
  const before = trial?.from === state.id && trial.index === state.selected;
  const after = trial?.to === state.id && trial.toIndex === state.selected;
  const result = after && reading && trial.reading
    ? table(['哪次运行', '观测结果'], [['之前看的实测', trial.reading], ['刚跑的一次', reading]])
    : '';
  return `<div class="lesson-practice">${settings}<button data-lesson-run="${mode}" data-reading="${esc(reading || '')}">${caption}</button>
    ${result}<p class="detail-copy" role="status">${before ? esc(trial.message || '') : ''}${before && trial.failedRun ? ` <a href="/#${new URLSearchParams({run:trial.failedRun,topic:'evidence'})}">查看这次的原始证据</a>` : ''}</p></div>`;
}

function table(headers, rows, highlightIndex = -1) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, idx) => `<tr${idx === highlightIndex ? ' class="row-active"' : ''}>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function friendlyDistro(name) {
  if (!name || name === '环境未核验') return '未记录系统名';
  if (name === '记录损坏') return '记录文件损坏';
  return String(name).replace(/\s*\(LTS\)/i, '').trim();
}

function friendlyTime(runId, withSeconds = false) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(runId || ''));
  if (!m) return String(runId || '未知时间');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  if (Number.isNaN(d.getTime())) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? ':' + pad(d.getSeconds()) : ''}`;
}

function recheckTarget() {
  const kernel = (state.report?.environment?.kernel || '未知').split('-')[0];
  const target = state.config?.executor === 'openeuler-vm' ? 'openEuler 虚拟机' : (state.config?.executor || '本地环境');
  return `当前数据跑在内核 ${esc(kernel)} 上；点按钮会在 ${esc(target)} 重新跑一轮“开/关大页”对照。`;
}

function humanizeFinding(f) {
  const rule = f.rule;
  let title = f.title;
  let explanation = f.explanation || '';
  let limitations = f.limitations || '';
  let nextSteps = f.next_steps || [];

  switch (rule) {
    case 'incomplete_evidence':
      title = '这组实验没跑完整';
      explanation = '缺少完整的采样日志或校验结果，暂无法根据这组数据下结论。';
      limitations = '点开“原始记录”或下方详情，能看到卡在哪一步。';
      break;
    case 'course_task_incomplete':
      title = '程序跑完了，但访问次数或写入值没通过检查';
      explanation = '写入的位置数或页首数值和任务要求对不上。改好循环再跑一次，就能用新数据来核对。';
      limitations = '自动检查只核对了写入位置和数值；想看缺页变化直接看表格里的 RSS 和次缺页两列。';
      break;
    case 'anonymous_zero_page':
      title = '只读一遍没涨 RSS，多半是映射到共享零页了';
      explanation = '只读所有页时确实发生了次缺页，但 RSS 和私有脏页一直是 0 KiB——说明内核把还没写过的匿名页统一指到了共享零页，没有真的给你分物理页。';
      limitations = '看的是只读阶段的次缺页和 0 KiB RSS；因为没抓取物理页帧号（PFN），按严谨标准标为“可能原因”。';
      break;
    case 'cow_accounting':
      explanation = explanation
        .replace('受控现象符合写时复制。', '实测的 PSS 合计刚好等于按写时复制算出来的理论值。')
        .replace('这是不改写的对照，不证明发生了复制。', '子进程这轮压根没写数据，父子还共享着同一份物理页，总内存没有翻倍。');
      limitations = '看的是 fork 后父子进程的 PSS 合计与实际改写页数。';
      break;
    case 'observed_thp':
      explanation = explanation
        .replace('，不能单独用后者判断是否使用透明大页。', '（是否真用了大页看 AnonHugePages，单看 KernelPageSize 容易看走眼）。');
      limitations = '直接读取 smaps 里的 AnonHugePages 数值。';
      break;
    case 'thp_process_disabled':
      title = '进程开关把透明大页挡住了';
      explanation = '虽然代码调了 madvise 想要大页，但进程被设了禁止标志（PR_GET_THP_DISABLE=1，THP_enabled=0），所以 AnonHugePages 一直是 0。';
      limitations = '这是故意关掉进程开关做的对照，拿它和旁边“允许组”比就能看出来。';
      break;
    case 'thp_not_observed':
      title = '想要大页，但 AnonHugePages 还是 0';
      explanation = '缺一组成功分到大页的正例对照，也没看到进程开关日志，所以眼下分不清是被策略挡了还是内核没来得及合并。';
      limitations = '缺正例对照或进程开关记录；跑一次下面的“允许/禁止开关对照”就能分清。';
      nextSteps = [
        '先去“原始记录”看一眼当前系统的全局 THP 设置。',
        '跑一下“进程开关对照”，保持写法不变，只切换允许/禁止大页开关。',
        '如果允许组依然是 0，说明当时内存条件或采样时机没触发大页合并。'
      ];
      break;
    case 'expectation_deviation':
      title = '实测数字和常见情况对不上';
      explanation = explanation.replace('保留观测，不自动归因为内核或程序错误。', '实际跑的时候受分配器和系统状态影响，点开原始记录能看到具体差在哪里。');
      limitations = 'getrusage 统计的是整进程的缺页增量，有时会夹带分配器自身的缺页。';
      break;
    case 'thp_sparse_control':
    case 'thp_full_control':
      limitations = '在相同写入次数下直接对比“关大页”和“开大页”的 RSS 与缺页数（没单独测运行耗时）。';
      break;
    case 'thp_process_control':
      limitations = '只改进程大页开关、其余写法完全一致下的 AnonHugePages 对比。';
      break;
    case 'malloc_mapping':
      title = '找到了 malloc 返回地址落在哪段内存';
      limitations = '看的是返回地址落在哪一段 VMA，以及 program break 有没有往后移。';
      break;
    case 'malloc_demand':
      if (f.confidence === 'insufficient_evidence') {
        title = '申请太小，看不出写入时按页涨内存';
        explanation = explanation.replace('页面可能已驻留，或映射范围发生变化，需要结合其他尺寸对照。', '这组数据没有出现清楚的阶梯变化。对照较大的申请，看看逐步写入后 RSS 怎么变。');
      } else {
        title = '一边往里写，物理内存一边跟着涨';
      }
      limitations = '表格里的 RSS 算的是整段相关映射，缺页数是整进程累计。';
      break;
    case 'malloc_free':
      explanation = explanation.replace('此处只确认映射状态，保留原因属于可能解释。', '释放后这个地址仍在映射区间内。分配器可能保留了它，供后续申请复用。');
      limitations = 'free 之后只拿保存的地址范围去 smaps 里查映射还在不在，不去读写旧指针。';
      break;
    case 'address_mapping':
      title = '7 个地址已经和真实映射、ELF 段一一对上';
      explanation = '代码、只读常量、全局变量和库函数都对应到了可执行文件/动态库的装载段，堆和栈则对应运行时建出来的匿名映射。';
      limitations = '表里都是虚拟地址；同一段映射里的变量共享这一段的物理内存，计算总量时别重复相加。';
      nextSteps = [
        '先自己猜：函数、只读常量、全局变量和栈变量分别该有什么权限？再对照左边的地址分布图。',
        state.report.cases.filter(c=>c.suite==='layout' && c.data).length > 1 ? '换一次实验，对比同一对象的地址和权限。' : '本轮只有一份完整记录。想比较地址，请点“重新采集地址空间实验”。'
      ];
      break;
    case 'layout_permissions':
      limitations = '对比的是实际权限与常见的默认权限（r-x / r-- / rw-），具体原因要结合编译链接选项看。';
      break;
    case 'group3':
      limitations = '表格里的 RSS 是相关映射中已经驻留的内存量；栈溢出看的是不是收到了 SIGSEGV (11) 信号。';
      break;
    case 'group4':
      limitations = '看事件顺序、PID/TID、共享地址和最终余额；其中“故意无锁”组用来观察并发写冲突。';
      nextSteps = ['对照原始日志：fork 的私有变量可联系“写时复制”，pthread 的共享地址和独立栈可联系“程序地址”。'];
      break;
    default:
      break;
  }
  return { ...f, title, explanation, limitations, nextSteps };
}

function diagnosisHTML(findings, recheck = false) {
  const items = findings.map(raw => {
    const f = humanizeFinding(raw);
    return `<article class="finding-card">
      <div class="finding-head"><span class="confidence ${esc(f.confidence)}">${esc(confidence[f.confidence] || f.confidence)}</span></div>
      <h3>${esc(f.title)}</h3>
      <p class="finding-body">${esc(f.explanation)}</p>
      ${f.nextSteps?.length ? `<ol class="finding-steps">${f.nextSteps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      <details class="finding-basis"><summary>看的是哪几个数？</summary><p>${esc(f.limitations)}</p><pre>${esc(JSON.stringify(f.evidence, null, 2))}</pre></details>
    </article>`;
  });
  return `<aside class="diagnostic">
    <h2>助教划重点</h2>
    ${items.join('') || '<p class="empty-note">当前记录缺少可判断的数据，去“原始记录”翻翻日志看看。</p>'}
    ${recheck ? `<div class="recheck-box"><p>${recheckTarget()}</p><button id="recheck">重新跑一轮开/关对照</button></div>` : ''}
  </aside>`;
}

function chart(rows) {
  const max = Math.max(1, ...rows.map(r => r[1] || 0));
  return `<div class="chart" role="img" aria-label="目标区域 RSS 对照"><p class="chart-caption">实际物理内存对比</p>${rows.map(([name, value, kind]) => `<div class="bar-row"><span>${esc(name)}</span><div class="track"><div class="bar ${kind || ''}" style="width:${Math.max(0, (value || 0) / max * 100)}%"></div></div><span class="bar-value">${kib(value)}</span></div>`).join('')}</div>`;
}

function findingFor(cases, rules) {
  return (state.report?.diagnosis?.findings || []).filter(f => rules.includes(f.rule) && f.evidence.some(e => e && cases.includes(e.case_id)));
}

function evidenceButtons(c, opts = {}, kinds = Object.keys(c.artifacts || {})) {
  const names = { kernel: '内核记录', syscalls: '系统调用原文', jsonl: '采样数据 JSONL', smaps: '原始映射 smaps', stderr: '程序错误输出' };
  const attrs = [
    opts.lineStart ? `data-line-start="${esc(opts.lineStart)}"` : '',
    opts.lineEnd ? `data-line-end="${esc(opts.lineEnd)}"` : '',
    opts.phase ? `data-phase="${esc(opts.phase)}"` : '',
    opts.role ? `data-role="${esc(opts.role)}"` : '',
    opts.recordKind ? `data-record-kind="${esc(opts.recordKind)}"` : '',
    opts.vmaStart ? `data-vma-starts="${esc(opts.vmaStart)}"` : '',
    opts.occurrence ? `data-occurrence="${esc(opts.occurrence)}"` : '',
    opts.count != null ? `data-count="${esc(opts.count)}"` : '',
    opts.stepLabel ? `data-step-label="${esc(opts.stepLabel)}"` : ''
  ].filter(Boolean).join(' ');
  return kinds.filter(k => c.artifacts?.[k]).map(k =>
    `<button data-raw="${esc(c.id)}" data-kind="${esc(k)}" ${attrs}>${esc(names[k] || k)}</button>`
  ).join('');
}

// Highlight syscall verbs and hex addresses cleanly inside terminal previews
function highlightSyscallLine(line) {
  const escaped = esc(line);
  return escaped
    .replace(/^(L\d+\s+)/, '<span class="tok-ln">$1</span>')
    .replace(/\b(brk|mmap|munmap|mremap|write)\b/g, '<span class="tok-fn">$1</span>')
    .replace(/(0x[0-9a-fA-F]+)/g, '<span class="tok-hex">$1</span>');
}

// 缓存并渲染指导书 3.3 原版 512 MiB 五次 ps 输出，避免在多个视图中重复请求
let originalPsCache = null;
async function loadOriginalPs(container) {
  if (!container) return;
  try {
    if (!originalPsCache) originalPsCache = await api('/api/lesson?view=observations');
    const original = originalPsCache?.original_ps;
    if (!original) {
      container.textContent = '暂无原版 ps 实测记录。';
      return;
    }
    const phaseMap = { before: '申请前', allocated: '申请完，尚未写入', quarter: '写 A：前 1/4', half: '写 B：累计 1/2', all: '写 C：写完整块' };
    const samples = original.samples || [];
    container.innerHTML = `<p class="muted">历史实测 · ${esc(original.os)} · 内核 ${esc(original.kernel)} · PID ${esc(original.pid)} · THP ${esc(original.thp)}</p>
      <pre>${esc(original.command)}</pre>
      ${table(['暂停点', '进程虚拟大小 VSZ（KiB）', '进程驻留 RSZ（KiB）', '累计次缺页', '累计主缺页'],
        samples.map(s => [phaseMap[s.phase] || s.phase, s.vsz_kib, s.rsz_kib, s.min_flt, s.maj_flt]))}
      <p class="detail-copy">刚申请后整进程驻留（RSZ）只增加 ${esc((samples[1]?.rsz_kib ?? 0) - (samples[0]?.rsz_kib ?? 0))} KiB，分批写入后才逐步上涨。</p>
      <details><summary>核对这五次 ps 的原始输出</summary><pre> MINFL MAJFL RSZ VSZ PID CMD\n${esc(samples.map(s => s.ps_line).join('\n'))}</pre><small class="muted">实测记录编号 ${esc(original.run_id)}</small></details>`;
  } catch (e) {
    container.textContent = '读取原版 ps 记录失败：' + e.message;
  }
}

export {
  $, state, labels, phases, esc, kib, url, api, table,
  friendlyDistro, friendlyTime, recheckTarget, diagnosisHTML, chart, findingFor, evidenceButtons, highlightSyscallLine, loadOriginalPs
};
