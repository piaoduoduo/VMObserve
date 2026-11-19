import { $, state, esc, kib, table, evidenceButtons, stepNavigation, stepExplanation, stepControls } from './ui.js';

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
    '先拍一张申请前的内存底图，方便后面几步对照变化。',
    '程序刚启动时，Linux 已经为它建好了代码、栈和动态库等映射（每行就是一段虚拟地址区间）。接下来调用 malloc 后，就能顺着返回指针去查它落在哪一段。',
    `此时还没申请实验块（存活 0 块）。整进程占用的物理内存（RSS，即真实装进内存条里的部分）是 ${kib(sample.process_rss_kib)}；后面步骤只单算实验块涉及的映射。`);
  if (phase === 4) {
    const released = action?.events.filter(e => e.name === 'munmap' && e.success).length;
    return stepExplanation('程序依次调用 free 释放这三块内存，再拿刚才记下的旧地址去查映射。',
      'free 先把块交还给分配器。对于 mmap 开的大块，分配器调用 munmap 让 Linux 撤掉对应地址范围；而堆区（[heap]）通常先留着，供下次 malloc 复用。',
      `现在存活块降到 ${sample.count}。旧地址还能查到 ${regions.length} 段映射，合计 RSS ${kib(sample.related_rss_kib)}${released != null ? `（本步跟踪到 ${released} 次成功的 munmap）` : ''}；注意旧指针已不能再读写。`);
  }
  const block = sample.blocks[phase - 1];
  const program = `程序调用 malloc 申请第 ${phase} 块（${BLOCK_SIZES[phase - 1]}），先记下返回指针，暂时不往里面写数据。`;
  const mechanisms = {
    new_brk_range: '这块内存较小，分配器用 brk 系统调用把堆区（[heap]）末端往后推一截，再从中划出一块交给程序。',
    new_mmap_range: '这块内存较大，分配器改用 mmap 向 Linux 单独开一段匿名映射（不对应磁盘文件），把首地址交给程序；内核按整段区间来记账。',
    no_memory_syscall: '这一步没有发起新的系统调用，分配器直接从前面已经向内核申请好的空闲空间里切出一块。',
    unresolved: '可以用返回指针定位所在映射；这一步的系统调用跟踪不足以单独判断分配器从哪里切出这块空间。'
  };
  const shared = regions.find(r => r.blocks.some(b => b.num === 2) && r.blocks.some(b => b.num === 3));
  const kernel = join ? '两次 mmap 都是可读写私有匿名内存，属性相同且虚拟地址首尾相接，Linux 把两段合成同一个虚拟内存区域（VMA），p2、p3 仍各自独立。'
    : mechanisms[action?.allocation_source] || mechanisms.unresolved;
  const where = block?.mapping;
  const whereLabel = where ? (where.pathname === '[heap]' ? '堆区 [heap]' : where.pathname || '匿名映射') : '匿名映射';
  const result = phase === 3 && shared
    ? `块 2、块 3 的指针都落在 smaps 的 ${shared.start}–${shared.end}。这段整段 RSS 只有 ${kib(shared.rss_kib)}，算总驻留只能加一次，点“对照第三次申请前后”可核对原文。`
    : `返回地址 0x${block?.address ?? sample.address}。${where ? `看下方“${whereLabel}”卡片：smaps 区间为 ${where.start}–${where.end}，这整段的 RSS 是 ${kib(where.rss_kib)}。点“看系统调用原文”和“定位 smaps 原行”可以对照。` : '下方卡片列出了与这个块相交的映射。'}`;
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

function renderObservation(c, phase, runPicker) {
  const data = c.data;
  const sample = data.samples[phase];
  const action = phase > 0 ? data.actions[phase - 1] : null;
  const stepLabel = PHASES[phase];
  const regions = groupBlocksIntoRegions(sample);
  const mmap2 = parseMmapCall(data.actions[1]), mmap3 = parseMmapCall(data.actions[2]);
  const adjacent = phase === 3 && mmap2 && mmap3 && (mmap3.endHex === mmap2.startHex || mmap2.endHex === mmap3.startHex) &&
    regions.some(r => r.blocks.some(b => b.num === 2) && r.blocks.some(b => b.num === 3));

  const join = adjacent && mmap2.privateAnonymousRW && mmap3.privateAnonymousRW;
  const ranges = join ? `<div class="mmap-evidence"><p><strong>把两次 mmap 的地址接起来看</strong></p>
    <p>第 2 块（L${mmap2.line}）：<code>0x${mmap2.startHex} → 0x${mmap2.endHex}</code></p>
    <p>第 3 块（L${mmap3.line}）：<code>0x${mmap3.startHex} → 0x${mmap3.endHex}</code></p>
    <p>${mmap3.endHex === mmap2.startHex ? '第 3 段终点正好接上第 2 段起点' : '第 2 段终点正好接上第 3 段起点'}（右端即下一段首字节，无空隙），合为同一条 smaps。</p></div>` : '';

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
    <div class="demand-heading"><div class="phase-heading"><h2 id="sequence-heading">${esc(stepLabel)}</h2><code>${esc(C_CODE[phase])}</code></div>${runPicker}</div>
    ${allocationLesson(phase, action, sample, regions, join)}
    <div class="${join ? 'merge-evidence-pair' : ''}">${ranges}${mappingDiagram(regions, sample)}</div>
    <p class="map-total">存活 <strong>${esc(sample.count)} 块</strong> · 涉及 <strong>${esc(sample.related_vma_count)} 段映射</strong> · 合计驻留 <strong>${esc(rss)}</strong></p>
    <div class="seq-navigation"><div class="raw-links">${stepRawButtons}</div>
      ${stepControls(phase, data.samples.length + 1)}
    </div>
  </section>
  ${regions.length ? `<details class="secondary-fold"><summary>本步指针与地址范围</summary>${table(['块', 'malloc 返回地址', '所在映射', '映射大小'], regions.flatMap(r =>
    r.blocks.map(b => [`块 ${b.num}${b.alive ? '' : '（已释放）'}`, '0x' + b.address, r.start + '–' + r.end, kib(r.size_kib)])))}</details>` : ''}`;
}

function renderComparison(samples, runPicker) {
  const peak = samples[3], freed = samples[4];
  const stages = table(
    ['采样时刻', '存活块', '相关映射', '映射大小', '整段 RSS'],
    samples.map((s, i) => [PHASES[i], s.count, s.related_vma_count, kib(s.related_size_kib), kib(s.related_rss_kib)])
  );
  return `<section class="seq-panel seq-comparison" id="sequence-result" aria-labelledby="sequence-heading">
    <div class="demand-heading"><h2 id="sequence-heading">对照五步结果</h2>${runPicker}</div>
    ${stepExplanation('三块申请与释放已全部结束，把这五次采样摆在一起对照。',
      '分配器管的是三个指针，Linux 的 smaps 按合并后的整段映射算物理内存（RSS）。汇总时要先找出涉及了几段映射，再逐段相加。',
      peak && freed ? `看“申请 1 MiB”这行：${peak.count} 个块只占 ${peak.related_vma_count} 段映射，RSS 合计 ${kib(peak.related_rss_kib)}（同段只算一次）。释放后存活 ${freed.count} 个块，旧地址还涉及 ${freed.related_vma_count} 段映射、RSS ${kib(freed.related_rss_kib)}。` : '下表列出了这次运行已有的快照。')}
    ${stages}
    <p class="detail-copy">注：表中只算覆盖这些块地址的映射；共处同一段映射的块共用同一份 RSS。释放后分配器可能保留堆区供后续复用。</p>
    <div class="seq-navigation"><button data-sequence-step="3">回看第三次申请</button>${stepControls(samples.length, samples.length + 1, '<a class="btn-link primary" href="/labs/3.3?replay=demand512">继续 3.3 · 第一次写入 →</a>')}</div>
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

  const runPicker = `<label>回放记录 <select id="case-select">${cases.map((item, i) =>
    `<option value="${i}" ${state.selected === i ? 'selected' : ''}>第 ${esc(item.parameters.repeat)} 次实验</option>`).join('')}</select></label>`;
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
      ${comparing ? renderComparison(data.samples, runPicker) : renderObservation(c, state.phase, runPicker)}
      <details class="secondary-fold"><summary>对照各次记录与完整数据</summary>${picker}
        <h3>系统调用与指针</h3>${calls}
        <p class="detail-copy">系统调用跟踪工具：${esc(cleanTracerVersion(state.report.trace_tool?.version))}</p>
        <div class="raw-links">${evidenceButtons(c)}</div>
      </details>
    </section>`;
}

export { parseMmapCall, groupBlocksIntoRegions };
