import { $, state, esc, kib, table, evidenceButtons, stepNavigation, stepExplanation } from './ui.js';

const BLOCK_SIZES = ['1 KiB', '256 KiB', '1 MiB'];
const PHASES = ['申请前', '申请 1 KiB', '申请 256 KiB', '申请 1 MiB', '全部释放'];
const C_CODE = [
  'void *p1, *p2, *p3;',
  'p1 = malloc(1 * 1024);',
  'p2 = malloc(256 * 1024);',
  'p3 = malloc(1024 * 1024);',
  'free(p1); free(p2); free(p3);'
];
const SOURCES = {
  new_brk_range: '通过 brk 系统调用扩展了堆区（[heap]）',
  new_mmap_range: '通过 mmap 系统调用新开辟了匿名映射',
  no_memory_syscall: '未发起新的系统调用（复用了分配器已申请的内存空间）',
  unresolved: '分配来源待核对'
};

function cleanTracerVersion(raw) {
  const firstLine = String(raw || '').split('\n').find(l => l.trim());
  return firstLine || 'strace（未记录版本）';
}

function parseMmapCall(action) {
  for (const e of action?.events || []) {
    if (e.name !== 'mmap' || e.line !== action.source_line) continue;
    const m = /mmap\([^,]+,\s*(\d+),[^=]+=\s*0x([0-9a-fA-F]+)/.exec(e.text);
    if (!m) continue;
    const bytes = Number(m[1]);
    const start = BigInt('0x' + m[2]);
    const len = BigInt(bytes);
    const end = start + len;
    return {
      line: e.line,
      privateAnonymousRW: /PROT_READ\|PROT_WRITE,\s*MAP_PRIVATE\|MAP_ANONYMOUS,/.test(e.text),
      bytes,
      sizeKib: Math.round(bytes / 1024),
      startHex: start.toString(16),
      lenHex: len.toString(16),
      endHex: end.toString(16)
    };
  }
  return null;
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

function allocationLesson(phase, action, sample, regions, join) {
  if (phase === 0) return stepExplanation(
    '程序先记下自己的地址空间，再开始申请三块内存。',
    'Linux 已经为运行中的程序建立了代码、栈等映射。接下来用 malloc 返回的地址去查它落在哪一段。',
    `目前有 ${sample.count} 个实验块。整个进程的驻留量是 ${kib(sample.process_rss_kib)}，与后面只统计目标映射的 RSS 分开看。`);
  if (phase === 4) {
    const released = action?.events.filter(e => e.name === 'munmap' && e.success).length;
    return stepExplanation('程序依次 free 三块内存，再用事先记下的地址查询映射。',
      'free 先把块还给分配器。分配器调用 munmap 时，Linux 撤掉相应的地址范围；保留下来的堆空间可以继续分配。',
      `存活块降到 ${sample.count}。旧地址还涉及 ${regions.length} 段映射，RSS 为 ${kib(sample.related_rss_kib)}。${released != null ? '这一段跟踪里有 ' + released + ' 次成功的 munmap。' : ''}`);
  }
  const block = sample.blocks[phase - 1];
  const program = `程序申请第 ${phase} 块（${BLOCK_SIZES[phase - 1]}），保留返回指针，暂时没有往块里写数据。`;
  const mechanisms = {
    new_brk_range: '这次分配器用 brk 把堆的末端向后移动，再从扩大的堆里切出一块给程序。',
    new_mmap_range: '这次分配器用 mmap 向 Linux 申请一段虚拟地址，再把其中可供程序使用的地址返回。内核按映射区间记账。',
    no_memory_syscall: '这一步没有新的内存系统调用，分配器从手头已有的空间中取出一块。',
    unresolved: '可以用返回地址定位所在映射。本步跟踪还不足以确定分配器从哪里取得这块空间。'
  };
  const shared = regions.find(r => r.blocks.some(b => b.num === 2) && r.blocks.some(b => b.num === 3));
  const kernel = join ? '两次 mmap 都请求可读写的私有匿名内存，地址又首尾相接。Linux 可以用一个虚拟内存区域（VMA）描述这片连续空间。分配器仍然分别管理两块内存。'
    : mechanisms[action?.allocation_source] || mechanisms.unresolved;
  const where = block?.mapping;
  const result = phase === 3 && shared
    ? `块 2 和块 3 的指针都落在 smaps 的 ${shared.start}–${shared.end}。这一段的 RSS 是 ${kib(shared.rss_kib)}，合计时只加一次。`
    : `返回地址 0x${block?.address ?? sample.address}。${where ? 'smaps 里对应' + (where.pathname || '匿名映射') + '，这一整段的 RSS 是 ' + kib(where.rss_kib) + '。' : '下方快照列出与目标块相交的映射。'}`;
  return stepExplanation(program, kernel, result);
}

function mappingDiagram(regions, sample) {
  if (!regions.length) return `<p class="map-empty">${sample.blocks.length ? '原地址处没有目标映射。' : '还没调用 malloc。第一块内存会出现在这里。'}</p>`;
  return `<div class="mapping-list">${regions.map(r => {
    const name = r.pathname === '[heap]' ? '堆区' : r.pathname || '匿名映射';
    return `<article class="mapping-row ${r.pathname === '[heap]' ? 'heap-row' : ''}">
      <div class="mapping-main">
        <div class="mapping-head"><strong>${esc(name)}</strong><code class="mapping-addr">${esc(r.start)}–${esc(r.end)}</code></div>
        <div class="mapping-blocks">${r.blocks.map(b => `<span>块 ${b.num} · ${esc(b.size)}${b.alive ? '' : ' · 已释放'} <code>0x${esc(b.address)}</code></span>`).join('')}</div>
      </div>
      <div class="mapping-rss"><strong>${kib(r.rss_kib)}</strong><small>已驻留物理内存</small></div>
    </article>`;
  }).join('')}</div>`;
}

function renderObservation(c, phase) {
  const data = c.data;
  const sample = data.samples[phase];
  const action = phase > 0 ? data.actions[phase - 1] : null;
  const stepLabel = PHASES[phase];
  const regions = groupBlocksIntoRegions(sample);
  const mmap2 = parseMmapCall(data.actions[1]), mmap3 = parseMmapCall(data.actions[2]);
  const adjacent = phase === 3 && mmap2 && mmap3 && (mmap3.endHex === mmap2.startHex || mmap2.endHex === mmap3.startHex) &&
    regions.some(r => r.blocks.some(b => b.num === 2) && r.blocks.some(b => b.num === 3));

  const join = adjacent && mmap2.privateAnonymousRW && mmap3.privateAnonymousRW;
  const ranges = join ? `<div class="mmap-evidence"><p><strong>把两次 mmap 的地址放在一起看</strong></p>
    <p>第二次申请 · L${mmap2.line} <code>0x${mmap2.startHex} → 0x${mmap2.endHex}</code></p>
    <p>第三次申请 · L${mmap3.line} <code>0x${mmap3.startHex} → 0x${mmap3.endHex}</code></p>
    <p>${mmap3.endHex === mmap2.startHex ? '第三段的终点就是第二段的起点' : '第二段的终点就是第三段的起点'}。右端地址是下一段的第一个字节，两段中间没有空隙。</p></div>` : '';

  // Put newly touched or merged VMA first so raw smaps modal scrolls directly to it
  const vmaStarts = regions
    .slice()
    .sort((a, b) => Number(b.pathname !== '[heap]') - Number(a.pathname !== '[heap]'))
    .map(r => r.start);

  const mergeCompareBtn = join && mmap3.endHex === mmap2.startHex
    ? `<button data-compare-merge="${esc(c.id)}">对照第三次申请前后</button>`
    : '';

  const stepRawButtons = action
    ? `<button data-raw="${esc(c.id)}" data-kind="syscalls" data-line-start="${esc(action.begin_line)}" data-line-end="${esc(action.end_line)}" data-step-label="${esc(stepLabel)}">看系统调用原文</button>
       <button data-raw="${esc(c.id)}" data-kind="smaps" data-phase="${esc(sample.phase)}" data-vma-starts="${esc(vmaStarts.join(','))}" data-step-label="${esc(stepLabel)}">定位 smaps 原行</button>
       ${mergeCompareBtn}`
    : `<button data-raw="${esc(c.id)}" data-kind="smaps" data-phase="${esc(sample.phase)}" data-step-label="${esc(stepLabel)}">对照申请前的 smaps</button>
       <button data-raw="${esc(c.id)}" data-kind="syscalls">查看完整系统调用原文</button>`;

  const shared = regions.some(r => r.blocks.length > 1);
  const rss = shared && regions.length > 1
    ? regions.map(r => kib(r.rss_kib)).join(' + ') + ' = ' + kib(sample.related_rss_kib)
    : kib(sample.related_rss_kib);

  return `<section class="seq-panel" id="sequence-result" aria-labelledby="sequence-heading">
    <div class="phase-heading"><h2 id="sequence-heading">${esc(stepLabel)}</h2><code>${esc(C_CODE[phase])}</code></div>
    ${allocationLesson(phase, action, sample, regions, join)}
    ${ranges}
    ${mappingDiagram(regions, sample)}
    <p class="map-total">存活 <strong>${esc(sample.count)} 块</strong> · 涉及 <strong>${esc(sample.related_vma_count)} 段映射</strong> · 合计驻留 <strong>${esc(rss)}</strong></p>
    <div class="seq-navigation"><div class="raw-links">${stepRawButtons}</div>
      <button class="primary" data-sequence-step="${phase + 1}">${phase === data.samples.length - 1 ? '对照五步结果' : '下一步'} →</button>
    </div>
  </section>
  ${regions.length ? `<details class="secondary-fold"><summary>本步指针与地址范围</summary>${table(['块', 'malloc 返回地址', '所在映射', '映射大小'], regions.flatMap(r =>
    r.blocks.map(b => [`块 ${b.num}${b.alive ? '' : '（已释放）'}`, '0x' + b.address, r.start + '–' + r.end, kib(r.size_kib)])))}</details>` : ''}`;
}

function renderComparison(samples) {
  const peak = samples[3], freed = samples[4];
  const stages = table(
    ['采样时刻', '存活块', '相关映射', '映射大小', '整段 RSS'],
    samples.map((s, i) => [PHASES[i], s.count, s.related_vma_count, kib(s.related_size_kib), kib(s.related_rss_kib)])
  );
  return `<section class="seq-panel seq-comparison" id="sequence-result" aria-labelledby="sequence-heading">
    <div class="phase-heading"><h2 id="sequence-heading">对照五步结果</h2></div>
    ${stepExplanation('程序已经结束。把申请前、三次申请和释放后的快照按顺序摆在一起。',
      '分配器记录每个块，Linux 按整段映射统计驻留内存。先找出涉及的不同映射，再把各段 RSS 相加。',
      peak && freed ? `第三次申请后，${peak.count} 个块涉及 ${peak.related_vma_count} 段映射，RSS 合计 ${kib(peak.related_rss_kib)}。释放后还剩 ${freed.count} 个块，旧地址涉及的映射 RSS 合计 ${kib(freed.related_rss_kib)}。` : '下表列出了这次运行已有的快照。')}
    ${stages}
    <p class="detail-copy">表中只统计覆盖这些块地址的映射。同一段映射里的块共用一份 RSS 读数。释放后，分配器还可能保留堆区，供下次申请使用。</p>
    <div class="seq-navigation"><button data-sequence-step="3">回看第三次申请</button>
      <a class="btn-link primary" href="/labs/3.3?replay=demand512">继续 3.3 · 第一次写入 →</a></div>
  </section>`;
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
      <span class="repeat-label">对照记录</span>
      <div class="repeat-pills">${repeatPills}</div>
    </div>
    ${rerun}
  </div>`;

  if (!data?.samples?.length) {
    content.innerHTML = `<section class="malloc-lesson">${picker}<p class="empty">这次运行没拿到完整数据，点下面按钮看报错或原件。</p><pre>${esc(c.error?.message || c.status)}</pre><div class="raw-links">${evidenceButtons(c)}</div></section>`;
    return;
  }

  const titles = [...PHASES.slice(0, data.samples.length), '结果对照'];
  state.phase = Math.min(Math.max(0, state.phase), titles.length - 1);
  const comparing = state.phase === data.samples.length;

  const calls = table(
    ['动作', '返回指针', '系统调用原文', '实际分配去向'],
    data.actions.map((a, i) => [
      PHASES[i + 1],
      a.returned_address ? '0x' + a.returned_address : '—',
      a.events.map(e => `L${e.line}  ${e.text}`).join('\n') || '复用了已有堆空间，无新增系统调用',
      SOURCES[a.allocation_source] || '释放阶段'
    ]),
    comparing ? -1 : state.phase - 1
  );

  content.innerHTML = `
    <section class="malloc-lesson seq-reading">
      <header class="focus-intro">
        <small class="question-kicker">实验 3.2 · 历史实测回放</small>
        <h1>连续三次 malloc，内存去了哪里？</h1>
      </header>
      ${stepNavigation(titles, state.phase)}
      ${comparing ? renderComparison(data.samples) : renderObservation(c, state.phase)}
      <details class="secondary-fold"><summary>对照各次记录与完整数据</summary>${picker}
        <h3>系统调用与指针</h3>${calls}
        <p class="detail-copy">系统调用跟踪工具：${esc(cleanTracerVersion(state.report.trace_tool?.version))}</p>
        <div class="raw-links">${evidenceButtons(c)}</div>
      </details>
    </section>`;
}

export { parseMmapCall, groupBlocksIntoRegions };
