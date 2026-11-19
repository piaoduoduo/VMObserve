import { directory } from './curriculum.js';
import { loadOriginalPs, kib } from './ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
directory('lesson');
const verification = new URLSearchParams(location.search).get('verification') === '1';
const key = 'vmobserve-demand-worksheet-v1' + (verification ? '-ui-test' : '');
const answerOrigin = verification ? 'ui_verification' : 'learner_notes';
if (verification) document.querySelector('h1').textContent += '（界面检查模式）';

let report, identifier, selectedCase, notes = { prediction: '', explanation: '', records: [] };

async function api(path, options) {
  const r = await fetch(path, options);
  const data = await r.json();
  if (!r.ok) throw Error(data.error || r.statusText);
  return data;
}

function persist() {
  notes.prediction = $('#prediction').value;
  notes.explanation = $('#explanation').value;
  notes.result_notes = $('#result-notes').value;
  notes.own_trial = $('#own-trial').value;
  notes.extension = $('#extension').value;
  notes.updated_at = new Date().toISOString();
  try {
    localStorage.setItem(key, JSON.stringify(notes));
    $('#save-status').textContent = '草稿已自动保存在本机浏览器里。';
  } catch (e) {
    $('#save-status').textContent = '当前浏览器限制本地保存，写完记得点下方“导出笔记”。';
  }
}

function binding() {
  const c = selectedCase;
  if (!c) return null;
  return {
    selected_record: identifier,
    run_id: report.run_id,
    case_id: c.id,
    requested_kib: c.parameters.requested_kib ?? c.data.condition.bytes / 1024,
    repeat: c.parameters.repeat,
    course_code: c.parameters.course_code ?? c.data?.condition?.course_code ?? null,
    phase: $('#lesson-phase')?.value || null,
    report_sha256: report.original_report_sha256,
    source_sha256: report.sources,
    integrity: report.integrity.status,
    data_origin: report.data_origin,
    view_mode: report.view_mode
  };
}

async function loadObservation() {
  const query = new URLSearchParams(location.search);
  identifier = query.get('run');
  if (!identifier) {
    const runs = await api('/api/runs');
    identifier = runs.find(r => r.data_origin === 'real_execution' && !r.environment_issue && r.status === 'completed' && r.suites?.includes('demand512'))?.id;
  }
  if (!identifier) { $('#error').textContent = '还没有这项实测，先到 3.3 完成一次分批写入。'; return; }
  report = await api('/api/report?id=' + encodeURIComponent(identifier));
  $('#worksheet-evidence').href = '/#' + new URLSearchParams({run: identifier, topic:'evidence'});
  const c = query.has('case') ? report.cases.find(item => item.id === query.get('case')) : report.cases.find(item => item.suite === 'demand512');
  if (!c?.data?.samples?.length || !['demand512','course'].includes(c.suite) || c.validation?.status === 'failed') {
    $('#error').textContent = '这份记录缺少可引用的按需调页数据。请到原始证据查看原因。';
    return;
  }
  selectedCase = c;
  $('#provenance').textContent = (report.data_origin === 'real_execution' ? '实测回放' : '保存的记录') + ' · ' + (report.environment?.distribution?.PRETTY_NAME || report.environment?.system || '系统未记录');
  showCase(c);
}

$('#prediction').addEventListener('input', persist);
$('#explanation').addEventListener('input', persist);
$('#result-notes').addEventListener('input', persist);
$('#extension').addEventListener('input', persist);
$('#own-trial').addEventListener('input', persist);

$('#save-record').addEventListener('click', () => {
  persist();
  if (!binding()) {
    $('#record-status').textContent = '请先在上方选定一组实验数据后再保存。';
    return;
  }
  notes.records.push({
    saved_at: new Date().toISOString(),
    prediction: notes.prediction,
    explanation: notes.explanation,
    result_notes: notes.result_notes,
    extension: notes.extension,
    own_trial: notes.own_trial,
    evidence: binding(),
    assessment: 'not_graded',
    answer_origin: answerOrigin
  });
  persist();
  $('#record-status').textContent = `已保存第 ${notes.records.length} 条学习记录，并绑定了当前选中的实验证据。`;
});

$('#export-notes').addEventListener('click', () => {
  persist();
  const blob = new Blob([JSON.stringify({
    schema_version: 'vmobserve.worksheet/v1',
    answer_origin: answerOrigin,
    assessment: 'not_graded',
    exported_at: new Date().toISOString(),
    ...notes,
    draft_selected_evidence: binding()
  }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'vmobserve-learning-notes.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

try {
  const saved = localStorage.getItem(key);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (typeof parsed.prediction === 'string' && typeof parsed.explanation === 'string' && Array.isArray(parsed.records)) notes = parsed;
  }
} catch (e) {
  $('#save-status').textContent = '读取之前的草稿时遇到格式问题，未清除原有内容。';
}

$('#prediction').value = notes.prediction;
$('#explanation').value = notes.explanation;
$('#result-notes').value = notes.result_notes || '';
$('#extension').value = notes.extension || '';
$('#own-trial').value = notes.own_trial || '';

try {
  if (location.hash === '#original-demand') $('#original-demand').open = true;
  await Promise.all([loadOriginalPs($('#original-ps')), loadObservation()]);
} catch (e) {
  if ($('#error')) $('#error').textContent = e.message;
}

function showCase(c) {
  const size = c.parameters.requested_kib ?? c.data.condition.bytes / 1024;
  const names = ['申请前', '申请后', '写到 ¼', '写到 ½', '写完', '释放后'];
  $('#case-observation').innerHTML = `<h3>${kib(size)} 分批写入</h3>
    <label>回答引用哪一步 <select id="lesson-phase"><option value="">对照整组六步</option>${c.data.samples.map((s,i) => `<option value="${esc(s.phase)}">${names[i]}</option>`).join('')}</select></label>
    <div class="table-wrap"><table><thead><tr><th>阶段</th><th>累计写入位置</th><th>目标映射 RSS</th><th>本步次缺页</th></tr></thead>
    <tbody>${c.data.samples.map((s,i) => `<tr><td>${names[i]}</td><td>${s.written_positions ?? s.count}</td><td>${s.mapping_present ? kib(s.rss_kib) : '无目标映射'}</td><td>${s.action_minor}</td></tr>`).join('')}</tbody></table></div>`;
}
