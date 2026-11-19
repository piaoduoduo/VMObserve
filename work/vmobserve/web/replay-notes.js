import { state, esc } from './ui.js';
import { viewCases } from './curriculum.js';

const verification = new URLSearchParams(location.search).get('verification') === '1';
const prefix = 'vmobserve-replay-notes-v1' + (verification ? '-verification' : '') + ':';
const memory = new Map();
const fields = ['prediction', 'observation', 'explanation'];

function selectedCases() {
  let cases = viewCases(state.report.cases, state.tab, item => item.suite);
  if (state.tab === 'course') cases.sort((a, b) =>
    b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  if (state.tab === 'thp') {
    const ordinary = cases.filter(item => !['allow', 'disable'].includes(item.parameters.process_thp));
    if (ordinary.length) cases = ordinary;
    const groups = [...new Set(cases.map(item => item.parameters.pattern + ':' + item.parameters.repeat))];
    const group = groups[state.selected];
    return cases.filter(item => item.parameters.pattern + ':' + item.parameters.repeat === group);
  }
  return cases[state.selected] ? [cases[state.selected]] : [];
}

function snapshot(item) {
  const samples = item.data?.samples || [];
  let selected = samples;
  let stage = 'whole_case';
  if (['sequence', 'course', 'baseline'].includes(item.suite)) {
    selected = samples[state.phase] ? [samples[state.phase]] : samples;
    stage = samples[state.phase] ? 'sample' : 'comparison';
  } else if (item.suite === 'demand512') {
    selected = samples[state.phase] ? [samples[state.phase]] : [];
    stage = 'sample';
  } else if (item.suite === 'stack') {
    selected = state.phase === 0 ? samples.slice(0, 1) : state.phase === 1 ? samples.slice(-1) : [];
    stage = state.phase === 2 ? 'outcome' : 'sample';
  } else if (item.suite === 'thp') {
    selected = state.phase === 1 ? samples.filter(sample => sample.phase === 'untouched')
      : state.phase === 2 ? samples.filter(sample => sample.phase === 'after_write') : [];
    stage = ['condition', 'sample', 'sample', 'value_check'][state.phase];
  }
  return {
    case_id: item.id, suite: item.suite, parameters: item.parameters,
    case_status: item.status, validation: item.validation, integrity: item.integrity ?? null,
    artifacts: item.artifacts || {}, stage, samples: selected,
    measurements: ['whole_case', 'comparison'].includes(stage) ? item.data : null,
    condition: item.data?.condition ?? null,
    outcome: item.data?.outcome ?? null, value_check: item.data?.value_check ?? item.data?.values ?? null
  };
}

function context() {
  if (!state.report) return null;
  const cases = selectedCases();
  if (!cases.length) return null;
  return {
    key: JSON.stringify([state.report.original_report_sha256 || state.report.run_id,
      state.tab, cases.map(item => item.id), state.phase]),
    run_id: state.report.run_id, selected_record: state.id, topic: state.tab,
    case_ids: cases.map(item => item.id), case_index: state.selected, step_index: state.phase,
    report_sha256: state.report.original_report_sha256, source_sha256: state.report.sources,
    integrity: state.report.integrity, data_origin: state.report.data_origin,
    view_mode: state.report.view_mode, replay_url: location.href, cases: cases.map(snapshot)
  };
}

function readDraft(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const parsed = JSON.parse(localStorage.getItem(prefix + 'draft:' + key));
    if (parsed && fields.every(field => typeof parsed[field] === 'string')) return parsed;
  } catch { /* Keep the editor available when local storage is restricted. */ }
  return { prediction: '', observation: '', explanation: '' };
}

function readRecords() {
  const records = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix + 'record:')) continue;
    const record = JSON.parse(localStorage.getItem(key));
    if (!record?.evidence?.case_ids || !record.saved_at) throw new Error('已保存笔记的格式需要检查，请保留浏览器存储内容。');
    records.push(record);
  }
  return records.sort((a, b) => a.saved_at.localeCompare(b.saved_at));
}

export function renderReplayNotes() {
  const binding = context();
  if (!binding || state.tab === 'evidence') return;
  const draft = readDraft(binding.key);
  document.querySelector('#content').insertAdjacentHTML('beforeend',
    '<details class="replay-notes"><summary>记录本步的预测、观测与解释</summary>' +
    '<p class="detail-copy">当前案例 ' + esc(binding.case_ids.join('、')) + ' · 回放位置 ' +
    (binding.step_index + 1) + '。草稿保存在当前浏览器，导出后可自行留存。</p>' +
    fields.map((field, index) => '<label>' + ['我的预测', '我在原文中看到的结果', '解释与下一次复验'][index] +
      '<textarea data-note-field="' + field + '" rows="3">' + esc(draft[field]) + '</textarea></label>').join('') +
    '<div class="actions"><button data-note-action="save">保存这一步的笔记</button>' +
    '<button data-note-action="export">导出全部笔记</button></div><p class="note-status" role="status"></p>' +
    '<p class="detail-copy">保存时附上案例与采样、原始文件路径和报告哈希。个人解释保留为未评分。</p></details>');
  const panel = document.querySelector('.replay-notes');
  const status = message => { panel.querySelector('.note-status').textContent = message; };
  const captureDraft = () => {
    const note = Object.fromEntries(fields.map(field => [field,
      panel.querySelector('[data-note-field="' + field + '"]').value]));
    memory.set(binding.key, note);
    return note;
  };
  panel.addEventListener('input', event => {
    if (!event.target.matches('[data-note-field]')) return;
    const note = captureDraft();
    try {
      localStorage.setItem(prefix + 'draft:' + binding.key, JSON.stringify(note));
      status('本步草稿已保存。');
    } catch { status('浏览器暂时无法保存，请用“导出全部笔记”保留当前草稿。'); }
  });
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-note-action]')?.dataset.noteAction;
    if (!action) return;
    const note = captureDraft();
    if (action === 'save') {
      if (!fields.some(field => note[field].trim())) { status('先写下一项预测、观测或解释。'); return; }
      const record = {
        id: crypto.randomUUID(), saved_at: new Date().toISOString(),
        answer_origin: verification ? 'ui_verification' : 'learner_notes',
        assessment: 'not_graded', ...note, evidence: binding
      };
      try {
        localStorage.setItem(prefix + 'record:' + record.id, JSON.stringify(record));
        status('已保存独立笔记，并绑定当前案例与回放位置。');
      } catch { status('本次笔记未能保存，请立即导出当前草稿。'); }
      return;
    }
    try {
      let storageAvailable = true;
      try { void localStorage.length; } catch { storageAvailable = false; }
      const records = storageAvailable ? readRecords() : [];
      const exported = {
        schema_version: 'vmobserve.replay-notes/v1', exported_at: new Date().toISOString(),
        answer_origin: verification ? 'ui_verification' : 'learner_notes', assessment: 'not_graded',
        saved_records_available: storageAvailable, records,
        current_draft: { ...note, evidence: binding }
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'vmobserve-replay-notes.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(storageAvailable ? '已导出本浏览器保存的回放笔记与当前草稿。'
        : '已导出当前草稿。浏览器存储不可用，文件中未包含历史笔记。');
    } catch (error) { status('导出未完成。' + error.message); }
  });
}
