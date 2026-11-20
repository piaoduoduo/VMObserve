// Storage and archive rules are independent of the page so they can be verified offline.
export const noteFields = ['prediction', 'observation', 'explanation'];
export const archiveSchema = 'vmobserve.replay-notes/v1';
const topics = new Set(['sequence', 'course', 'baseline', 'thp', 'group3', 'group4', 'systems', 'layout']);
const message = '笔记文件的内容或实验位置不完整，请使用本实验台导出的 JSON 文件。';
const fail = () => { throw new Error(message); };
const text = value => typeof value === 'string' && value.length <= 100000;
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 300;
const index = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000;
const note = value => value && noteFields.every(field => text(value[field]));
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function position(key) {
  let parts;
  try { parts = JSON.parse(key); } catch { fail(); }
  if (!Array.isArray(parts) || parts.length !== 4 ||
      !/^[a-f0-9]{64}$/.test(parts[0]) || !topics.has(parts[1]) ||
      !Array.isArray(parts[2]) || !parts[2].length || parts[2].length > 16 ||
      !parts[2].every(nonempty) || !index(parts[3])) fail();
  return parts;
}

function evidence(value) {
  if (!value || typeof value.key !== 'string' || !value.key.length || value.key.length > 6000) fail();
  const [hash, topic, cases, step] = position(value.key);
  if (value.report_sha256 !== hash || value.topic !== topic || value.step_index !== step ||
      stable(value.case_ids) !== stable(cases) || !index(value.case_index) ||
      typeof value.selected_record !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}$/.test(value.selected_record) ||
      !nonempty(value.run_id) || !Array.isArray(value.cases) ||
      stable(value.cases.map(item => item?.case_id)) !== stable(cases)) fail();
}

function validateRecord(value, origin) {
  if (!note(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
      typeof value.saved_at !== 'string' || !Number.isFinite(Date.parse(value.saved_at)) ||
      value.answer_origin !== origin || value.assessment !== 'not_graded') fail();
  evidence(value.evidence);
  return value;
}

function validateDraft(value) {
  if (!note(value) || typeof value.key !== 'string') fail();
  position(value.key);
  if (value.evidence != null) {
    evidence(value.evidence);
    if (value.evidence.key !== value.key) fail();
  }
  return value;
}

export function createNotesStore(getStorage, verification = false) {
  const origin = verification ? 'ui_verification' : 'learner_notes';
  const prefix = 'vmobserve-replay-notes-v1' + (verification ? '-verification' : '') + ':';
  const memory = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const empty = () => Object.fromEntries(noteFields.map(field => [field, '']));
  function entries(kind) {
    const storage = getStorage(), result = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix + kind + ':')) continue;
      let value;
      try { value = JSON.parse(storage.getItem(key)); }
      catch { throw new Error('有一条本地笔记无法读取，请先导出原始备份并保留浏览器存储。'); }
      result.push({ key, value });
    }
    return result;
  }
  function records() {
    return entries('record').map(({value}) => validateRecord(value, origin))
      .sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  }
  function drafts() {
    const saved = new Map(entries('draft').map(({key, value}) => {
      const id = key.slice((prefix + 'draft:').length);
      return [id, validateDraft({...value, key: id})];
    }));
    memory.forEach((value, key) => saved.set(key, value));
    return [...saved.values()];
  }
  function getDraft(binding) {
    if (memory.has(binding.key)) return clone(memory.get(binding.key));
    try {
      const saved = JSON.parse(getStorage().getItem(prefix + 'draft:' + binding.key));
      if (saved && note(saved)) return clone(saved);
    } catch { /* The editor stays usable; writes report any storage failure. */ }
    return empty();
  }
  function saveDraft(binding, value) {
    const saved = {...value, key: binding.key, evidence: binding, updated_at: new Date().toISOString()};
    validateDraft(saved);
    memory.set(binding.key, clone(saved));
    getStorage().setItem(prefix + 'draft:' + binding.key, JSON.stringify(saved));
  }
  function saveRecord(binding, value, id, time = new Date().toISOString()) {
    const record = {id, saved_at: time, answer_origin: origin, assessment: 'not_graded',
      ...Object.fromEntries(noteFields.map(field => [field, value[field]])), evidence: binding};
    validateRecord(record, origin);
    if (!noteFields.some(field => value[field].trim())) throw new Error('先写下一项预测、观测或解释。');
    const storage = getStorage(), key = prefix + 'record:' + id;
    if (storage.getItem(key) !== null) throw new Error('笔记编号已存在，请重试保存。');
    storage.setItem(key, JSON.stringify(record));
    return record;
  }
  function exportArchive(binding, value) {
    let available = true, savedRecords = [], savedDrafts = [];
    try { void getStorage().length; } catch { available = false; }
    if (available) { savedRecords = records(); savedDrafts = drafts(); }
    else savedDrafts = [...memory.values()];
    const current = {...value, key: binding.key, evidence: binding};
    const allDrafts = new Map(savedDrafts.map(draft => [draft.key, draft]));
    allDrafts.set(binding.key, current);
    return {schema_version: archiveSchema, exported_at: new Date().toISOString(),
      answer_origin: origin, assessment: 'not_graded', saved_records_available: available,
      records: savedRecords, drafts: [...allDrafts.values()], current_draft: current};
  }
  function importArchive(archive) {
    if (archive?.schema_version !== archiveSchema) {
      throw new Error('这不是学习笔记归档。原始存储备份用于排查，不能直接导入。');
    }
    if (archive.assessment !== 'not_graded' || archive.answer_origin !== origin) {
      throw new Error('文件类型不匹配；个人笔记与界面验证记录分别导入。');
    }
    if (!Array.isArray(archive.records) || archive.records.length > 10000 ||
        (archive.drafts != null && (!Array.isArray(archive.drafts) || archive.drafts.length > 10000))) fail();
    const importedRecords = archive.records.map(value => validateRecord(value, origin));
    const importedDrafts = [...(archive.drafts || [])];
    importedDrafts.forEach(validateDraft);
    if (archive.current_draft) {
      const current = {...archive.current_draft, key: archive.current_draft.evidence?.key};
      validateDraft(current);
      if (!importedDrafts.some(draft => draft.key === current.key)) importedDrafts.push(current);
    }
    const storage = getStorage(), writes = new Map();
    let duplicates = 0, keptDrafts = 0;
    for (const record of importedRecords) {
      const key = prefix + 'record:' + record.id;
      const prior = writes.has(key) ? writes.get(key) : storage.getItem(key);
      if (prior !== null) {
        let existing;
        try { existing = JSON.parse(prior); } catch { throw new Error('本地同编号笔记无法读取，已停止导入。'); }
        if (stable(existing) !== stable(record)) throw new Error('发现同编号但内容不同的笔记，已停止导入；本地内容未被覆盖。');
        duplicates++;
      } else writes.set(key, JSON.stringify(record));
    }
    for (const draft of importedDrafts) {
      const key = prefix + 'draft:' + draft.key;
      if (writes.has(key) || storage.getItem(key) !== null || memory.has(draft.key)) { keptDrafts++; continue; }
      writes.set(key, JSON.stringify(draft));
    }
    const written = [];
    try {
      for (const [key, value] of writes) { storage.setItem(key, value); written.push(key); }
    } catch {
      let rolledBack = true;
      for (const key of written) { try { storage.removeItem(key); } catch { rolledBack = false; } }
      throw new Error(rolledBack ? '浏览器空间不足或拒绝保存，本次导入已撤回，已有笔记保持原样。'
        : '导入中断，部分条目可能已保存；请导出备份检查，已有笔记未被覆盖。');
    }
    return {addedRecords: [...writes.keys()].filter(key => key.startsWith(prefix + 'record:')).length,
      addedDrafts: [...writes.keys()].filter(key => key.startsWith(prefix + 'draft:')).length,
      duplicates, keptDrafts};
  }
  function rawBackup() {
    const storage = getStorage(), values = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) values[key] = storage.getItem(key);
    }
    return {schema_version: 'vmobserve.replay-notes-raw/v1', exported_at: new Date().toISOString(),
      answer_origin: origin, values};
  }
  return {origin, records, drafts, getDraft, saveDraft, saveRecord, exportArchive, importArchive, rawBackup};
}
