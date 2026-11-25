import { state, esc } from './ui.js';
import { viewCases } from './curriculum.js';
import { createNotesStore, noteFields } from './notes-store.js';
import { renderNoteLibrary } from './notes-library.js';

const verification = new URLSearchParams(location.search).get('verification') === '1';
const store = createNotesStore(() => localStorage, verification);
const fields = noteFields;

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


function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderReplayNotes() {
  const binding = context();
  if (!binding || state.tab === 'evidence') return;
  const draft = store.getDraft(binding);
  document.querySelector('#content').insertAdjacentHTML('beforeend',
    '<details class="replay-notes"><summary>记录本步的预测、观测与解释</summary>' +
    '<p class="detail-copy">当前案例 ' + esc(binding.case_ids.join('、')) + ' · 回放位置 ' +
    (binding.step_index + 1) + '。草稿保存在当前浏览器；可导出备份，再到另一浏览器导入。</p>' +
    fields.map((field, i) => '<label>' + ['我的预测', '我在原文中看到的结果', '解释与下一次复验'][i] +
      '<textarea data-note-field="' + field + '" rows="3" maxlength="100000">' + esc(draft[field]) + '</textarea></label>').join('') +
    '<div class="actions"><button data-note-action="save" class="primary">保存这一步的笔记</button>' +
    '<button data-note-action="export">导出全部笔记</button>' +
    '<button data-note-action="import">导入笔记</button><input class="note-file" type="file" accept=".json,application/json" hidden></div>' +
    '<p class="note-status" role="status" aria-live="polite"></p><button data-note-action="undo-restore" hidden>撤销这次草稿替换</button>' +
    '<p class="detail-copy">保存时附上案例与采样、原始文件路径和报告哈希。个人解释保留为未评分。</p>' +
    '<details class="note-library"></details></details>');
  const panel = document.querySelector('.replay-notes');
  let restoreBackup = null;
  const undo = panel.querySelector('[data-note-action="undo-restore"]');
  const status = text => { panel.querySelector('.note-status').textContent = text; };
  const capture = () => Object.fromEntries(fields.map(field => [field,
    panel.querySelector('[data-note-field="' + field + '"]').value]));
  const persist = () => {
    try { store.saveDraft(binding, capture()); status('本步草稿已保存。'); return true; }
    catch { status('浏览器暂时无法保存，请用“导出全部笔记”保留当前草稿。'); return false; }
  };
  const library = () => renderNoteLibrary(panel.querySelector('.note-library'), binding, store, record => {
    // Keep one reversible replacement without changing any saved record.
    restoreBackup = capture();
    fields.forEach(field => { panel.querySelector('[data-note-field="' + field + '"]').value = record[field]; });
    const saved = persist();
    panel.querySelector('textarea').focus();
    undo.hidden = false;
    if (saved) status('已复制到本步草稿，可撤销这次替换。原来保存的笔记仍保留。');
  }, status);
  panel.addEventListener('input', event => {
    if (!event.target.matches('[data-note-field]')) return;
    restoreBackup = null; undo.hidden = true; persist();
  });
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-note-action]')?.dataset.noteAction;
    if (!action) return;
    if (action === 'import') { panel.querySelector('.note-file').click(); return; }
    if (action === 'undo-restore' && restoreBackup) {
      fields.forEach(field => { panel.querySelector('[data-note-field="' + field + '"]').value = restoreBackup[field]; });
      const saved = persist();
      restoreBackup = null; undo.hidden = true;
      if (saved) status('已恢复替换前的草稿。');
      return;
    }
    try {
      if (action === 'save') {
        store.saveRecord(binding, capture(), crypto.randomUUID());
        status('已保存独立笔记，并绑定当前案例与回放位置。');
        library();
      } else if (action === 'export') {
        const archive = store.exportArchive(binding, capture());
        download(archive, 'vmobserve-replay-notes.json');
        status(archive.saved_records_available ? '已导出全部已保存笔记、各步草稿和当前草稿。'
          : '已导出当前可用草稿。浏览器存储不可用，文件中未包含历史笔记。');
      } else if (action === 'raw-backup') {
        download(store.rawBackup(), 'vmobserve-replay-notes-raw.json');
        status('已导出本地笔记原文备份，可用于排查无法读取的条目。');
      }
    } catch (error) { status(action === 'save' && ['QuotaExceededError', 'SecurityError'].includes(error.name)
      ? '本次笔记未能保存，请立即导出当前草稿。' : (action === 'export' ? '导出未完成。' : '') + error.message); }
  });
  panel.querySelector('.note-file').addEventListener('change', async event => {
    const input = event.target, file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MiB，超出笔记导入上限。');
      let archive;
      try { archive = JSON.parse(await file.text()); } catch { throw new Error('文件不是有效的 JSON，未导入任何内容。'); }
      if (!panel.isConnected) return;
      const result = store.importArchive(archive);
      const current = capture();
      if (!fields.some(field => current[field].trim())) {
        const imported = store.getDraft(binding);
        fields.forEach(field => { panel.querySelector('[data-note-field="' + field + '"]').value = imported[field]; });
      }
      library();
      status('导入完成：新增 ' + result.addedRecords + ' 条笔记、' + result.addedDrafts + ' 份草稿；跳过 ' +
        result.duplicates + ' 条重复笔记，保留 ' + result.keptDrafts + ' 份本地草稿。');
    } catch (error) { status(error.message); }
    finally { input.value = ''; }
  });
  library();
}
