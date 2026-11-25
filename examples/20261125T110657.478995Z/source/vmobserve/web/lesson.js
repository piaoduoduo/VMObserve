import { labels, friendlyTime, loadOriginalPs } from './ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const verification = new URLSearchParams(location.search).get('verification') === '1';
const key = 'vmobserve-demand-worksheet-v1' + (verification ? '-ui-test' : '');
const answerOrigin = verification ? 'ui_verification' : 'learner_notes';
if (verification) document.querySelector('h1').textContent += '（界面检查模式）';

let report, identifier, notes = { prediction: '', explanation: '', records: [] };

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
  const c = report?.cases.find(item => item.id === $('#lesson-case')?.value);
  if (!c) return null;
  return {
    selected_record: identifier,
    run_id: report.run_id,
    case_id: c.id,
    requested_kib: c.parameters.requested_kib,
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

async function select(id) {
  report = null;
  identifier = id;
  $('#checks').innerHTML = '';
  $('#observations').innerHTML = '';
  $('#report-download').hidden = true;
  $('#error').textContent = '';
  $('#provenance').textContent = '正在读取本次实验数据…';
  try {
    const data = await api('/api/report?id=' + encodeURIComponent(id));
    if (identifier !== id) return;
    report = data;
    const cases = report.cases.filter(c => c.suite === 'course');
    const integrityText = {verified:'文件完整',legacy_partial:'早期记录，部分文件可核对',failed:'证据校验失败'}[report.integrity.status] || report.integrity.status;
    $('#provenance').textContent = `当前查看：${friendlyTime(report.run_id)} · ${integrityText} · ${labels[report.status] || report.status}`;
    if (!cases.length) {
      $('#checks').textContent = '这份记录里没有按需分配实验，请选择另一份记录。';
      return;
    }
    const passedCount = cases.filter(c => c.validation?.status === 'passed').length;
    const checksMarkup = cases.map(c => {
      const ok = c.validation?.status === 'passed';
      return `<details><summary>${c.parameters.requested_kib} KiB · 第 ${c.parameters.repeat} 次（${c.parameters.course_code === 'student' ? '我的代码' : '参考代码'}）· ${ok ? '检查通过' : '未通过'}</summary><ul>${(c.validation?.checks || []).map(x => `<li>${esc(x.id)}：实测 ${esc(x.observed)}，要求 ${esc(x.expected)} · ${x.status === 'passed' ? '通过' : '未通过'}</li>`).join('')}</ul>${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}</details>`;
    }).join('');
    $('#checks').innerHTML = `<details class="secondary-fold"><summary>动作检查结果：${passedCount} / ${cases.length} 组通过（点击展开逐项明细）</summary>${checksMarkup}</details>`;
    $('#observations').innerHTML = '<label for="lesson-case">选择要看的内存大小和轮次</label><select id="lesson-case">' + cases.map(c => `<option value="${esc(c.id)}">${c.parameters.requested_kib} KiB · 第 ${c.parameters.repeat} 次</option>`).join('') + '</select><div id="case-observation"></div>';
    const initial = cases.find(c => c.parameters.requested_kib === 16384 && c.data) || cases[0];
    $('#lesson-case').value = initial.id;
    $('#lesson-case').addEventListener('change', e => showCase(cases.find(c => c.id === e.target.value)));
    showCase(initial);
    $('#report-download').href = '/api/export?format=json&id=' + encodeURIComponent(id);
    $('#report-download').download = 'lesson-evidence.json';
    $('#report-download').hidden = false;
  } catch (e) {
    if (identifier !== id) return;
    report = null;
    $('#provenance').textContent = '读取这份记录时出错。';
    $('#error').textContent = e.message;
  }
}

async function refresh(preferred) {
  const runs = (await api('/api/runs')).filter(r => r.data_origin === 'real_execution' && r.suites?.includes('course'));
  const groupNames = { example: '课内样例', openeuler: 'openEuler 虚拟机', local: '本地 / WSL' };
  $('#lesson-run').innerHTML = runs.map(r => `<option value="${esc(r.id)}">${esc(groupNames[r.group] || r.group)} · ${esc(friendlyTime(r.run_id))} · ${esc(labels[r.status] || r.status)} · ${r.count} 组</option>`).join('');
  const desired = preferred || identifier;
  const id = runs.find(r => r.id === desired)?.id || runs.find(r => r.status === 'completed')?.id || runs[0]?.id;
  if (id) {
    $('#lesson-run').value = id;
    await select(id);
  } else {
    $('#provenance').textContent = '本机还没有“按需分配”实验的运行记录。可以先展开上面的五次 ps 记录，或在实验 3.3 的逐步对照页采集一轮。';
  }
}

$('#prediction').addEventListener('input', persist);
$('#explanation').addEventListener('input', persist);
$('#result-notes').addEventListener('input', persist);
$('#extension').addEventListener('input', persist);
$('#lesson-run').addEventListener('change', e => select(e.target.value));
$('#refresh').addEventListener('click', () => refresh().catch(e => { if ($('#error')) $('#error').textContent = e.message; }));
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
  await Promise.all([loadOriginalPs($('#original-ps')), refresh()]);
} catch (e) {
  if ($('#error')) $('#error').textContent = e.message;
}

function showCase(c) {
  if (!c?.data) {
    $('#case-observation').textContent = '这个案例没有完整数据，展开上方动作检查或运行日志看看原因。';
    return;
  }
  const names = ['申请前', '申请后', '写到 1/4', '写到 1/2', '写完', '释放后'];
  $('#case-observation').innerHTML = `<h3>${c.parameters.requested_kib} KiB · 第 ${c.parameters.repeat} 次 · 六步数据</h3>
    <label>回答要引用的阶段 <select id="lesson-phase"><option value="">对照整组六步</option>${c.data.samples.map((s, i) => `<option value="${esc(s.phase)}">${names[i]}</option>`).join('')}</select></label>
    <div class="table-wrap"><table><thead><tr><th>阶段</th><th>累计写入位置</th><th>物理驻留 RSS (KiB)</th><th>本步次缺页</th><th>原映射状态</th></tr></thead><tbody>${c.data.samples.map((s, i) => `<tr><td>${names[i]}</td><td>${s.written_positions}</td><td>${s.rss_kib}</td><td>${s.action_minor}</td><td>${s.mapping_present ? '存在' : '已消失'}</td></tr>`).join('')}</tbody></table></div>`;
}
