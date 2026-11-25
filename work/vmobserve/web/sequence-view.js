import { $, state, esc, kib, table, stepNavigation, stepControls, runTargetLabel } from './ui.js';

const BLOCK_SIZES = ['1 KiB', '256 KiB', '1 MiB'];
const PHASES = ['申请前', '申请 1 KiB', '申请 256 KiB', '申请 1 MiB', '全部释放'];
const C_CODE = [
  'void *p1, *p2, *p3;',
  'p1 = malloc(1 * 1024);',
  'p2 = malloc(256 * 1024);',
  'p3 = malloc(1024 * 1024);',
  'free(p1); free(p2); free(p3);'
];

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
      kernelChooses: /mmap\(NULL,/.test(e.text),
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
      const containsPointer = b.mapping?.start === m.start && b.mapping.end === m.end;
      map.get(key).blocks.push({ num: idx + 1, size: BLOCK_SIZES[idx], address: b.address, alive: b.alive, containsPointer });
    });
  });
  return [...map.values()];
}

export function sequenceRssEquation(sample, regions) {
  const total = kib(sample.related_rss_kib);
  return regions.length > 1 ? regions.map(region => kib(region.rss_kib)).join(' + ') + ' = ' + total : total;
}

function sharedPointerRegion(regions) {
  return regions.find(region => [2, 3].every(num =>
    region.blocks.some(block => block.num === num && block.containsPointer)));
}

const GOALS = [
  '哪些指针落在堆里？拿哪一行地址能证明？',
  '三个指针落在几段映射里？怎么判断两块是否共段？',
  '全部释放后，哪些旧地址还能在映射表里找到？'
];
const GUIDES = [
  '',
  '点 p1，看看哪一行的地址范围包含它（行末 [heap] 说明它在堆里）；要确认这次 malloc 有没有扩大堆，还要去下方看这一步的 brk 记录。',
  '点 p2，再点 p1。看程序拿到的这两个地址分别落在哪一行。',
  '轮流点 p2 和 p3。看图里哪个块亮了，再看下面高亮的映射行有没有换。',
  '三块都已释放。点一个旧地址，查查原来那一段现在还在不在。'
];

function guideText(data, phase) {
  if (phase !== 0) return GUIDES[phase];
  const baseline = data.samples[0]?.visual_regions || [];
  if (!baseline.length) {
    return '此时程序还没有分配 p1、p2、p3。下面的图按本次实验涉及的地址预留了位置，点下一步看第一块内存出现在哪里。';
  }
  const refs = baseline.filter(r => r.pathname !== '[heap]');
  if (refs.length === 1) {
    return `为了不干扰视线，下面只截取后面三块内存附近的位置。此时堆还没建，高地址旁有一段程序启动时已有的 ${kib(refs[0].size_kib)} 匿名映射作参照。`;
  }
  if (refs.length > 1) {
    const total = refs.reduce((sum, r) => sum + (r.size_kib || 0), 0);
    return `为了不干扰视线，下面只截取后面三块内存附近的位置。此时堆还没建，附近已有 ${refs.length} 段程序启动时建好的匿名映射（合计 ${kib(total)}）作参照。`;
  }
  return '为了不干扰视线，下面只截取后面三块内存附近的位置。此时还没有申请 p1、p2、p3。';
}

const hex = value => BigInt('0x' + value);
const contains = (r, address) => hex(r.start) <= hex(address) && hex(address) < hex(r.end);
const regionName = r => r.pathname === '[heap]' ? '堆 [heap]' : r.pathname || '匿名映射';
const range = r => `${r.start}–${r.end}`;
const ptr = address => '0x' + address;

function mapSlots(data) {
  const slots = data.allocations.map((address, i) => ({ address, number: i + 1 }));
  const baseline = data.samples[0].visual_regions || [];
  for (const r of baseline) {
    if (!slots.some(slot => contains(r, slot.address)))
      slots.push({ address: r.start, original: r });
  }
  // A block can span two VMAs. Give any remaining visible range its own place.
  for (const sample of data.samples) {
    for (const r of sample.visual_regions || []) {
      if (!slots.some(slot => contains(r, slot.address))) slots.push({ address: r.start });
    }
  }
  return slots.sort((a, b) => hex(a.address) < hex(b.address) ? -1 : 1);
}

function mappingDiagram(data, phase, join) {
  const sample = data.samples[phase];
  const regions = sample.visual_regions || groupBlocksIntoRegions(sample);
  const slots = mapSlots(data);
  const frames = regions.map(r => {
    const inside = slots.filter(s => contains(r, s.address));
    if (!inside.length) return '';
    const first = slots.indexOf(inside[0]);
    const labels = inside.map((slot, i) => {
      const b = sample.blocks[slot.number - 1];
      const pos = `style="grid-column:${i + 1}"`;
      if (b) return `<button type="button" class="addr-chip ${b.alive ? '' : 'released'} ${join?.high === slot.number ? 'seam' : ''}" ${pos} data-pointer="p${slot.number}" aria-pressed="false"><b>p${slot.number}</b><small>${b.alive ? BLOCK_SIZES[slot.number - 1] : '已释放'}</small></button>`;
      if (slot.original) return `<span class="addr-neighbor" ${pos}>原有区间<small>${kib(slot.original.size_kib)}</small></span>`;
      return '';
    }).join('');
    return `<div class="addr-vma ${r.pathname === '[heap]' ? 'heap' : 'anon'}" style="grid-column:${first + 1} / span ${inside.length}" data-range="${esc(range(r))}">
      <strong>${esc(regionName(r))}<small>${kib(r.size_kib)}</small></strong>${labels}
      <span class="addr-rss">RSS ${kib(r.rss_kib)}</span></div>`;
  }).join('');
  const gaps = [];
  for (let i = 0; i < slots.length; i++) {
    if (regions.some(r => contains(r, slots[i].address))) continue;
    const first = i;
    while (i+1 < slots.length && !regions.some(r => contains(r, slots[i+1].address))) i++;
    const label = !sample.visual_regions ? '未显示映射' : phase === 4 ? '旧地址处已无映射' : '此处尚无映射';
    const old = phase === 4 ? slots.slice(first, i+1).filter(s => s.number).map(s => 'p'+s.number).join(' ') : '';
    gaps.push(`<span class="addr-empty" data-old-pointers="${old}" style="grid-column:${first+1} / span ${i-first+1}">${label}</span>`);
  }
  return `<figure class="address-diagram"><figcaption><strong>指针在地址空间的什么位置？</strong><span>低地址 → 高地址</span></figcaption>
    <div class="addr-grid" style="--slots:${slots.length}">${frames}${gaps.join('')}</div>
    ${join ? `<p class="addr-boundary"><i class="seam-swatch" aria-hidden="true"></i>橙线标出两次 mmap 的共同边界 <code>${ptr(join.seam)}</code>（即使选中右侧块，橙线仍保持可见）。</p>` : ''}
    <p>每个外框对应 maps 里的一行（一段虚拟映射）：框顶是虚拟地址大小，框底 RSS 是真正在内存条里占用的物理大小；按地址从左到右排列，宽度不按比例。</p></figure>`;
}

function joinEvidence(data) {
  const second = parseMmapCall(data.actions[1]), third = parseMmapCall(data.actions[2]);
  const [p2, p3] = data.samples[3].blocks.slice(1);
  if (!p2.mapping || !p3.mapping || range(p2.mapping) !== range(p3.mapping) ||
      !second?.privateAnonymousRW || !third?.privateAnonymousRW) return null;
  if (third.endHex === second.startHex) return { low: 3, high: 2, seam: second.startHex, second, third };
  if (second.endHex === third.startHex) return { low: 2, high: 3, seam: third.startHex, second, third };
  return null;
}

function heapChange(data, phase) {
  const current = data.samples[phase].program_break;
  if (phase === 0) return `申请前的堆顶是 ${ptr(current)}。堆顶是堆在高地址一侧的边界。`;
  const previous = data.samples[phase - 1].program_break;
  const bytes = hex(current) - hex(previous);
  return bytes === 0n ? `堆顶仍在 ${ptr(current)}，这一阶段没有移动。`
    : `堆顶从 ${ptr(previous)} 移到 ${ptr(current)}，${bytes > 0n ? '升高' : '降低'}了 ${kib(Math.abs(Number(bytes)) / 1024)}。`;
}

function explanation(data, phase, join) {
  const sample = data.samples[phase];
  if (phase === 0) return 'Linux 按地址范围（VMA）记录进程可访问的每一段内存。打开 maps，每行开头的两个十六进制数就是这段的起点和终点。接下来用 malloc 返回的指针去核对它落在哪一行。';
  if (phase === 4) {
    const covered = sample.blocks.flatMap((b, i) => b.mapping ? [`p${i + 1}`] : []);
    const gone = sample.blocks.flatMap((b, i) => !b.mapping ? [`p${i + 1}`] : []);
    const removed = data.actions[3].events.filter(e => e.name === 'munmap' && e.success).length;
    const heapKept = sample.blocks.some(b => b.mapping?.pathname === '[heap]');
    const why = gone.length && heapKept
      ? `原因在于回收路径不同：${gone.join('、')} 是通过 mmap 单独申请的大块，free 时 glibc 直接调 munmap 还给内核；${covered.join('、')} 来自堆区 [heap]，free 只还给 glibc 空闲链表留待复用，堆映射并未撤销。`
      : '';
    return `free 把三个块交还给分配器，程序从此不能再读写它们。系统调用记录里有 ${removed} 次成功的 munmap。拿三个旧地址再查 maps，${covered.length ? `还能找到 ${covered.join('、')} 所在的区间` : '三个地址都已查不到'}。${why}`;
  }
  if (join && phase === 3) return `第二次和第三次 malloc 各拿到一个独立的块。两次 mmap 返回的都是可读写的私有匿名区间（rw-p），第 ${join.low} 次的终点正好接上第 ${join.high} 次的起点，中间没有空隙。再看申请后的 smaps，两根指针落在同一行，说明 Linux 把相邻且属性一致的匿名区域合并成了一段映射。`;
  const action = data.actions[phase - 1];
  const source = action.allocation_source;
  let mmapNote = '分配器用 mmap 向 Linux 单独要一片匿名内存，再把可用部分的指针交还给程序。';
  if (source === 'new_mmap_range') {
    const mmapCall = parseMmapCall(action);
    const block = sample.blocks[phase - 1];
    if (mmapCall && block?.address) {
      const offset = hex(block.address) - hex(mmapCall.startHex);
      if (offset > 0n) {
        mmapNote = `分配器用 mmap 向 Linux 单独要一片页对齐的匿名内存（起点 ${ptr(mmapCall.startHex)}），在开头留出 ${offset} 字节（0x${offset.toString(16)}）作块管理头后，把后面的地址 ${ptr(block.address)} 交还给程序。`;
      } else if (offset === 0n) {
        mmapNote = `分配器用 mmap 向 Linux 单独要一片匿名内存，这次返回的指针（${ptr(block.address)}）正好就是这段映射的起点。`;
      }
    }
  }
  let brkNote = '分配器用 brk 抬高堆顶，再从这片 [heap] 空间里切出程序要求的大小。';
  if (source === 'new_brk_range') {
    const brkCall = (action.events || []).find(e => e.name === 'brk');
    const prevBrk = data.samples[phase - 1]?.program_break;
    const currBrk = sample.program_break;
    const callText = brkCall ? `（L${brkCall.line}：${brkCall.text.replace(/\s+/g, ' ').trim()}）` : '';
    const moveText = prevBrk && currBrk && prevBrk !== currBrk ? `，堆顶从 ${ptr(prevBrk)} 推高到 ${ptr(currBrk)}` : '';
    brkNote = `仅看指针落在 [heap] 只能说明“这块在堆里”；要确定这次 malloc 扩大了堆，必须对照这一步的 brk 系统调用记录${callText}${moveText}。点下方“看系统调用原文”可直接核对这一行，堆一次扩出的空间会留给后续小块复用。`;
  }
  return ({
    new_brk_range: brkNote,
    new_mmap_range: mmapNote,
    no_memory_syscall: '分配器直接从已有堆空间切出了这一块，此次调用期间没有触发新的 brk 或 mmap 系统调用（虽然指针也落在 [heap]，但并未扩大堆）。'
  })[source] || '用返回指针能查出它所在的区间。现有系统调用记录没有指明分配器取得这块空间的方式。';
}

function pointerReadout(sample) {
  if (!sample.blocks.length) return '';
  const pointers = sample.blocks.map((block, i) => {
    const m = block.mapping;
    const note = m ? `${ptr(m.start)} ≤ ${ptr(block.address)} < ${ptr(m.end)}。${block.alive ? '指针落在高亮的这一行。' : '块已释放，这个旧地址仍有映射。'}`
      : `p${i+1} 的旧地址 ${ptr(block.address)} 已经没有对应的映射行。`;
    return `<button type="button" data-pointer="p${i+1}" data-mapping="${esc(m?.start || '')}" data-note="${esc(note)}" aria-pressed="false">
      <code>p${i+1} = ${esc(ptr(block.address))}</code></button>`;
  });
  return `<div class="pointer-values" role="group" aria-label="选择要定位的指针">${pointers.join('')}</div>`;
}

function mappingLines(sample) {
  if (!sample.blocks.length) return '';
  const mappings = new Map();
  for (const b of sample.blocks) if (b.mapping) mappings.set(b.mapping.start, b.mapping);
  const rows = [...mappings.values()].sort((a,b) => hex(a.start) < hex(b.start) ? -1 : 1);
  return `<div class="pointer-maps"><strong>对应的 maps 行</strong> <small>取自本步 smaps 快照的区间首行</small>
    ${rows.map(m => `<code data-map-line="${esc(m.start)}">${esc(m.header.trimEnd())}</code>`).join('')}
    <p class="pointer-note" role="status">点指针，看它的地址落在哪一行。</p></div>`;
}

export function locateSequencePointer(button) {
  const panel = button.closest('#sequence-result');
  const name = button.dataset.pointer;
  const output = panel.querySelector(`.pointer-values [data-pointer="${name}"]`);
  const start = output.dataset.mapping;
  panel.querySelectorAll('[data-pointer]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.pointer === name)));
  panel.querySelectorAll('[data-map-line]').forEach(el => el.classList.toggle('located', el.dataset.mapLine === start));
  panel.querySelectorAll('.addr-vma').forEach(frame => frame.classList.toggle('located', !!frame.querySelector('[aria-pressed="true"]')));
  panel.querySelectorAll('[data-old-pointers]').forEach(gap => gap.classList.toggle('located', gap.dataset.oldPointers.split(' ').includes(name)));
  panel.querySelector('.pointer-note').textContent = output.dataset.note;
}

function exerciseRegions(sample) {
  if (sample?.phase !== 'alloc_1MiB' || sample.blocks.length !== 3 ||
      sample.blocks.some(block => !block.mapping)) return [];
  const regions = groupBlocksIntoRegions(sample);
  if (regions.some(region => !Number.isSafeInteger(region.rss_kib))) return [];
  return regions.sort((a, b) => BigInt('0x' + a.start) < BigInt('0x' + b.start) ? -1 : 1);
}

function renderRssExercise(sample, regions) {
  const label = index => '映射 ' + (index + 1);
  const options = regions.map((_, i) => `<option value="${i}">${label(i)}</option>`).join('');
  return `<details class="secondary-fold rss-exercise-fold"><summary>动手自测：自己算一遍三块内存的去重 RSS</summary>
    <div class="rss-exercise" aria-labelledby="rss-exercise-title">
      <p id="rss-exercise-title">用「起始地址 ≤ 指针 &lt; 结束地址」判断三个返回指针的归属，再将与三个块相交的各段映射 RSS 各加一次。</p>
      ${table(['映射', 'smaps 地址区间', '整段 RSS'], regions.map((r, i) =>
        [label(i), r.start + '–' + r.end, kib(r.rss_kib)]))}
      <form class="rss-exercise-form">
        <div class="rss-inputs">${sample.blocks.map((block, i) => `<label>块 ${i + 1} · <code>0x${esc(block.address)}</code>
          <select name="block-${i}" required><option value="">请选择映射</option>${options}</select></label>`).join('')}
        <label>去重后的 RSS（KiB）<input name="rss" type="number" min="0" step="1" required></label></div>
        <button type="submit" class="primary">核对我的答案</button>
        <div class="rss-feedback" aria-live="polite"></div>
      </form>
    </div>
  </details>`;
}

function attachRssExercise(sample, regions) {
  const form = $('.rss-exercise-form');
  if (!form) return;
  const expected = sample.blocks.map(block =>
    regions.findIndex(region => region.start === block.mapping?.start && region.end === block.mapping?.end));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const answers = new FormData(form);
    const entered = Number(answers.get('rss'));
    const wrong = expected.flatMap((index, i) => Number(answers.get('block-' + i)) === index ? [] : [i + 1]);
    const total = regions.reduce((sum, region) => sum + region.rss_kib, 0);
    const groups = regions.filter(region => region.blocks.length > 1);
    const repeated = regions.reduce((sum, region) => sum + region.rss_kib * region.blocks.length, 0);
    const duplicate = entered !== total && entered === repeated && groups.length;
    const correct = !wrong.length && entered === total;
    const matches = expected.map((index, i) => `块 ${i + 1} → 映射 ${index + 1}`).join('，');
    const equation = regions.map(region => region.rss_kib).join(' + ') + ' = ' + total + ' KiB';
    const feedback = correct ? '全部正确。' : [
      wrong.length ? '需重新核对块 ' + wrong.join('、') + ' 的指针归属。' : '三个指针的归属都正确。',
      entered !== total ? 'RSS 合计需重新核对。' : 'RSS 合计正确。',
      duplicate ? groups.map(region => '块 ' + region.blocks.map(block => block.num).join('、') +
        ' 与同一段映射相交，该段 ' + kib(region.rss_kib) + ' 只加一次。').join('') : ''
    ].join('');
    form.querySelector('.rss-feedback').textContent = feedback + ' ' + matches + '。RSS 合计 ' + equation + '。';
  });
}

function renderObservation(c, phase, exerciseHtml = '') {
  const data = c.data, sample = data.samples[phase];
  const action = phase ? data.actions[phase - 1] : null;
  const join = phase === 3 ? joinEvidence(data) : null;
  const related = groupBlocksIntoRegions(sample);
  const starts = (sample.visual_regions || related).slice().sort((a,b) => Number(a.pathname === '[heap]') - Number(b.pathname === '[heap]')).map(r => r.start);
  const raw = `<div class="raw-links"><button data-raw="${esc(c.id)}" data-kind="smaps" data-phase="${esc(sample.phase)}" data-vma-starts="${esc(starts.join(','))}" data-step-label="${esc(PHASES[phase])}">定位 smaps 原行</button>
    <button data-raw="${esc(c.id)}" data-kind="syscalls" ${action ? `data-line-start="${esc(action.begin_line)}" data-line-end="${esc(action.end_line)}"` : ''} data-step-label="${esc(PHASES[phase])}">看系统调用原文</button>
    ${join ? `<button data-compare-merge="${esc(c.id)}">对照第三次申请前后</button>` : ''}</div>`;
  const current = sample.blocks[phase - 1];
  const previousArea = join && data.samples[2].blocks[1].mapping;
  const sizeChange = previousArea && current.mapping.size_kib === previousArea.size_kib + join.third.sizeKib
    ? `<p>第③步这个框已有 ${kib(previousArea.size_kib)}。第三次 mmap 又映射了 ${kib(join.third.sizeKib)}，现在整段是 ${kib(current.mapping.size_kib)}。这是地址范围，驻留量另看 RSS。</p>` : '';
  const evidence = join ? `<div class="mmap-evidence"><p>第 2 次 mmap　<code>${range({start:ptr(join.second.startHex),end:ptr(join.second.endHex)})}</code></p>
    <p>第 3 次 mmap　<code>${range({start:ptr(join.third.startHex),end:ptr(join.third.endHex)})}</code></p>
    <p>共同边界是 <code>${ptr(join.seam)}</code>。这个地址属于较高的区间。首尾相接的是两次 mmap 的范围，p2 和 p3 各自仍有自己的起点和长度。</p>${sizeChange}</div>` : '';
  const formulaBar = phase > 0 && phase < 4 && related.length ? `<div class="rss-formula-bar" aria-label="按映射段去重算式">
    <span class="formula-label">${join ? '去重算式（p2、p3 共用同一段，绝不算两遍）' : '按映射段统计 RSS'}</span>
    <div class="ledger-formula">${related.map(r => {
      const holders = r.blocks.map(b => 'p' + b.num).join('、');
      return `<span class="ledger-pill ${r.pathname === '[heap]' ? 'is-heap' : 'is-mmap'}"><small>${esc(regionName(r))}（${holders}）</small><strong>${kib(r.rss_kib)}</strong></span>`;
    }).join('<span class="ledger-op">+</span>')}<span class="ledger-op">=</span><span class="ledger-total">${kib(sample.related_rss_kib)}</span></div>
  </div>` : '';
  return `<section class="seq-panel" id="sequence-result" aria-labelledby="sequence-heading">
    <div class="demand-heading"><div class="phase-heading"><h2 id="sequence-heading">${PHASES[phase]}</h2><code>${esc(C_CODE[phase])}</code></div></div>
    <p class="phase-note">${esc(guideText(data, phase))}</p>
    ${pointerReadout(sample)}${mappingDiagram(data, phase, join)}${mappingLines(sample)}
    <p class="map-total">程序手中还有 <strong>${sample.count} 块</strong>。${phase === 0 ? '从下一步起，用返回指针找它所在的外框。' : `${phase === 4 ? '按旧地址范围查到' : '这些块共涉及'} <strong>${sample.related_vma_count} 段映射</strong>${phase === 4 ? `（合计 RSS ${kib(sample.related_rss_kib)}）` : ''}。`}</p>${formulaBar}
    <details class="secondary-fold"><summary>${join ? '为什么两个块落在同一段？' : 'Linux 怎么处理这一步？'}</summary>
      <p>${esc(explanation(data, phase, join))}</p><p>${esc(heapChange(data, phase))}</p>
      ${join?.third.kernelChooses ? `<p>为什么 p3 在 p2 ${join.low === 3 ? '前面' : '后面'}？第三次调用的第一个参数是 NULL，分配器请内核挑一块足够大的空地址范围。这一次内核选中了 p2 的${join.low === 3 ? '低' : '高'}地址一侧。再运行一次，可以用两个 mmap 的返回地址检查位置。</p>` : ''}</details>
    <details class="secondary-fold"><summary>查看实测依据与原文</summary>
      ${evidence}${phase ? `<p>按涉及的映射逐段相加，合计 RSS 为 <strong>${esc(sequenceRssEquation(sample, related))}</strong>。</p>` : '<p>采集程序额外保留了这份申请前快照，供后面几步对照。</p>'}${raw}</details>
    ${exerciseHtml}
    <div class="seq-navigation">${stepControls(phase, 6)}</div></section>`;
}

function reproduction() {
  return `<details class="secondary-fold sequence-practice"><summary>在自己的 openEuler 上做一遍</summary>
    <p>开两个终端。A 运行课内程序，B 观察同一个进程。A 每停一次，先在 B 保存一份映射，再回 A 按一次回车。</p>
    <h3>终端 A · 启动课内程序</h3><p>从课程代码包的根目录运行下面三行。看到 PID 和 p1 后，把程序停在这里。</p>
    <pre><code>cd lab3/lab3_2
gcc -O0 -g malloc.c -o malloc
./malloc</code></pre>
    <h3>终端 B · 记下四次暂停</h3><p>在自己的实验记录目录运行第一行，输入 A 打印的 PID。表中每条命令都等 A 停到对应位置再执行。</p>
    <pre><code>read -rp '输入终端 A 打印的 PID：' pid</code></pre>
    ${table(['A 停在哪里','在 B 执行'],[
      ['已打印 p1','cat "/proc/$pid/maps" > p1.maps'],
      ['按一次回车，打印 p2','cat "/proc/$pid/maps" > p2.maps'],
      ['再按一次，打印 p3','cat "/proc/$pid/maps" > p3.maps'],
      ['再按一次，三个 free 已执行，没有新提示','cat "/proc/$pid/maps" > freed.maps']
    ])}
    <p>想算 RSS，在 p3 暂停时一并运行 <code>cat "/proc/$pid/smaps" &gt; p3.smaps</code>。保存 freed.maps 后，回到 A 再按一次回车结束。课内原程序第一次停在 p1 打印之后，网页第①步的申请前照片是采集程序额外记的。</p>
    <h3>用你自己的三个地址交代结果</h3>
    <ol><li>用 <code>cat p3.maps</code> 看映射表。每行开头是十六进制的起点和终点。对 p1、p2、p3 各写一行 <strong>起点 ≤ 指针 &lt; 终点</strong>；末列写着 <code>[heap]</code> 的就是堆。</li>
    <li>比对三个区间的起点和终点。两个端点都相同，就在同一段。选做：从 p3.smaps 找到这几段的 Rss，每段只加一次。</li>
    <li>用 <code>cat freed.maps</code> 再查这三个旧地址，写下谁仍有映射。即使原来的长区间变短，也要用旧地址逐个判断。</li></ol>
    <p>每次运行都用这一次的指针和映射表。原程序先打印 PID，此时分配器可能已经建好了堆。</p></details>`;
}

function comparisonReadings(data) {
  const samples = data.samples, peak = samples[3], freed = samples[4];
  const rows = samples.map((s, i) => [PHASES[i], ptr(s.program_break), s.count, s.related_vma_count, kib(s.related_rss_kib)]);
  const groups = peak.blocks.map((b,i) => `p${i+1}：${b.mapping ? regionName(b.mapping) + ' ' + range(b.mapping) : '没有覆盖指针的映射'}`);
  const retained = freed.blocks.map((b,i) => `p${i+1} ${b.mapping ? '仍有映射' : '已无映射'}`).join('，');
  return `${table(['采样时刻','堆顶地址','存活块','相关映射','整段 RSS'],rows)}
      <p>在第三次申请后的快照中，分别用「起点 ≤ 指针 &lt; 终点」定位：</p>
      <ul>${groups.map((g,i) => `<li><code>${esc(ptr(peak.blocks[i].address))}</code> → ${esc(g)}</li>`).join('')}</ul>
      <p>这 ${peak.count} 个块涉及 ${peak.related_vma_count} 段映射，整段 RSS 合计 ${kib(peak.related_rss_kib)}。释放后，${esc(retained)}。</p>`;
}

function addressTrial(c) {
  const trial = state.sequenceTrial;
  const current = trial?.run === state.id && trial.caseId === c.id ? trial : null;
  const before = state.report.data_origin === 'real_execution' && c.integrity === 'verified' ? c.data?.allocations : null;
  let result = '';
  if (current?.addresses) {
    const after = current.addresses;
    const addressRows = after.map((address, i) => before
      ? ['p' + (i + 1), ptr(before[i]), ptr(address)]
      : ['p' + (i + 1), ptr(address)]);
    const columns = before ? ['指针', '上一次', '刚跑的一次'] : ['指针', '刚跑的一次'];
    result = table(columns, addressRows) +
      `<a class="nav-link" href="/#${new URLSearchParams({ run: current.newId, topic: 'sequence', step: 3 })}">用新地址查看第④步的映射 →</a>`;
  }
  const label = current?.running ? '正在运行…' : before ? '再跑一次，比较地址' : '重新运行一次';
  return `<div class="address-trial"><div class="practice-action"><button id="run-sequence" class="ghost-action">${label}</button><span class="practice-hint">将在${esc(runTargetLabel())}实跑 1 个新进程（约数秒），并在下方列出对比新指针</span></div>
    <div role="status">${current?.error ? `<p>${esc(current.error)} ${current.newId ? `<a href="/#${new URLSearchParams({run: current.newId, topic: 'evidence'})}">查看这次的记录</a>` : ''}</p>` : result}</div></div>`;
}

function conclusionTakeaways(data) {
  if (!data?.samples?.[3] || !data?.samples?.[4]) return '';
  const peak = data.samples[3], freed = data.samples[4];
  const inHeap = peak.blocks.flatMap((b, i) => b.mapping?.pathname === '[heap]' ? [`p${i + 1}`] : []);
  const byRange = new Map();
  peak.blocks.forEach((b, i) => {
    if (!b.mapping) return;
    const key = range(b.mapping);
    byRange.set(key, [...(byRange.get(key) || []), `p${i + 1}`]);
  });
  const shared = [...byRange.values()].filter(list => list.length > 1);
  const kept = freed.blocks.flatMap((b, i) => b.mapping ? [`p${i + 1}`] : []);
  const gone = freed.blocks.flatMap((b, i) => !b.mapping ? [`p${i + 1}`] : []);
  const related = groupBlocksIntoRegions(peak);
  const brkSteps = peak.blocks.flatMap((b, i) => {
    if (b.mapping?.pathname !== '[heap]') return [];
    const act = data.actions?.[i];
    if (act?.allocation_source !== 'new_brk_range') return [];
    const ev = (act.events || []).find(e => e.name === 'brk');
    return [ev ? `p${i + 1} 对应第 ${i + 2} 步 <code>L${ev.line} ${esc(ev.text.replace(/\s+/g, ' ').trim())}</code>` : `p${i + 1}（第 ${i + 2} 步）有新增 brk`];
  });
  const heapDesc = inHeap.length
    ? `${inHeap.join('、')} 落在末列标着 <code>[heap]</code> 的映射行中，证明它位于堆区；${brkSteps.length ? `再核对本步系统调用记录（${brkSteps.join('；')}），确认是那次 <code>malloc</code> 扩大了堆` : '不过对应步骤未抓到新增 <code>brk</code> 扩堆调用（复用了已有堆空间）'}`
    : '本轮未观测到落在 <code>[heap]</code> 的块';
  return `<div class="conclusion-summary"><h3>本次实测的三条核心结论</h3><ol>
    <li><strong>谁落在堆里、是否扩堆：</strong>${heapDesc}。</li>
    <li><strong>几段映射与去重 RSS：</strong>3 个块共涉及 <strong>${peak.related_vma_count} 段映射</strong>${shared.length ? `（${shared.map(g => g.join('、')).join('；')} 区间起止完全相同、共处一段）` : ''}；按映射段只加一次，合计物理驻留为 <strong>${esc(sequenceRssEquation(peak, related))}</strong>。</li>
    <li><strong>全部释放之后：</strong>${kept.length ? `${kept.join('、')} 所在区间仍保留（堆内存留给分配器复用）` : '无保留区间'}${gone.length ? `；${gone.join('、')} 的匿名映射已被 <code>munmap</code> 撤销` : ''}。</li>
  </ol></div>`;
}

function renderComparison(c, readings) {
  return `<section class="seq-panel seq-comparison" id="sequence-result" aria-labelledby="sequence-heading">
    <div class="demand-heading"><h2 id="sequence-heading">整理结论</h2></div>
    ${conclusionTakeaways(c.data)}
    <p>现在换一份新地址来检验刚学会的方法：点下方按钮拿一组新指针，或开双终端在自己的虚拟机上跑一遍，逐一核对「起点 ≤ 指针 &lt; 终点」。</p>
    ${addressTrial(c)}
    <details class="secondary-fold"><summary>对照示例的五步完整数据表</summary>${readings}</details>
    ${reproduction()}
    <p class="detail-copy">想换另一份历史记录检验判断？<a class="nav-link" href="/#${new URLSearchParams({ run: state.id, topic: 'evidence' })}">去原始证据查看或切换记录 →</a></p>
    <div class="seq-navigation">${stepControls(5, 6, '<a class="btn-link primary" href="/labs/3.3?replay=demand512">继续 3.3 · 第一次写入 →</a>')}</div></section>`;
}

function unavailableReading(c, cases) {
  const failed = c.integrity === 'failed';
  const smaps = c.artifacts?.smaps;
  const reason = failed && smaps && c.error?.message?.includes(smaps)
    ? '这次实验的映射记录（smaps）未通过校验'
    : failed ? '这次实验的记录未通过校验' : '这次采集没有留下完整的实测记录';
  const other = cases.findIndex(item => item !== c && item.integrity === 'verified' && item.data?.samples?.length);
  const switchCase = other < 0 ? '' : `<button data-select-case="${other}">看第 ${esc(cases[other].parameters.repeat)} 次实测</button>`;
  const target = state.phase === 5 ? '五步结果' : '这一步的实测结果';
  return `<p class="integrity-warning">${reason}，无法显示${target}。</p>
    ${switchCase}<p><a class="nav-link" href="/#${new URLSearchParams({run: state.id, topic: 'evidence'})}">去原始证据查看原因</a></p>`;
}

export function renderSequence() {
  const cases = state.report.cases.filter(c => c.suite === 'sequence');
  const content = $('#content');
  if (!cases.length) {
    content.innerHTML = '<h2>连续三次 malloc</h2><p>这份记录没有 3.2 的采样。</p><a href="/labs/3.2">打开 3.2 实验</a> · <a href="/#topic=evidence">浏览原始证据</a>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], data = c.data;
  const titles = [...PHASES, '整理结论'];
  state.phase = Math.min(Math.max(0, state.phase), titles.length - 1);
  let step;
  const sample = state.phase < 5 ? data?.samples?.[state.phase] : null;
  const regions = c.validation?.status === 'passed' ? exerciseRegions(sample) : [];
  const exerciseHtml = regions.length ? renderRssExercise(sample, regions) : '';
  if (state.phase === 5) {
    step = renderComparison(c, data ? comparisonReadings(data) : unavailableReading(c, cases));
  } else if (data) {
    step = renderObservation(c, state.phase, exerciseHtml);
  } else {
    step = `<section class="seq-panel" id="sequence-result" aria-labelledby="sequence-heading">
      <div class="phase-heading"><h2 id="sequence-heading">${PHASES[state.phase]}</h2><code>${esc(C_CODE[state.phase])}</code></div>
      ${unavailableReading(c, cases)}<div class="seq-navigation">${stepControls(state.phase, 6)}</div></section>`;
  }
  content.innerHTML = `<section class="malloc-lesson seq-reading sequence-tutorial">
    <header class="focus-intro"><small class="question-kicker">实验 3.2</small>
      <h1>连续三次 malloc，内存去了哪里？</h1>
      <p>程序依次申请 1 KiB、256 KiB 和 1 MiB，再逐块释放。我们跟着三个返回指针，看它们在 Linux 的映射表里落在哪里。</p>
      ${state.phase === 0 ? `<h2>实验目标</h2><ol class="sequence-questions">${GOALS.map(q => `<li>${q}</li>`).join('')}</ol>` : ''}</header>
    ${stepNavigation(titles, state.phase)}
    ${step}
    </section>`;
  if (regions.length) attachRssExercise(sample, regions);
}
export { parseMmapCall, groupBlocksIntoRegions, sharedPointerRegion };
