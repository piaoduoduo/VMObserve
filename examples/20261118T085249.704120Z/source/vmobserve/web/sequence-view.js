import { $, state, labels, esc, kib, table, evidenceButtons, highlightSyscallLine } from './ui.js';

const BLOCK_SIZES = ['1 KiB', '256 KiB', '1 MiB'];
const PHASES = ['申请前', '申请 1 KiB', '申请 256 KiB', '申请 1 MiB', '全部释放'];
const C_CODE = [
  '// 刚进函数，还没调 malloc',
  'p1 = malloc(1 * 1024);        // 要 1 KiB',
  'p2 = malloc(256 * 1024);      // 要 256 KiB',
  'p3 = malloc(1024 * 1024);     // 要 1 MiB',
  'free(p1); free(p2); free(p3); // 全部释放'
];
const SOURCES = {
  new_brk_range: '落在 brk 扩出来的堆区里',
  new_mmap_range: '落在 mmap 新开的映射里',
  no_memory_syscall: '这一步没有观察到新的内存管理调用',
  unresolved: '来源待核对'
};

function cleanTracerVersion(raw) {
  const firstLine = String(raw || '').split('\n').find(l => l.trim());
  return firstLine || 'strace（未记录版本）';
}

function groupBlocksIntoRegions(sample) {
  const map = new Map();
  (sample?.blocks || []).forEach((b, idx) => {
    (b.mappings || []).forEach(m => {
      const key = `${m.start}-${m.end}`;
      if (!map.has(key)) {
        map.set(key, {
          start: m.start,
          end: m.end,
          size_kib: m.size_kib,
          rss_kib: m.rss_kib,
          pathname: m.pathname,
          blocks: []
        });
      }
      map.get(key).blocks.push({ num: idx + 1, size: BLOCK_SIZES[idx], address: b.address, alive: b.alive });
    });
  });
  return [...map.values()];
}

function stepStory(phaseIdx, sample, action, overview) {
  if (phaseIdx === 0) {
    return {
      headline: '还没申请：三块内存都不存在',
      body: '程序刚跑到这里，还没调过 malloc。此时还没有目标块，图中统计为 0；进程本身已经在使用内存。点“下一步”，先看最小的那块 1 KiB 落到哪。'
    };
  }
  if (phaseIdx === 1 || phaseIdx === 2) {
    const number = phaseIdx, source = action?.allocation_source;
    const addr = action?.returned_address ? '0x' + action.returned_address : '未记录';
    const calls = {new_brk_range:'返回地址落在 brk 新扩出的堆区。', new_mmap_range:'返回地址落在这一步 mmap 返回的区间内。', no_memory_syscall:'本步没有新的内存管理系统调用。'};
    return {headline:`第 ${number} 块（${BLOCK_SIZES[number-1]}）落在哪里？`,
      body:`malloc 返回了 ${addr}。${calls[source] || '将返回地址与下面的原始映射区间对照。'} 当前目标块涉及 ${sample.related_vma_count} 段映射，合计驻留 ${kib(sample.related_rss_kib)}。打开本步原文，核对调用和返回值。`};
  }
  if (phaseIdx === 3) {
    const addr = action?.returned_address ? `0x${action.returned_address}` : '未知地址';
    const merged = overview.regions.filter(r => r.blocks.length > 1);
    if (merged.length) {
      const mergedText = merged.map(r => r.blocks.join('、')).join('；');
      return {
        headline: `答案揭晓：三块一共只占了 ${overview.regions.length} 段映射`,
        body: `三次一共申请了 ${overview.requested_kib} KiB。第 ${mergedText} 块落在同一段映射里，所以三个块只对应 ${overview.regions.length} 段映射（映射总大小 ${kib(overview.mapped_kib)}，物理内存实际只用了 ${kib(overview.resident_kib)}）。第三次返回的指针是 ${addr}。点开 smaps，核对两个指针是不是都在同一行的起止地址之间。`
      };
    }
    return {
      headline: `这次三块各自独立，一共占了 ${overview.regions.length} 段映射`,
      body: `三次一共申请了 ${overview.requested_kib} KiB。malloc(1 MiB) 返回 ${addr}，这次三块没合并，各占各的地址区间（物理内存一共用了 ${kib(overview.resident_kib)}）。点开原始映射，对照一下它们的地址。`
    };
  }
  return {
    headline: `全部释放后，原地址还有 ${sample.related_vma_count} 段映射与之相交`,
    body: `free 结束了三个块的使用期。现在按原来的地址范围查看 smaps，重合区域的 RSS 合计 ${kib(sample.related_rss_kib)}。对照下面的系统调用，找出释放时内核收到了哪些请求。`
  };
}

function renderMemoryCanvas(phaseIdx, sample, c) {
  const regions = groupBlocksIntoRegions(sample);
  const heapRegions = regions.filter(r => r.pathname === '[heap]');
  const mmapRegions = regions.filter(r => r.pathname !== '[heap]');
  const newestBlock = phaseIdx >= 1 && phaseIdx <= 3 ? phaseIdx : 0;

  const renderRegionCard = (r, idx, isHeap) => {
    const pct = r.size_kib ? 100 * r.rss_kib / r.size_kib : 0;
    const isMerged = r.blocks.length > 1;
    return `<div class="vma-card ${isHeap ? 'vma-heap' : 'vma-mmap'}${isMerged ? ' vma-merged' : ''}">
      <div class="vma-card-head">
        <span class="vma-badge">${isHeap ? '映射 1 · 堆区 [heap]' : `映射 ${idx + (heapRegions.length ? 2 : 1)} · 匿名 mmap`}</span>
        ${isMerged ? '<span class="merge-tag">这些块在同一段映射里</span>' : ''}
        <code class="vma-range">${esc(r.start)}–${esc(r.end)}</code>
      </div>
      <div class="vma-blocks-stack">
        ${r.blocks.slice().reverse().map(b => `
          <div class="mem-block ${b.alive ? 'alive' : 'freed'}${b.num === newestBlock ? ' is-new' : ''}">
            <div class="mem-block-left">
              <strong>块 ${b.num}（${esc(b.size)}）</strong>
              ${b.num === newestBlock ? '<span class="new-badge">本步新增</span>' : ''}
            </div>
            <code>${b.alive ? `0x${esc(b.address)}` : '已 free（原地址仍有映射）'}</code>
          </div>`).join('')}
      </div>
      <div class="vma-meter">
        <div class="vma-meter-bar"><span style="width:${pct}%"></span></div>
        <small>虚拟范围 ${kib(r.size_kib)} · 其中驻留 ${kib(r.rss_kib)}</small>
      </div>
    </div>`;
  };

  const heapHTML = heapRegions.length
    ? heapRegions.map((r, i) => renderRegionCard(r, i, true)).join('')
    : `<div class="vma-empty"><strong>低地址 · 堆区 [heap]（brk）</strong><span>${phaseIdx === 0 ? '还没调用 malloc，还没有目标块' : '本阶段堆区没有包含目标块'}</span></div>`;

  let mmapHTML = '';
  if (mmapRegions.length) {
    mmapHTML = mmapRegions.map((r, i) => renderRegionCard(r, i, false)).join('');
  } else if (phaseIdx === 4) {
    mmapHTML = `<div class="vma-empty vma-unmapped"><strong>高地址 · 匿名映射区（mmap）</strong><span>本次快照中，原地址没有对应的匿名映射</span></div>`;
  } else {
    mmapHTML = `<div class="vma-empty"><strong>高地址 · 匿名映射区（mmap）</strong><span>这一步还没有目标块落在这里</span></div>`;
  }

  const ratioPct = sample.related_size_kib ? 100 * sample.related_rss_kib / sample.related_size_kib : 0;

  return `<div class="vma-canvas">
    <div class="vma-canvas-head">
      <div>
        <span class="section-label">目标块所在的地址区间 · 第 ${esc(c.parameters.repeat)} 次实验</span>
        <h3>${esc(PHASES[phaseIdx])}</h3>
      </div>
      <div class="vma-kpis">
        <div><small>存活内存块</small><strong>${sample.count} 块</strong></div>
        <div><small>实际占映射</small><strong class="kpi-accent">${sample.related_vma_count} 段</strong></div>
        <div><small>目标映射 RSS</small><strong>${kib(sample.related_rss_kib)}</strong></div>
      </div>
    </div>

    <div class="virt-vs-phys">
      <div class="vvp-labels">
        <span>目标映射合计 <strong>${kib(sample.related_size_kib)}</strong>，其中已驻留 <strong>${kib(sample.related_rss_kib)}</strong></span>
        <span>${sample.related_size_kib ? `${ratioPct.toFixed(1)}% 已驻留物理内存` : '尚未占用'}</span>
      </div>
      <div class="vvp-bar"><span style="width:${sample.related_size_kib ? ratioPct : 0}%"></span></div>
    </div>

    <div class="vma-diagram" aria-label="进程虚拟地址空间分布图">
      <div class="addr-axis-label">↓ 低地址区（堆 brk 往上长）</div>
      ${heapHTML}
      <div class="vma-gap">⋮ &nbsp;中间地址省略：这里只画目标块所在的映射&nbsp; ⋮</div>
      <div class="addr-axis-label">↑ 高地址区（大块 mmap 往下分）</div>
      ${mmapHTML}
    </div>
  </div>`;
}

export function renderSequence() {
  const cases = state.report.cases.filter(c => c.suite === 'sequence');
  const content = $('#content');
  const rerun = '<button id="run-sequence" class="ghost-action">重跑这组实验</button>';
  if (!cases.length) {
    content.innerHTML = '<h2>连续三次 malloc</h2><p>这份记录里没有连续分配实验。点上方“换一份数据”选一条有连续分配的记录，或点下面按钮重跑。</p>' + rerun;
    return;
  }

  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected];
  const data = c.data;

  const repeatPills = cases.map((item, i) =>
    `<button class="repeat-pill" data-select-case="${i}" aria-pressed="${i === state.selected}">第 ${esc(item.parameters.repeat)} 次实验</button>`
  ).join('');

  const picker = `<div class="repeat-toolbar">
    <div class="repeat-group" role="group" aria-label="切换实验次数">
      <span class="repeat-label">换一次实验</span>
      <div class="repeat-pills">${repeatPills}</div>
    </div>
    <span class="picker-hint">比较不同次实验，看看地址是否相同</span>
    ${rerun}
  </div>`;

  if (!data) {
    content.innerHTML = `<section class="malloc-lesson">${picker}<p class="empty">这次运行没拿到完整数据，点下面按钮看报错或原件。</p><pre>${esc(c.error?.message || c.status)}</pre><div class="raw-links">${evidenceButtons(c)}</div></section>`;
    return;
  }

  const o = data.overview;
  state.phase = Math.min(Math.max(0, state.phase), data.samples.length - 1);
  const sample = data.samples[state.phase];
  const action = state.phase > 0 ? data.actions[state.phase - 1] : null;
  const stepLabel = PHASES[state.phase];
  const story = stepStory(state.phase, sample, action, o);

  const steps = data.samples.map((_, i) =>
    `<button data-sequence-step="${i}" ${i === state.phase ? 'aria-current="step"' : ''}><span>${i + 1}</span>${PHASES[i]}</button>`
  ).join('');

  const stepRawButtons = action
    ? `<button class="primary" data-raw="${esc(c.id)}" data-kind="syscalls" data-line-start="${esc(action.begin_line)}" data-line-end="${esc(action.end_line)}" data-step-label="${esc(stepLabel)}">打开这一步的系统调用原文</button>
       <button data-raw="${esc(c.id)}" data-kind="smaps" data-phase="${esc(sample.phase)}" data-step-label="${esc(stepLabel)}">对照这一步的 smaps</button>`
    : `<button class="primary" data-raw="${esc(c.id)}" data-kind="smaps" data-phase="${esc(sample.phase)}" data-step-label="${esc(stepLabel)}">对照申请前的 smaps</button>
       <button data-raw="${esc(c.id)}" data-kind="syscalls">查看完整系统调用原文</button>`;

  const syscallLines = action
    ? (action.events.length
        ? action.events.map(e => highlightSyscallLine(`L${e.line}  ${e.text}`)).join('\n')
        : esc('动作标记之间没有记录到 brk、mmap 或 munmap。'))
    : esc('还没调用 malloc，所以还没有内存分配相关的系统调用。');

  const stages = table(
    ['阶段', '存活块', '映射段数', '虚拟映射大小', '物理内存 (RSS)'],
    data.samples.map((s, i) => [PHASES[i], s.count, s.related_vma_count, kib(s.related_size_kib), kib(s.related_rss_kib)]),
    state.phase
  );

  const calls = table(
    ['动作', '返回指针', '系统调用原文', '落到哪里去了'],
    data.actions.map((a, i) => [
      PHASES[i + 1],
      a.returned_address ? '0x' + a.returned_address : '—',
      a.events.map(e => `L${e.line}  ${e.text}`).join('\n') || '没走系统调用',
      SOURCES[a.allocation_source] || '释放阶段'
    ]),
    state.phase - 1
  );

  content.innerHTML = `
    <section class="malloc-lesson">
      <div class="hero-question">
        <div class="hero-copy">
          <small class="question-kicker">实验 3.2 · 连续三次 malloc</small>
          <h1>三块内存，占几段映射？</h1>
          <p>在同一个进程里连续申请 1 KiB、256 KiB 和 1 MiB（先都不写数据）。点下面五个步骤，看虚拟地址空间是怎么一段段长出来、又怎么拼在一起的。</p>
        </div>
      </div>

      ${picker}

      <div class="stepper-bar">
        <nav class="step-strip" aria-label="实验步骤">${steps}</nav>
        <div class="step-arrows">
          <button data-sequence-step="${state.phase - 1}" ${state.phase === 0 ? 'disabled' : ''}>← 上一步</button>
          <button class="primary" data-sequence-step="${state.phase + 1}" ${state.phase === data.samples.length - 1 ? 'disabled' : ''}>下一步 →</button>
        </div>
      </div>

      <div class="seq-stage">
        ${renderMemoryCanvas(state.phase, sample, c)}

        <aside class="step-story">
          <div class="step-story-head">
            <span class="step-badge">第 ${state.phase + 1} / ${data.samples.length} 步</span>
            <h3>${esc(story.headline)}</h3>
          </div>
          <p class="story-body">${esc(story.body)}</p>

          <div class="code-to-kernel">
            <div class="code-line"><span>C 代码</span><code>${esc(C_CODE[state.phase])}</code></div>
            ${action?.returned_address ? `<div class="code-line"><span>拿到指针</span><code>0x${esc(action.returned_address)}</code></div>` : ''}
          </div>

          <div class="step-syscall-preview">
            <div class="preview-head">
              <span>${action ? `这一步截获的内核系统调用（第 ${action.begin_line}–${action.end_line} 行）` : '系统调用记录'}</span>
            </div>
            <pre class="terminal-pre">${syscallLines}</pre>
          </div>

          <div class="raw-links">${stepRawButtons}</div>
        </aside>
      </div>

      <details class="secondary-fold"><summary>展开五步数据对照表（当前高亮第 ${state.phase + 1} 步）</summary>${stages}</details>
      <details class="secondary-fold"><summary>展开四次动作的系统调用与返回指针</summary>${calls}</details>
      <details class="secondary-fold"><summary>查看底层工具与全部原始文件</summary><p class="detail-copy">系统调用跟踪器：<code>${esc(cleanTracerVersion(state.report.trace_tool?.version))}</code></p><div class="raw-links">${evidenceButtons(c)}</div></details>
    </section>`;
}
