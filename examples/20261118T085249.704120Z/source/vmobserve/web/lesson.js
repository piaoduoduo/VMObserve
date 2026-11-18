import { labels, friendlyTime, table } from './ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const verification = new URLSearchParams(location.search).get('verification') === '1';
const key = 'vmobserve-demand-worksheet-v1' + (verification ? '-ui-test' : '');
const answerOrigin = verification ? 'ui_verification' : 'learner_notes';
if (verification) document.querySelector('h1').textContent += '（界面检查模式）';

let config, report, identifier, job, notes = { prediction: '', explanation: '', records: [] };

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
  $('#provenance').textContent = '正在读取本次实验数据…';
  try {
    const data = await api('/api/report?id=' + encodeURIComponent(id));
    if (identifier !== id) return;
    report = data;
    const cases = report.cases.filter(c => c.suite === 'course');
    const integrityText = {verified:'文件完整',legacy_partial:'早期记录，部分文件可核对',failed:'证据校验失败'}[report.integrity.status] || report.integrity.status;
    $('#provenance').textContent = `当前查看：${friendlyTime(report.run_id)} · ${integrityText} · ${labels[report.status] || report.status}`;
    if (!cases.length) {
      $('#checks').textContent = '这份记录里没有按需分配实验，请换选其他记录或点击上方运行按钮。';
      return;
    }
    $('#checks').innerHTML = '<h3>动作检查结果</h3>' + cases.map(c => {
      const ok = c.validation?.status === 'passed';
      return `<details><summary>${c.parameters.requested_kib} KiB · 第 ${c.parameters.repeat} 次（${c.parameters.course_code === 'student' ? '我的代码' : '参考代码'}）· ${ok ? '检查通过' : '未通过'}</summary><ul>${(c.validation?.checks || []).map(x => `<li>${esc(x.id)}：实测 ${esc(x.observed)}，要求 ${esc(x.expected)} · ${x.status === 'passed' ? '通过' : '未通过'}</li>`).join('')}</ul>${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}</details>`;
    }).join('');
    $('#observations').innerHTML = '<label for="lesson-case">选择要看的内存大小和轮次</label><select id="lesson-case">' + cases.map(c => `<option value="${esc(c.id)}">${c.parameters.requested_kib} KiB · 第 ${c.parameters.repeat} 次</option>`).join('') + '</select><div id="case-observation"></div>';
    const initial = cases.find(c => c.parameters.requested_kib === 16384 && c.data) || cases[0];
    $('#lesson-case').value = initial.id;
    $('#lesson-case').addEventListener('change', e => showCase(cases.find(c => c.id === e.target.value)));
    showCase(initial);
    $('#report-download').href = '/api/export?format=json&id=' + encodeURIComponent(id);
    $('#report-download').download = 'lesson-evidence.json';
    $('#report-download').hidden = false;
  } catch (e) {
    report = null;
    $('#provenance').textContent = '读取这份记录时出错。';
    $('#error').textContent = e.message;
  }
}

async function refresh(preferred) {
  const runs = (await api('/api/runs')).filter(r => r.suites?.includes('course'));
  const groupNames = { example: '课内样例', openeuler: 'openEuler 虚拟机', local: '本地 / WSL' };
  $('#lesson-run').innerHTML = runs.map(r => `<option value="${esc(r.id)}">${esc(groupNames[r.group] || r.group)} · ${esc(friendlyTime(r.run_id))} · ${esc(labels[r.status] || r.status)} · ${r.count} 组</option>`).join('');
  const desired = preferred || identifier;
  const id = runs.find(r => r.id === desired)?.id || runs.find(r => r.status === 'completed')?.id || runs[0]?.id;
  if (id) {
    $('#lesson-run').value = id;
    await select(id);
  } else {
    $('#provenance').textContent = '本机还没有“按需分配”实验的运行记录。可以先回首页看“连续分配”样例，或者在配置好的 Linux/openEuler 环境点击上方运行按钮。';
  }
}

function jobUI() {
  const running = job?.status === 'running';
  $('#job-log').textContent = job?.log || job?.error?.message || '';
  $('#run-student').disabled = running;
  $('#run-reference').disabled = running;
  $('#job').textContent = !job ? '' : running
    ? '正在运行实验并采样，完成前下方继续显示刚才的历史记录…'
    : `最近一次运行：${labels[job.status] || job.status}。${job.status === 'failed' ? '如果你还没补全 student.h，检查未通过是正常的；打开上面折叠项能看具体差在哪一项。' : '可以从下方列表选择刚刚生成的新记录核对。'}`;
}

async function run(mode) {
  $('#error').textContent = '';
  persist();
  try {
    job = await api('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VMObserve-Token': config.token },
      body: JSON.stringify({ mode })
    });
    jobUI();
  } catch (e) {
    $('#error').textContent = e.message;
  }
}

$('#prediction').addEventListener('input', persist);
$('#explanation').addEventListener('input', persist);
$('#result-notes').addEventListener('input', persist);
$('#extension').addEventListener('input', persist);
$('#lesson-run').addEventListener('change', e => select(e.target.value));
$('#refresh').addEventListener('click', () => refresh().catch(e => $('#error').textContent = e.message));
$('#run-student').addEventListener('click', () => run('student'));
$('#run-reference').addEventListener('click', () => run('course'));

$('#save-record').addEventListener('click', () => {
  persist();
  if (!binding()) {
    $('#record-status').textContent = '请先在第 3 步选定一组实验数据后再保存。';
    return;
  }
  notes.records.push({
    saved_at: new Date().toISOString(),
    prediction: notes.prediction,
    explanation: notes.explanation,
    result_notes: notes.result_notes,
    extension: notes.extension,
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

try {
  config = await api('/api/config');
  const lesson = await api('/api/lesson');
  const original = lesson.original_ps;
  if (original) {
    if (location.hash === '#original-demand') $('#original-demand').open = true;
    const phases = {before:'申请前', allocated:'申请完，尚未写入', quarter:'写 A：前 1/4', half:'写 B：累计 1/2', all:'写 C：写完整块'};
    const samples = original.samples;
    $('#original-ps').innerHTML = `<p>历史实测 · ${esc(original.os)} · 内核 ${esc(original.kernel)} · PID ${original.pid} · THP ${esc(original.thp)}</p>
      <pre>${esc(original.command)}</pre>
      ${table(['暂停点','进程虚拟大小 VSZ（KiB）','进程驻留 RSZ（KiB）','累计次缺页','累计主缺页'],
        samples.map(s=>[phases[s.phase],s.vsz_kib,s.rsz_kib,s.min_flt,s.maj_flt]))}
      <p>申请后进程 RSS 只增加 ${samples[1].rsz_kib-samples[0].rsz_kib} KiB。接着逐页写入时，哪一列持续增加？主缺页有没有增加？把两行数字写进报告，再解释普通缺页和栈溢出有什么区别。</p>
      <details><summary>核对这五次 ps 的原始输出</summary><pre> MINFL MAJFL RSZ VSZ PID CMD\n${esc(samples.map(s=>s.ps_line).join('\n'))}</pre><small>采集轮次 ${esc(original.run_id)} · 源码 SHA-256：${esc(original.source_sha256)}</small></details>`;
  } else {
    $('#original-ps').textContent = '重启本地工作台后即可读入这份随项目提供的课程记录。';
  }
  $('#student-path').textContent = lesson.student_path;
  $('#student-code').textContent = lesson.student;
  $('#reference-code').textContent = lesson.reference;
  $('#worksheet').textContent = lesson.worksheet;
  job = await api('/api/job');
  await refresh(job?.new_run_ids?.[0]);
  jobUI();
  setInterval(async () => {
    try {
      const before = job;
      job = await api('/api/job');
      jobUI();
      if (before?.status === 'running' && job?.status !== 'running') await refresh(job.new_run_ids?.[0]);
    } catch (e) {
      $('#error').textContent = '本地服务连接已断开：' + e.message;
    }
  }, 1500);
} catch (e) {
  $('#error').textContent = e.message;
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
