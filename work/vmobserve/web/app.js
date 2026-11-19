import { $, state, labels, url, esc, api, kib, friendlyDistro, friendlyTime, highlightSyscallLine } from './ui.js';
import { renderEvidence } from './evidence-view.js';
import { attachReplayFlow } from './experiment-flow.js';
import { renderSequence, parseMmapCall, groupBlocksIntoRegions } from './sequence-view.js';
import { renderCourse, renderGroup3, renderGroup4, renderLayout } from './course-views.js';
import { renderBaseline, renderTHP } from './memory-views.js';
import { directory, currentLab, viewCases, markLab, renderHome, renderSystems, showLab, newestReplay } from './curriculum.js';

function error(message) {
  $('#error').hidden = !message;
  $('#error').textContent = message || '';
}

function stop() {
  clearInterval(state.timer);
  state.timer = null;
}

const topics = {
  sequence: '连续三次 malloc',
  group3: '链接对比与栈溢出',
  group4: '进程、线程与同步',
  systems: '同步、文件与设备',
  layout: '程序地址都在哪',
  course: '按需分配',
  baseline: '写时复制 COW',
  thp: '透明大页 THP',
  evidence: '原始记录'
};

function supports(r, tab) {
  const suites = r?.suites || [];
  if (tab === 'systems') return suites.some(s => s === 'sync' || s === 'io');
  if (tab === 'group4') return suites.some(s => s.startsWith('g4-'));
  if (tab === 'group3') return suites.some(s => ['link-dynamic', 'link-static', 'demand512', 'stack'].includes(s));
  return tab === 'evidence' || suites.includes(tab);
}

function topicFor(r) {
  return ['sequence', 'group4', 'group3', 'layout', 'course', 'baseline', 'thp', 'systems'].find(t => supports(r, t)) || 'evidence';
}

function setDrawer(open) {
  const drawer = $('#runs-drawer');
  const backdrop = $('#drawer-backdrop');
  const toggle = $('#toggle-runs');
  if (!drawer) return;
  drawer.hidden = !open;
  backdrop.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) {
    history();
    requestAnimationFrame(() => {
      const active = $('#runs .run-row[aria-current="true"]');
      if (active) active.scrollIntoView({ block: 'nearest' });
    });
  }
}

function chooseTopic(tab) {
  ensureReplayChrome();
  stop();
  state.tab = tab;
  state.selected = 0;
  state.phase = 0;
  const filter = $('#environment').value;
  const current = state.runs.find(r => r.id === state.id);
  const match = state.runs.find(r => supports(r, tab) && r.status === 'completed' && !r.environment_issue && (filter === 'all' || r.group === filter))
    || state.runs.find(r => supports(r, tab) && (filter === 'all' || r.group === filter))
    || state.runs.find(r => supports(r, tab));
  if ((!current || !supports(current, tab)) && match) return select(match.id);
  if (!current && state.runs.length) return select(state.runs[0].id);
  render();
  jobUI();
}

function sortedRuns(runs) {
  const rank = (r) => (r.group === 'example' ? 0 : r.group === 'openeuler' ? 1 : 2);
  return [...runs].sort((a, b) => {
    const aHasTab = supports(a, state.tab) ? 0 : 1;
    const bHasTab = supports(b, state.tab) ? 0 : 1;
    return aHasTab - bHasTab || rank(a) - rank(b) || b.run_id.localeCompare(a.run_id);
  });
}

function history() {
  const filter = $('#environment').value;
  const list = sortedRuns(state.runs).filter(r => filter === 'all' || r.group === filter);
  $('#runs').innerHTML = list.map(r => {
    const tag = r.group === 'example' ? '课内推荐样例 · ' : '';
    const distro = friendlyDistro(r.distribution);
    const time = friendlyTime(r.run_id);
    const statusText = labels[r.status] || r.status;
    const compatible = supports(r, state.tab);
    return `<button class="run-row${compatible ? '' : ' run-other'}" data-run="${esc(r.id)}" aria-current="${r.id === state.id}">
      <strong>${esc(topics[topicFor(r)])}${compatible ? '' : '（其他实验）'}</strong>
      <span>${esc(tag + distro)}</span>
      <span>${esc(time)} · ${r.count} 组 · ${esc(statusText)}</span>
    </button>`;
  }).join('') || '<p class="history-empty">当前筛选下没有记录。</p>';
}

function linkedPosition() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const index = (key, fallback = 0) => {
    const raw = hash.get(key);
    return raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : fallback;
  };
  return {
    id: hash.get('run'),
    tab: hash.get('topic'),
    selected: index('case', 0),
    phase: index('step', null)
  };
}

function savePosition() {
  if (!state.id) return;
  const hash = new URLSearchParams({ run: state.id, topic: state.tab });
  if ($('#case-select, [data-select-case]') && state.selected) hash.set('case', state.selected);
  if ($('#phase, [data-course-step], [data-sequence-step]')) hash.set('step', state.phase);
  const next = '#' + hash;
  if (location.hash !== next) window.history.replaceState(null, '', next);
}

async function copyPosition() {
  if (state.timer) { stop(); render(); }
  savePosition();
  const link = location.href;
  try {
    await navigator.clipboard.writeText(link);
    $('#copy-status').textContent = '已复制链接';
    $('#copy-replay').textContent = '已复制链接';
  } catch {
    dialog('复制当前步骤链接', `<p class="detail-copy">把下面这行链接发给同学，打开后就会直接定位到你现在看的实验和这一步：</p><input id="replay-link" aria-label="分享链接" readonly value="${esc(link)}">`);
    $('#replay-link').select();
  }
}

async function refresh() {
  state.runs = await api('/api/runs');
  history();
  if (state.id) return;
  const pos = linkedPosition();
  if (pos.id) return select(pos.id, true, pos);
  if (Object.hasOwn(topics, pos.tab)) return chooseTopic(pos.tab);
  const preferred = state.runs.find(r => r.group === 'example' && supports(r, 'sequence') && r.status === 'completed' && !r.environment_issue)
    || state.runs.find(r => supports(r, 'sequence') && r.status === 'completed')
    || state.runs[0];
  if (preferred) return select(preferred.id, true);
  $('#content').innerHTML = '<p class="empty">还没有实验记录。点左下角“采集新实验数据”即可跑出第一份真实记录。</p>';
}

let selectionRequest = 0, evidenceRequest = 0;

async function select(id, follow = false, pos = {}) {
  const request = ++selectionRequest;
  evidenceRequest++;
  stop();
  const record = state.runs.find(r => r.id === id);
  if (Object.hasOwn(topics, pos.tab)) state.tab = pos.tab;
  else if (follow && !supports(record, state.tab)) state.tab = topicFor(record);
  state.id = id;
  state.report = null;
  state.selected = pos.selected ?? 0;
  state.phase = pos.phase ?? 0;
  error('');
  history();
  setDrawer(false);
  $('#copy-replay').disabled = true;
  $('#copy-status').textContent = '';
  $('#copy-replay').textContent = '复制当前步骤链接';
  $('#mode').textContent = '正在读取记录';
  $('#metadata').textContent = '';
  $('#manifest').textContent = '';
  $('#integrity').textContent = '';
  $('#content').innerHTML = '<p class="empty">正在读取实验数据与映射记录…</p>';
  try {
    const report = await api(url('/api/report', { id }));
    if (request !== selectionRequest) return;
    state.report = report;
    render();
  } catch (e) {
    if (request !== selectionRequest) return;
    state.report = null;
    $('#mode').textContent = '读取记录失败';
    $('#content').textContent = record ? '打不开这份记录的文件。' : '当前工作台找不到链接里的那份记录，请点上方“换一份数据”改选其他记录。';
    error(e.message);
  }
}

$('#toggle-runs').addEventListener('click', () => setDrawer($('#runs-drawer').hidden));
$('#close-drawer').addEventListener('click', () => setDrawer(false));
$('#drawer-backdrop').addEventListener('click', () => setDrawer(false));
$('#copy-replay').addEventListener('click', copyPosition);

let replayStarted = false;
function ensureReplayChrome() {
  document.body.classList.remove('course-reading');
  if (!replayStarted) {
    replayStarted = true;
    $('#run').title = `采集目标：${state.config?.executor || '默认环境'}`;
    api('/api/job').then(j => { state.job = j; jobUI(); }).catch(() => {});
    setInterval(async () => {
      if (document.body.classList.contains('course-reading')) return;
      try {
        const previous = state.job;
        state.job = await api('/api/job');
        jobUI();
        if (previous?.id === activeJobId && previous?.status === 'running' && state.job?.id === activeJobId && state.job.status !== 'running') {
          await refresh();
          const id = state.job.new_run_ids?.[0];
          if (id) {
            const selected = state.report && viewCases(state.report.cases, state.tab, c => c.suite)[state.selected];
            const record = state.runs.find(r => r.id === id);
            const index = record && selected
              ? viewCases(record.case_keys, state.tab, key => key[0]).findIndex(([suite, lab]) => suite === selected.suite && (!lab || lab === selected.parameters?.lab))
              : -1;
            await select(id, true, index >= 0 ? { tab: state.tab, selected: index } : {});
          }
        }
      } catch (e) {
        error('本地服务连接已断开：' + e.message);
      }
    }, 1500);
  }
}

window.addEventListener('hashchange', () => {
  const lab = location.pathname.startsWith('/labs/') ? location.pathname.slice(6) : null;
  if (lab !== null) return;
  const pos = linkedPosition();
  if (!location.hash && state.config) {
    state.id = null;
    stop();
    renderHome();
    return;
  }
  if (pos.id && state.config) { ensureReplayChrome(); select(pos.id, true, pos); }
  else if (Object.hasOwn(topics, pos.tab) && state.config) {
    if (state.runs.length) { ensureReplayChrome(); chooseTopic(pos.tab); }
    else startReplay().catch(e => error(e.message));
  }
});

const envLabels = {
  cross_environment: '跨环境对照',
  matched_conditions: '同环境复验',
  unknown: '早期复验记录'
};

const views = {
  sequence: renderSequence,
  layout: renderLayout,
  course: renderCourse,
  group3: renderGroup3,
  group4: renderGroup4,
  systems: renderSystems,
  baseline: renderBaseline,
  thp: renderTHP,
  evidence: renderEvidence
};

function render() {
  const r = state.report;
  if (!r) return;
  const env = r.environment || {};
  const distro = friendlyDistro(env.distribution?.PRETTY_NAME || env.system);
  const kernel = (env.kernel || '未知').split('-')[0];
  const currentRun = state.runs.find(item => item.id === state.id);
  const prefix = r.data_origin === 'real_execution'
    ? (currentRun?.group === 'example' ? '内置实测回放 · ' : '实测回放 · ')
    : r.data_origin === 'synthetic' ? '模拟记录 · ' : '保存的记录 · ';
  $('#mode').textContent = `${prefix}${distro}`;
  $('#metadata').textContent = `内核 ${kernel} · ${friendlyTime(r.run_id)} · ${labels[r.status] || r.status}`;
  const rel = r.related_run;
  if (rel) $('#metadata').textContent += ' · ' + (envLabels[rel.environment_comparison?.status] || '早期复验');

  if (r.integrity.status === 'verified') {
    $('#integrity').textContent = '本轮实验采样日志与程序文件的校验指纹（SHA-256）核对一致，数据真实完整。';
  } else if (r.integrity.status === 'legacy_partial') {
    $('#integrity').textContent = '这是早期版本保存的记录，采样日志格式检查通过。';
  } else {
    $('#integrity').textContent = `部分文件核对没通过（${r.integrity.errors[0] || '展开下方看明细'}），对应实验不会显示诊断结论。`;
  }

  $('#manifest').textContent = JSON.stringify({
    source_sha256: r.sources,
    integrity_errors: r.integrity.errors,
    related_run: r.related_run
  }, null, 2);

  if (r.integrity.status === 'failed') {
    error('部分原始文件核对未通过：' + r.integrity.errors[0] + '。去“原始记录”可查看各实验状态。');
  }
  $('#page-title').hidden = true;
  views[state.tab]();
  attachReplayFlow();
  const lab = currentLab(state.tab, r, state.selected);
  markLab(lab, state.tab);
  document.title = (lab ? '实验 ' + lab : topics[state.tab]) + ' · 重点任务可视化实验台';
  const singleMode = { sequence: 'sequence', group3: 'group3', course: 'course' }[state.tab];
  $('#run').dataset.mode = singleMode || 'complete';
  $('#run').textContent = singleMode === 'group3' ? '重新采集第 3 组' : singleMode ? '重新采集本项实验' : '采集整套实验';
  savePosition();
  evidenceRequest++;
  $('#copy-replay').disabled = false;
  $('#copy-status').textContent = '';
  $('#copy-replay').textContent = '复制当前步骤链接';
  jobUI();
}

const runModes = {
  'run-cow': 'cow',
  'run-layout': 'layout',
  'run-course': 'course',
  'run-sequence': 'sequence',
  'run-group3': 'group3',
  'run-group4': 'group4',
  'run-policy': 'policy',
  recheck: 'recheck',
  'policy-recheck': 'policy-recheck'
};

$('#content').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (runModes[b.id]) return run(runModes[b.id]);
  if (b.dataset.compareMerge) return compareMerge(b.dataset.compareMerge);
  if (b.dataset.raw) {
    return raw(b.dataset.raw, b.dataset.kind, {
      lineStart: b.dataset.lineStart ? Number(b.dataset.lineStart) : null,
      lineEnd: b.dataset.lineEnd ? Number(b.dataset.lineEnd) : null,
      phase: b.dataset.phase || null,
      role: b.dataset.role,
      recordKind: b.dataset.recordKind,
      occurrence: Number(b.dataset.occurrence || 0),
      count: b.dataset.count === undefined ? null : Number(b.dataset.count),
      vmaStarts: b.dataset.vmaStarts ? b.dataset.vmaStarts.split(',').filter(Boolean) : [],
      stepLabel: b.dataset.stepLabel || null
    });
  }
  if (b.dataset.selectCase !== undefined) {
    stop();
    state.selected = Number(b.dataset.selectCase);
    if (state.tab !== 'sequence') state.phase = 0;
    render();
    const selection = document.querySelector(`[data-select-case="${state.selected}"]`);
    const details = selection?.closest('details');
    if (details) details.open = true;
    selection?.focus({ preventScroll: true });
    return;
  }
  const step = b.dataset.courseStep ?? b.dataset.sequenceStep;
  if (step !== undefined) {
    stop();
    state.phase = Number(step);
    render();
    document.querySelector('.seq-steps [aria-current="step"]')?.focus({ preventScroll: true });
    return;
  }
  if (b.id === 'view-raw') $('#raw-links').hidden = !$('#raw-links').hidden;
  if (b.id === 'play') {
    if (state.timer) { stop(); render(); return; }
    state.timer = setInterval(() => {
      const c = state.report.cases.filter(c => c.suite === 'baseline')[state.selected];
      state.phase = (state.phase + 1) % c.data.samples.length;
      render();
    }, 1400);
    render();
  }
});

$('#content').addEventListener('change', ({ target: t }) => {
  if (t.id === 'group4-task') state.group4Task = t.value;
  if (t.id === 'cow-fraction') state.cowFraction = t.value;
  if (t.id === 'case-select') {
    stop();
    state.selected = Number(t.value);
    state.phase = 0;
    render();
  }
});

$('#content').addEventListener('input', ({ target: t }) => {
  if (t.id === 'phase') { stop(); state.phase = Number(t.value); render(); }
});

function dialog(title, html) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = html;
  $('#raw-dialog').showModal();
}

function extractSmapsSection(lines, phase, vmaStart) {
  const bIdx = lines.findIndex(l => l.includes(`BEGIN phase=${phase}`));
  if (bIdx < 0) return null;
  const eIdx = lines.findIndex((l, i) => i > bIdx && l.trim() === 'END');
  const limit = eIdx > bIdx ? eIdx : lines.length;
  const norm = s => s.toLowerCase().replace(/^0+/, '') || '0';
  const target = norm(vmaStart);
  const headIdx = lines.findIndex((l, i) => {
    if (i <= bIdx || i >= limit) return false;
    const m = /^([0-9a-fA-F]+)-[0-9a-fA-F]+\s/.exec(l);
    return m && norm(m[1]) === target;
  });
  if (headIdx < 0) return null;
  let endIdx = headIdx + 1;
  while (endIdx < limit && !/^[0-9a-fA-F]+-[0-9a-fA-F]+\s/.test(lines[endIdx])) endIdx++;
  return { startLine: headIdx + 1, endLine: endIdx, text: lines.slice(headIdx, endIdx).map((l, i) => `L${headIdx + 1 + i}  ${l}`).join('\n') };
}

function formatSmapsLine(lineText) {
  const escaped = esc(lineText);
  return escaped.replace(/^((?:L\d+\s+)?[0-9a-fA-F]+-[0-9a-fA-F]+\s+\S+.*)$/, '<strong>$1</strong>')
    .replace(/\b(Size|Rss|Pss):\s*(\d+\s*kB)/g, '<span class="smaps-metric">$1: $2</span>');
}

function formatHighlightedRaw(text, kind, opts = {}) {
  const lines = text.split('\n');
  let start = opts.lineStart;
  let end = opts.lineEnd;
  let notice = '';

  const formatBlock = (arr, offset) => arr.map((l, i) => {
    const lineText = `L${offset + i}  ${l}`;
    if (kind === 'syscalls') return highlightSyscallLine(lineText);
    if (kind === 'smaps') return formatSmapsLine(lineText);
    return esc(lineText);
  }).join('\n');

  if (kind === 'jsonl' && (opts.phase || opts.recordKind)) {
    const index = lines.findIndex(line => {
      if (!line.trim()) return false;
      try {
        const event = JSON.parse(line);
        if (opts.recordKind) return event.kind === opts.recordKind;
        return event.kind === 'sample' && event.phase === opts.phase &&
          (!opts.role || event.role === opts.role) && (opts.count == null || event.count === opts.count);
      } catch { return false; }
    });
    if (index >= 0) start = end = index + 1;
  }
  if (!start && opts.phase && kind === 'smaps') {
    let occurrence = opts.occurrence || 0;
    const bIdx = lines.findIndex(l => l.includes(`BEGIN phase=${opts.phase} `) && (!opts.role || l.includes(`role=${opts.role} `)) && occurrence-- === 0);
    const eIdx = bIdx >= 0 ? lines.findIndex((l, i) => i > bIdx && (l.trim() === 'END' || l.includes(`END phase=${opts.phase}`))) : -1;
    if (bIdx >= 0) {
      const snapEnd = eIdx > bIdx ? eIdx : Math.min(lines.length - 1, bIdx + 500);
      if (kind === 'smaps' && opts.vmaStarts?.length) {
        const norm = s => s.toLowerCase().replace(/^0+/, '') || '0';
        const ranges = [];
        opts.vmaStarts.forEach((vs, rank) => {
          const t = norm(vs);
          const hIdx = lines.findIndex((l, i) => {
            if (i <= bIdx || i >= snapEnd) return false;
            const m = /^([0-9a-fA-F]+)-[0-9a-fA-F]+\s/.exec(l);
            return m && norm(m[1]) === t;
          });
          if (hIdx >= 0) {
            let stopIdx = hIdx + 1;
            while (stopIdx < snapEnd && !/^[0-9a-fA-F]+-[0-9a-fA-F]+\s/.test(lines[stopIdx])) stopIdx++;
            ranges.push({ from: hIdx, to: stopIdx - 1, primary: rank === 0, header: lines[hIdx].split(/\s+/)[0] });
          }
        });
        if (ranges.length) {
          ranges.sort((a, b) => a.from - b.from);
          let cursor = 0;
          const chunks = [];
          ranges.forEach(rg => {
            if (rg.from > cursor) chunks.push(`<span>${formatBlock(lines.slice(cursor, rg.from), cursor + 1)}\n</span>`);
            const blockHtml = formatBlock(lines.slice(rg.from, rg.to + 1), rg.from + 1);
            chunks.push(rg.primary ? `<mark id="raw-focus" class="raw-focus">${blockHtml}</mark>` : `<mark class="raw-focus-secondary">${blockHtml}</mark>`);
            cursor = rg.to + 1;
            if (cursor < lines.length) chunks.push('\n');
          });
          if (cursor < lines.length) chunks.push(`<span>${formatBlock(lines.slice(cursor), cursor + 1)}</span>`);
          const primary = ranges.find(r => r.primary) || ranges[0];
          notice = `<div class="raw-locate-banner">已自动定位到<strong>「${esc(opts.stepLabel || '当前步骤')}」</strong>快照中的目标映射 <code>${esc(primary.header)}</code>（第 ${primary.from + 1}–${primary.to + 1} 行），可直观看清整段 Size 与 Rss。</div>`;
          return `${notice}<pre class="raw-pre raw-code-${esc(kind)}">${chunks.join('')}</pre>`;
        }
      }
      start = bIdx + 1;
      end = eIdx >= bIdx ? eIdx + 1 : Math.min(lines.length, start + 40);
    }
  }

  if (start && end && start >= 1 && start <= lines.length) {
    const safeEnd = Math.min(lines.length, Math.max(start, end));
    const before = formatBlock(lines.slice(0, start - 1), 1);
    const focus = formatBlock(lines.slice(start - 1, safeEnd), start);
    const after = formatBlock(lines.slice(safeEnd), safeEnd + 1);
    notice = `<div class="raw-locate-banner">已自动定位到<strong>「${esc(opts.stepLabel || '当前步骤')}」</strong>的第 ${start}–${safeEnd} 行（高亮部分），前后保留了完整的上下文记录。</div>`;
    return `${notice}<pre class="raw-pre raw-code-${esc(kind)}">${before ? `<span>${before}\n</span>` : ''}<mark id="raw-focus" class="raw-focus">${focus}</mark>${after ? `<span>\n${after}</span>` : ''}</pre>`;
  }

  return `<pre class="raw-pre raw-code-${esc(kind)}">${formatBlock(lines, 1)}</pre>`;
}

async function compareMerge(caseId) {
  stop();
  const request = ++evidenceRequest;
  const c = state.report?.cases.find(item => item.id === caseId);
  if (!c?.data) return;
  try {
    const res = await fetch(url('/api/evidence', { id: state.id, case: caseId, kind: 'smaps' }));
    const smapsText = await res.text();
    if (request !== evidenceRequest) return;
    if (!res.ok) throw new Error(smapsText);
    const lines = smapsText.split('\n');
    const s2 = c.data.samples[2], s3 = c.data.samples[3];
    const r2 = groupBlocksIntoRegions(s2).find(r => r.blocks.some(b => b.num === 2));
    const r3 = groupBlocksIntoRegions(s3).find(r => r.blocks.some(b => b.num === 2) && r.blocks.some(b => b.num === 3));
    const mmap2 = parseMmapCall(c.data.actions[1]);
    const mmap3 = parseMmapCall(c.data.actions[2]);
    const sec2 = r2 ? extractSmapsSection(lines, s2.phase, r2.start) : null;
    const sec3 = r3 ? extractSmapsSection(lines, s3.phase, r3.start) : null;
    const html = `
      <div class="raw-locate-banner">第三次申请时，新的 mmap 区间终点 <code>0x${esc(mmap3?.endHex)}</code> 等于上次 mmap 的起点 <code>0x${esc(mmap2?.startHex)}</code>。右侧是申请后覆盖两个块的映射。</div>
      <div class="compare-grid">
        <article class="compare-col">
          <div class="compare-col-head"><span class="step-badge">第 3 步 · 申请 256 KiB 后</span><strong>虚拟 ${kib(r2?.size_kib)} · 已驻留物理内存 ${kib(r2?.rss_kib)}</strong></div>
          <p class="detail-copy">系统调用（L${esc(mmap2?.line)}）：<code>mmap(..., ${esc(mmap2?.bytes)}, ...) = 0x${esc(mmap2?.startHex)}</code></p>
          <pre class="raw-pre raw-code-smaps">${sec2 ? sec2.text.split('\n').map(formatSmapsLine).join('\n') : '未找到对应 smaps 段落'}</pre>
        </article>
        <article class="compare-col">
          <div class="compare-col-head"><span class="step-badge">第 4 步 · 申请 1 MiB 后（合并）</span><strong>虚拟 ${kib(r3?.size_kib)} · 已驻留物理内存 ${kib(r3?.rss_kib)}</strong></div>
          <p class="detail-copy">系统调用（L${esc(mmap3?.line)}）：<code>mmap(..., ${esc(mmap3?.bytes)}, ...) = 0x${esc(mmap3?.startHex)}</code>（终点 <code>0x${esc(mmap3?.endHex)}</code> 紧贴第二次申请对应的 mmap 起点）</p>
          <pre class="raw-pre raw-code-smaps">${sec3 ? sec3.text.split('\n').map(formatSmapsLine).join('\n') : '未找到对应 smaps 段落'}</pre>
        </article>
      </div>`;
    dialog(`${caseId} · 第 3→4 步合并前后原件对比`, html);
  } catch (e) {
    if (request === evidenceRequest) error(e.message);
  }
}

async function raw(caseId, kind, opts = {}) {
  stop();
  const request = ++evidenceRequest;
  const kindNames = { syscalls: '系统调用原文 (strace)', smaps: '原始内存映射 (smaps)', jsonl: '采样事件 (JSONL)', kernel: '内核状态记录', stderr: '程序错误输出' };
  try {
    const res = await fetch(url('/api/evidence', { id: state.id, case: caseId, kind }));
    const text = await res.text();
    if (request !== evidenceRequest) return;
    if (!res.ok) throw new Error(text);
    dialog(`${caseId} · ${kindNames[kind] || kind}`, formatHighlightedRaw(text, kind, opts));
    setTimeout(() => {
      const target = $('#raw-focus');
      if (target) target.scrollIntoView({ block: 'center' });
    }, 30);
  } catch (e) {
    if (request === evidenceRequest) error(e.message);
  }
}

// 仅记录本浏览器会话主动触发或正在后台执行的任务编号，避免遗留历史任务横幅干扰回放阅读
let activeJobId = null;

async function run(mode) {
  stop();
  error('');
  try {
    const pattern = state.tab === 'thp' ? ($('#case-select option:checked')?.dataset.pattern || 'sparse') : 'sparse';
    state.job = await api('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VMObserve-Token': state.config.token },
      body: JSON.stringify({ mode, id: state.id, group4_task: state.group4Task, cow_fraction: state.cowFraction, pattern })
    });
    activeJobId = state.job?.id || null;
    jobUI();
  } catch (e) {
    error(e.message);
  }
}

function jobUI() {
  const job = state.job;
  $('#run').disabled = job?.status === 'running';
  for (const id of [...Object.keys(runModes), 'cow-fraction', 'group4-task']) {
    if ($('#' + id)) $('#' + id).disabled = job?.status === 'running';
  }
  const showBanner = job && job.id === activeJobId;
  $('#job').hidden = !showBanner;
  if (!showBanner) return;
  $('#job').innerHTML = job.status === 'running'
    ? `正在 ${esc(job.target === 'openeuler-vm' ? 'openEuler 虚拟机' : job.target)} 上采集新数据${job.cow_fraction ? `（COW 比例 ${esc(job.cow_fraction)}）` : ''}… 完成前下方继续显示历史记录，跑完会自动切换。`
    : `最近一次采集（${esc(job.id)}）：${esc(labels[job.status] || job.status)}${job.new_run_ids?.includes(state.id) ? ' · 当前页已是这份新结果' : ' · 当前页显示的是其他历史记录'}<details><summary>展开采集输出日志</summary><pre>${esc(job.log || job.error?.message || '')}</pre></details>`;
}

$('#runs').addEventListener('click', e => {
  const button = e.target.closest('[data-run]');
  if (button) select(button.dataset.run, true);
});
$('#environment').addEventListener('change', history);
$('#run').addEventListener('click', e => run(e.currentTarget.dataset.mode || 'complete'));
$('#close-dialog').addEventListener('click', () => $('#raw-dialog').close());
$('#export').addEventListener('click', () => {
  if (!state.report) return;
  dialog('导出当前实验报告', `<p class="detail-copy">选择你要导出的格式：HTML 适合直接阅读或提交报告，CSV 适合用表格软件算账，JSON 保留全部原始字段。</p><div class="export-links">${['html', 'json', 'csv'].map(format => `<a download href="${url('/api/export', { id: state.id, format })}">${format.toUpperCase()} 报告</a>`).join('')}</div>`);
});

async function startReplay() {
  ensureReplayChrome();
  await refresh();
}

try {
  const lab = location.pathname.startsWith('/labs/') ? location.pathname.slice(6) : null;
  directory(lab);
  if ((lab === null && !location.hash) || lab === 'focus') {
    renderHome(lab === 'focus');
    state.config = await api('/api/config');
    if (lab === null && location.hash && !state.id) await startReplay();
  } else if (lab === null) {
    state.config = await api('/api/config');
    await startReplay();
  } else {
    document.body.classList.add('course-reading');
    $('#content').textContent = '正在读取实验记录…';
    [state.config, state.runs] = await Promise.all([api('/api/config'), api('/api/runs')]);
    const suite = new URLSearchParams(location.search).get('replay');
    const topic = ({ sequence: 'sequence', demand512: 'group3', stack: 'group3' })[suite];
    const entry = topic && newestReplay(lab, topic, suite);
    if (entry) {
      window.history.replaceState(null, '', entry.href);
      ensureReplayChrome();
      await select(entry.run.id, true, linkedPosition());
    } else await showLab(lab);
  }
} catch (e) {
  error(e.message);
}
