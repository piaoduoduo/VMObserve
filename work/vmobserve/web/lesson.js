import { directory } from './curriculum.js';
import { loadOriginalPs, kib, table } from './ui.js';

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
    $('#record-status').textContent = '这页还没有可引用的实测。草稿已保留，可以先导出笔记。';
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

function studentResult(report, identifier) {
  const grade = report.student_contract;
  if (!grade || report.integrity?.status !== 'verified') return '<p>判题证据不完整，无法核对。</p>';
  const checks = {empty_stage: '空阶段不写入', first_position: '首次写入', extend_prefix: '保留已写前缀',
    different_stride: '适配不同步长'};
  const headers = ['检查', '返回值', '写入检查'];
  const rows = grade.checks.map(row => [
    checks[row.check] || row.check, `${row.returned} / ${row.limit}`,
    row.memory_ok ? '通过' : `相对块首偏移 ${row.offset}，读到 ${row.actual_byte}，应为 ${row.expected_byte}`
  ]);
  const cases = report.cases.filter(item => item.suite === 'course')
    .sort((a,b) => b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  const status = {passed:'通过', compile_failed:'编译失败', failed:'未通过', timeout:'超时', cancelled:'已取消'};
  const measurements = grade.status === 'passed' ? table(['申请量', '阶段校验', '写完 RSS', '写完当步次缺页'], cases.map(item => {
    const final = item.data?.samples.find(sample => sample.phase === 'write_all');
    return [kib(item.parameters.requested_kib), item.validation?.status === 'passed' ? '通过' : item.status,
      final?.mapping_present ? kib(final.rss_kib) : null, final?.action_minor];
  })) : '';
  const first = cases.findIndex(item => item.validation?.status === 'passed' && item.data?.samples?.length);
  const worksheet = first >= 0 ? new URLSearchParams({run: identifier, case: cases[first].id}) : null;
  if (worksheet && verification) worksheet.set('verification', '1');
  const targets = worksheet ? `<p><a href="/lesson?${esc(worksheet)}#case-observation">引用这次实测完成作答</a></p>` : '';
  return `<p><strong>写入契约 · ${status[grade.status] || '待核对'}</strong> · ${esc(report.run_id)}</p>
    ${rows.length ? table(headers, rows) : ''}
    ${grade.diagnostics ? `<details><summary>查看编译或执行诊断</summary><pre>${esc(grade.diagnostics)}</pre></details>` : ''}
    ${measurements}${targets}`;
}

async function loadStudentLab() {
  const picker = $('#student-run');
  const status = $('#student-status');
  const result = $('#student-result');
  try {
    const records = (await api('/api/runs')).filter(run => run.student_contract)
      .sort((a,b) => b.run_id.localeCompare(a.run_id));
    if (!records.length) {
      picker.innerHTML = '<option>暂无判题记录</option>';
      status.textContent = '终端完成第一次判题后刷新。使用默认输出目录可直接在此查看。';
      return;
    }
    picker.innerHTML = records.map(run => `<option value="${esc(run.id)}">${esc(run.run_id)} · ${esc(run.distribution)}</option>`).join('');
    picker.disabled = false;
    const citedId = new URLSearchParams(location.search).get('run');
    if (records.some(run => run.id === citedId)) picker.value = citedId;
    let revision = 0;
    const show = async () => {
      const id = picker.value, request = ++revision;
      status.textContent = '正在核对判题记录…';
      result.replaceChildren();
      try {
        const report = await api('/api/report?id=' + encodeURIComponent(id));
        if (request !== revision) return;
        result.innerHTML = studentResult(report, id);
        status.textContent = '';
      } catch (error) {
        if (request === revision) status.textContent = error.message;
      }
    };
    picker.addEventListener('change', show);
    await show();
  } catch (error) {
    status.textContent = error.message;
  }
}

try {
  if (location.hash === '#original-demand') $('#original-demand').open = true;
  await Promise.all([loadOriginalPs($('#original-ps')), loadObservation(), loadStudentLab()]);
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
