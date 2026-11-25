import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotesStore} from '../work/vmobserve/web/notes-store.js';
import {noteReplayPosition} from '../work/vmobserve/web/notes-library.js';

test('3.3 saved notes reopen the selected policy, repeat and step in either run order', () => {
  const cases = [[1, 'off'], [1, 'on'], [2, 'on'], [2, 'off']].map(([repeat, policy]) => ({
    suite: 'demand512', id: 'demand512-thp-' + policy + '-' + repeat, parameters: {repeat, thp_advice: policy}
  }));
  for (const [index, selected] of cases.entries()) {
    const repeat = selected.parameters.repeat;
    const evidence = {topic: 'group3', selected_record: 'example--archive', case_index: index,
      case_ids: ['off', 'on'].map(policy => 'demand512-thp-' + policy + '-' + repeat), step_index: index + 1};
    const target = noteReplayPosition(cases, evidence);
    assert.deepEqual(Object.fromEntries(target), {run: 'example--archive', topic: 'group3',
      case: String(index), step: String(index + 1)});
    assert.throws(() => noteReplayPosition(cases, {...evidence, case_index: (index + 2) % 4}), /找不到/);
  }
});
class Storage {
  data = new Map(); failAfter = Infinity;
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) {
    if (this.failAfter-- <= 0) throw new DOMException('Full', 'QuotaExceededError');
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
}
function binding(step = 0, caseId = 'sequence-1') {
  const hash = 'a'.repeat(64);
  return {key: JSON.stringify([hash, 'sequence', [caseId], step]), report_sha256: hash,
    topic: 'sequence', case_ids: [caseId], step_index: step, case_index: 0,
    selected_record: 'example--20261116T090129.522833Z', run_id: '20261116T090129.522833Z',
    cases: [{case_id: caseId, samples: [{rss_kib: 4}]}]};
}
const answer = value => ({prediction: value, observation: 'RSS=4 KiB', explanation: '待复验'});
const setup = (verification = false) => {
  const storage = new Storage();
  return {storage, store: createNotesStore(() => storage, verification)};
};
const archive = (store, b = binding()) => store.exportArchive(b, answer('当前'));
const saved = (store, id = 'one', b = binding()) => store.saveRecord(b, answer('预测'), id);
test('drafts are isolated by case and step, reloadable and copied', () => {
  const {storage, store} = setup(), b = binding();
  store.saveDraft(b, answer('第一步'));
  store.saveDraft(binding(1), answer('第二步'));
  store.saveDraft(binding(0, 'sequence-2'), answer('另一轮'));
  const copy = store.getDraft(b); copy.prediction = '外部修改';
  assert.equal(store.getDraft(b).prediction, '第一步');
  assert.equal(createNotesStore(() => storage).getDraft(binding(1)).prediction, '第二步');
});
test('all step drafts are exported along with current content', () => {
  const {store} = setup();
  store.saveDraft(binding(), answer('第一步')); store.saveDraft(binding(1), answer('第二步'));
  const result = store.exportArchive(binding(2), answer('第三步'));
  assert.equal(result.drafts.length, 3); assert.equal(result.current_draft.prediction, '第三步');
});
test('saved notes are immutable and never overwrite an existing id', () => {
  const {store} = setup(); saved(store);
  assert.throws(() => saved(store), /编号已存在/);
  const out = store.records(); out[0].prediction = '外部修改';
  assert.equal(store.records()[0].prediction, '预测');
});
test('blank records and mismatched evidence are rejected', () => {
  const {store} = setup();
  assert.throws(() => store.saveRecord(binding(), {prediction:' ',observation:'',explanation:''}, 'empty'), /先写下/);
  const wrong = binding(); wrong.case_ids = ['unrelated'];
  assert.throws(() => saved(store, 'wrong', wrong), /不完整/);
});
test('new archives restore all records and drafts; repeating import is harmless', () => {
  const {store} = setup(); saved(store); store.saveDraft(binding(1), answer('草稿'));
  const data = archive(store), target = setup();
  assert.deepEqual(target.store.importArchive(data), {addedRecords:1, addedDrafts:2, duplicates:0, keptDrafts:0});
  assert.equal(target.store.getDraft(binding(1)).prediction, '草稿');
  assert.equal(target.store.importArchive(data).duplicates, 1); assert.equal(target.store.records().length, 1);
});
test('previous version archives with only current_draft import correctly', () => {
  const {store} = setup(); saved(store);
  const data = archive(store); delete data.drafts; delete data.current_draft.key;
  assert.equal(setup().store.importArchive(data).addedDrafts, 1);
});
test('imports preserve existing drafts and reject conflicting saved ids before writing', () => {
  const {store} = setup(); saved(store);
  const target = setup(); target.store.saveDraft(binding(), answer('本地回答'));
  target.store.importArchive(archive(store));
  assert.equal(target.store.getDraft(binding()).prediction, '本地回答');
  const conflict = archive(store); conflict.records[0].prediction = '冲突内容';
  const before = [...target.storage.data];
  assert.throws(() => target.store.importArchive(conflict), /同编号/);
  assert.deepEqual([...target.storage.data], before);
});
test('all imported items validate before any storage mutation', () => {
  const {store} = setup(); saved(store); const data = archive(store);
  data.drafts.push({...answer('错误'), key:'broken-key'}); const target = setup();
  assert.throws(() => target.store.importArchive(data), /不完整/); assert.equal(target.storage.length, 0);
});
test('storage quota failure rolls back only newly added items', () => {
  const {store} = setup(); saved(store); const target = setup();
  target.store.saveDraft(binding(8), answer('保留')); const before = [...target.storage.data];
  target.storage.failAfter = 1;
  assert.throws(() => target.store.importArchive(archive(store)), /已撤回/);
  assert.deepEqual([...target.storage.data], before);
});
test('verification records cannot mix with personal notes', () => {
  const qa = setup(true); saved(qa.store); const normal = setup();
  assert.throws(() => normal.store.importArchive(archive(qa.store)), /分别导入/);
  normal.store.saveDraft(binding(), answer('个人回答'));
  assert.equal(qa.store.getDraft(binding()).prediction, ''); assert.equal(normal.store.records().length, 0);
});
test('blocked storage still exports all in-memory drafts', () => {
  const store = createNotesStore(() => { throw new DOMException('Blocked', 'SecurityError'); });
  assert.throws(() => store.saveDraft(binding(), answer('保留草稿')));
  const data = archive(store, binding(1));
  assert.equal(data.saved_records_available, false); assert.equal(data.drafts.length, 2);
  assert.equal(data.drafts[0].prediction, '保留草稿');
});
test('corrupt records stop normal export and remain available in raw backup', () => {
  const {store, storage} = setup(); storage.setItem('vmobserve-replay-notes-v1:record:bad', 'not-json');
  assert.throws(() => archive(store), /无法读取/);
  assert.equal(Object.values(store.rawBackup().values)[0], 'not-json'); assert.equal(storage.length, 1);
});
test('duplicate entries with reordered JSON keys are recognized', () => {
  const {store} = setup(); saved(store); const target = setup(), data = archive(store);
  target.store.importArchive(data); data.records[0] = Object.fromEntries(Object.entries(data.records[0]).reverse());
  assert.equal(target.store.importArchive(data).duplicates, 1);
});
test('separate tabs add independent records without losing previous records', () => {
  const {store, storage} = setup(), other = createNotesStore(() => storage);
  saved(store, 'tab1'); saved(other, 'tab2');
  assert.deepEqual(store.records().map(n => n.id).sort(), ['tab1', 'tab2']);
});

test('malformed origins, identity fields and archive positions are rejected without writes', () => {
  const {store} = setup(); saved(store);
  for (const mutate of [
    data => { data.records[0].id = ['one']; },
    data => { data.records[0].evidence.selected_record = 'https://untrusted.invalid/'; },
    data => { data.records[0].evidence.step_index = 999; },
    data => { data.records[0].assessment = 'graded'; },
    data => { data.records[0].answer_origin = 'ui_verification'; }
  ]) {
    const data = archive(store); mutate(data); const target = setup();
    assert.throws(() => target.store.importArchive(data));
    assert.equal(target.storage.length, 0);
  }
});
test('oversized entry collections are rejected before merging', () => {
  const {store} = setup(); saved(store);
  const data = archive(store); data.records = Array(10001).fill(data.records[0]);
  assert.throws(() => setup().store.importArchive(data), /不完整/);
});
test('quota errors in saving leave previous records intact', () => {
  const {store, storage} = setup(); saved(store);
  storage.failAfter = 0;
  assert.throws(() => saved(store, 'second'));
  assert.equal(store.records().length, 1);
  assert.equal(store.records()[0].id, 'one');
});

test('invalid draft entries produce a readable error before touching storage', () => {
  const {store} = setup(), target = setup(); const data = archive(store);
  data.drafts = [null];
  assert.throws(() => target.store.importArchive(data), /不完整/);
  assert.equal(target.storage.length, 0);
});
