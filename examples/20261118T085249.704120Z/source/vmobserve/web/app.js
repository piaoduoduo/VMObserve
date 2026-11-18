import { $, state, labels, url, esc, api, friendlyDistro, friendlyTime, highlightSyscallLine } from './ui.js';
import { renderEvidence } from './evidence-view.js';
import { renderSequence } from './sequence-view.js';
import { renderCourse, renderGroup3, renderGroup4, renderLayout } from './course-views.js';
import { renderBaseline, renderTHP } from './memory-views.js';

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
  layout: '程序地址都在哪',
  course: '按需分配',
  baseline: '写时复制 COW',
  thp: '透明大页 THP',
  evidence: '原始记录'
};

function supports(r, tab) {
  const suites = r?.suites || [];
  if (tab === 'group4') return suites.some(s => s.startsWith('g4-'));
  if (tab === 'group3') return suites.some(s => ['link-dynamic', 'link-static', 'demand512', 'stack'].includes(s));
  return tab === 'evidence' || suites.includes(tab);
}

function topicFor(r) {
  return ['sequence', 'group4', 'group3', 'layout', 'course', 'baseline', 'thp'].find(t => supports(r, t)) || 'evidence';
}

function defaultPhaseFor(tab) {
  return tab === 'sequence' ? 3 : 0;
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
  stop();
  state.tab = tab;
  state.selected = 0;
  state.phase = defaultPhaseFor(tab);
  const filter = $('#environment').value;
  const current = state.runs.find(r => r.id === state.id);
  const match = state.runs.find(r => supports(r, tab) && r.status === 'completed' && !r.environment_issue && (filter === 'all' || r.group === filter))
    || state.runs.find(r => supports(r, tab) && (filter === 'all' || r.group === filter))
    || state.runs.find(r => supports(r, tab));
  if (!supports(current, tab) && match) return select(match.id);
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
  state.phase = pos.phase !== null && pos.phase !== undefined ? pos.phase : defaultPhaseFor(state.tab);
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

window.addEventListener('hashchange', () => {
  const pos = linkedPosition();
  if (pos.id && state.config) select(pos.id, true, pos);
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
  const prefix = currentRun?.group === 'example' ? '课内样例 · ' : '';
  $('#mode').textContent = `${prefix}${distro}`;
  $('#metadata').textContent = `内核 ${kernel} · ${friendlyTime(r.run_id)} · ${labels[r.status] || r.status}`;
  const rel = r.related_run;
  if (rel) $('#metadata').textContent += ' · ' + (envLabels[rel.environment_comparison?.status] || '早期复验');

  if (r.integrity.status === 'verified') {
    $('#integrity').textContent = '采样日志与源码文件都通过了哈希核对，数据完整没被改过。';
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

  document.querySelectorAll('[data-tab]').forEach(b => {
    const tab = b.dataset.tab;
    b.setAttribute('aria-selected', tab === state.tab);
  });

  if (r.integrity.status === 'failed') {
    error('部分原始文件核对未通过：' + r.integrity.errors[0] + '。去“原始记录”可查看各实验状态。');
  }
  $('#page-title').hidden = true;
  views[state.tab]();
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
  if (b.dataset.raw) {
    return raw(b.dataset.raw, b.dataset.kind, {
      lineStart: b.dataset.lineStart ? Number(b.dataset.lineStart) : null,
      lineEnd: b.dataset.lineEnd ? Number(b.dataset.lineEnd) : null,
      phase: b.dataset.phase || null,
      stepLabel: b.dataset.stepLabel || null
    });
  }
  if (b.dataset.selectCase !== undefined) {
    stop();
    state.selected = Number(b.dataset.selectCase);
    state.phase = defaultPhaseFor(state.tab);
    render();
    return;
  }
  const step = b.dataset.courseStep ?? b.dataset.sequenceStep;
  if (step !== undefined) {
    state.phase = Number(step);
    render();
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
    state.phase = defaultPhaseFor(state.tab);
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

function formatHighlightedRaw(text, kind, opts = {}) {
  const lines = text.split('\n');
  let start = opts.lineStart;
  let end = opts.lineEnd;
  let notice = '';

  if (!start && opts.phase) {
    const bIdx = lines.findIndex(l => l.includes(`BEGIN phase=${opts.phase}`));
    const eIdx = lines.findIndex((l, i) => i >= bIdx && l.includes(`END phase=${opts.phase}`));
    if (bIdx >= 0) {
      start = bIdx + 1;
      end = eIdx >= bIdx ? eIdx + 1 : Math.min(lines.length, start + 40);
    }
  }

  const formatBlock = (arr, offset) => arr.map((l, i) => {
    const lineText = `L${offset + i}  ${l}`;
    return kind === 'syscalls' ? highlightSyscallLine(lineText) : esc(lineText);
  }).join('\n');

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

async function raw(caseId, kind, opts = {}) {
  stop();
  const request = ++evidenceRequest;
  const kindNames = { syscalls: '系统调用原文 (strace)', smaps: '原始内存映射 (smaps)', jsonl: '采样事件 (JSONL)', kernel: '内核状态记录' };
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

async function run(mode) {
  stop();
  error('');
  try {
    const pattern = mode.includes('policy')
      ? 'sparse'
      : state.tab === 'thp'
        ? [...new Set(state.report?.cases.filter(c => c.suite === 'thp' && !['allow', 'disable'].includes(c.parameters.process_thp)).map(c => `${c.parameters.pattern}:${c.parameters.repeat}`))][state.selected]?.split(':')[0] || 'sparse'
        : 'sparse';
    state.job = await api('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VMObserve-Token': state.config.token },
      body: JSON.stringify({ mode, id: state.id, group4_task: state.group4Task, cow_fraction: state.cowFraction, pattern })
    });
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
  $('#job').hidden = !job;
  if (!job) return;
  $('#job').innerHTML = job.status === 'running'
    ? `正在 ${esc(job.target === 'openeuler-vm' ? 'openEuler 虚拟机' : job.target)} 上采集新数据${job.cow_fraction ? `（COW 比例 ${esc(job.cow_fraction)}）` : ''}… 完成前下方继续显示历史记录，跑完会自动切换。`
    : `最近一次采集（${esc(job.id)}）：${esc(labels[job.status] || job.status)}${job.new_run_ids?.includes(state.id) ? ' · 当前页已是这份新结果' : ' · 当前页显示的是其他历史记录'}<details><summary>展开采集输出日志</summary><pre>${esc(job.log || job.error?.message || '')}</pre></details>`;
}

$('#runs').addEventListener('click', e => {
  const button = e.target.closest('[data-run]');
  if (button) select(button.dataset.run, true);
});
$('#environment').addEventListener('change', history);
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => chooseTopic(b.dataset.tab)));
$('#run').addEventListener('click', () => run('complete'));
$('#close-dialog').addEventListener('click', () => $('#raw-dialog').close());
$('#export').addEventListener('click', () => {
  if (!state.report) return;
  dialog('导出当前实验报告', `<p class="detail-copy">选择你要导出的格式：HTML 适合直接阅读或提交报告，CSV 适合用表格软件算账，JSON 保留全部原始字段。</p><div class="export-links">${['html', 'json', 'csv'].map(format => `<a download href="${url('/api/export', { id: state.id, format })}">${format.toUpperCase()} 报告</a>`).join('')}</div>`);
});

try {
  state.config = await api('/api/config');
  $('#run').title = `采集目标：${state.config.executor}`;
  await refresh();
  state.job = await api('/api/job');
  jobUI();
  setInterval(async () => {
    try {
      const previous = state.job;
      state.job = await api('/api/job');
      jobUI();
      if (previous?.status === 'running' && state.job?.status !== 'running') {
        await refresh();
        if (state.job.new_run_ids?.length) await select(state.job.new_run_ids[0], true);
      }
    } catch (e) {
      error('本地服务连接已断开：' + e.message);
    }
  }, 1500);
} catch (e) {
  error(e.message);
}
