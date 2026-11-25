import {state, esc, api, url, demandPair} from './ui.js';
import {viewCases} from './curriculum.js';

const names = {sequence: '三次 malloc', course: '按需分配', baseline: '写时复制', thp: '透明大页',
  group3: '链接与栈', group4: '进程与线程', systems: '同步、文件与设备', layout: '程序地址'};

async function replayURL(record) {
  const binding = record.evidence;
  if (!state.runs.some(run => run.id === binding.selected_record)) {
    throw new Error('当前工作台没有这份实测记录。笔记内容仍可查看和导出。');
  }
  const report = await api(url('/api/report', {id: binding.selected_record}));
  if (report.original_report_sha256 !== binding.report_sha256) {
    throw new Error('这份实测报告与笔记保存时的哈希不同，请先核对原始记录。');
  }
  const target = new URL('/', location.origin);
  if (new URLSearchParams(location.search).get('verification') === '1') target.searchParams.set('verification', '1');
  target.hash = noteReplayPosition(report.cases, binding).toString();
  return target.href;
}

export function noteReplayPosition(reportCases, binding) {
  let cases = viewCases(reportCases, binding.topic, item => item.suite);
  if (binding.topic === 'course') cases.sort((a, b) =>
    b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  let selected = cases.findIndex(item => item.id === binding.case_ids[0]);
  if (binding.topic === 'thp') {
    const ordinary = cases.filter(item => !['allow', 'disable'].includes(item.parameters.process_thp));
    if (ordinary.length) cases = ordinary;
    const target = cases.find(item => item.id === binding.case_ids[0]);
    const groups = [...new Set(cases.map(item => item.parameters.pattern + ':' + item.parameters.repeat))];
    selected = target ? groups.indexOf(target.parameters.pattern + ':' + target.parameters.repeat) : -1;
    const pair = cases.filter(item => item.parameters.pattern + ':' + item.parameters.repeat === groups[selected]);
    if (JSON.stringify(pair.map(item => item.id)) !== JSON.stringify(binding.case_ids)) selected = -1;
  } else if (binding.case_ids.length !== 1) {
    selected = binding.case_index;
    const pair = demandPair(cases, cases[selected]);
    if (JSON.stringify(pair.map(item => item.id)) !== JSON.stringify(binding.case_ids)) selected = -1;
  }
  if (selected < 0) throw new Error('报告中找不到笔记对应的案例，请保留笔记并核对记录。');
  return new URLSearchParams({run: binding.selected_record, topic: binding.topic,
    case: selected, step: binding.step_index});
}

export function renderNoteLibrary(host, binding, store, restore, status) {
  let records;
  try { records = store.records().reverse(); }
  catch (error) {
    host.innerHTML = '<summary>查看已保存笔记</summary><p class="detail-copy">' +
      esc(error.name === 'SecurityError' ? '浏览器暂时无法读取历史笔记，可以继续填写并导出当前草稿。' : error.message) +
      '</p><button data-note-action="raw-backup">导出原始备份</button>';
    return;
  }
  host.innerHTML = '<summary>已保存的笔记 <span class="note-count">' + records.length + '</span></summary>' +
    '<label class="note-search">搜索笔记<input type="search" placeholder="实验、案例、预测或解释" aria-label="搜索已保存笔记"></label>' +
    '<label class="note-scope"><input type="checkbox">只看当前实验记录</label>' +
    '<p class="note-results" role="status"></p><div class="note-list"></div>';
  const query = host.querySelector('[type=search]'), scope = host.querySelector('[type=checkbox]');
  const draw = () => {
    const needle = query.value.trim().toLocaleLowerCase();
    const visible = records.filter(record => (!scope.checked || record.evidence.selected_record === binding.selected_record) &&
      [names[record.evidence.topic], record.evidence.run_id, record.evidence.case_ids.join(' '),
        record.prediction, record.observation, record.explanation].join(' ').toLocaleLowerCase().includes(needle));
    host.querySelector('.note-results').textContent = records.length ? '找到 ' + visible.length + ' 条笔记。' : '还没有已保存笔记。写下回答后，点击“保存这一步的笔记”。';
    host.querySelector('.note-list').innerHTML = visible.slice(0, 100).map(record => {
      const b = record.evidence, same = b.key === binding.key;
      return '<article class="note-card"><header><strong>' + esc(names[b.topic] || b.topic) + ' · 第 ' +
        (b.step_index + 1) + ' 步</strong><time datetime="' + esc(record.saved_at) + '">' +
        esc(new Date(record.saved_at).toLocaleString('zh-CN', {hour12: false})) + '</time></header>' +
        '<p class="detail-copy">' + esc(b.case_ids.join('、')) + ' · ' + esc(b.run_id) + '</p>' +
        '<dl>' + [['预测', record.prediction], ['观测', record.observation], ['解释与复验', record.explanation]]
          .map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + esc(value || '未填写') + '</dd></div>').join('') + '</dl>' +
        '<div class="actions">' + (same ? '<button data-note-restore="' + esc(record.id) + '">复制到本步草稿</button>' : '') +
        '<button data-note-replay="' + esc(record.id) + '">返回对应实验</button></div></article>';
    }).join('') + (visible.length > 100 ? '<p class="detail-copy">当前显示前 100 条，可搜索缩小范围；导出包含全部笔记。</p>' : '');
  };
  query.addEventListener('input', draw);
  scope.addEventListener('change', draw);
  host.onclick = async event => {
    const restoreId = event.target.closest('[data-note-restore]')?.dataset.noteRestore;
    const replay = event.target.closest('[data-note-replay]');
    if (restoreId) {
      const record = records.find(item => item.id === restoreId);
      if (record?.evidence.key === binding.key) restore(record);
    }
    if (!replay) return;
    const record = records.find(item => item.id === replay.dataset.noteReplay);
    if (!record) return;
    replay.disabled = true;
    try { const target = await replayURL(record); if (host.isConnected) location.assign(target); }
    catch (error) { status(error.message); replay.disabled = false; }
  };
  draw();
}
