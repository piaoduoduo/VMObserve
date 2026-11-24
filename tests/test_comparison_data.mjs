import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demandPairTimeline, demandMetricData, demandRepeatReadings, demandRepeatMetric, liveRequestedKib, replaySample, matchingSample, comparisonMetrics, parameterDifferences} from '../work/vmobserve/web/comparison-data.js';
import {groupBlocksIntoRegions, sharedPointerRegion} from '../work/vmobserve/web/sequence-view.js';
import {learningReport} from '../work/vmobserve/web/learning-report.js';
const item = (suite, samples, parameters = {}) => ({suite, data: {samples}, parameters});
test('sample matching uses phase and process role rather than array index', () => {
  const source = {phase:'fork_shared',role:'child'};
  const other = item('baseline', [{phase:'fork_shared',role:'parent',rss_kib:4},
    {phase:'fork_shared',role:'child',rss_kib:8}]);
  assert.equal(matchingSample(other, source).rss_kib, 8);
  assert.equal(matchingSample(other, {phase:'not-present',role:'child'}), null);
});
test('ambiguous phases are not silently compared', () => {
  const other = item('course', [{phase:'written'}, {phase:'written'}]);
  assert.equal(matchingSample(other, {phase:'written'}), null);
});
test('stack comparison uses last captured recursive sample and skips exit outcome', () => {
  const stack = item('stack', [{phase:'before',count:0},{phase:'recurse',count:10},{phase:'recurse',count:20}]);
  assert.equal(replaySample(stack, 1).count, 20);
  assert.equal(replaySample(stack, 2), null);
  assert.equal(matchingSample(stack, {phase:'recurse',count:10}).count, 20);
});
test('sequence uses deduplicated VMA readings and counts only live allocations', () => {
  const current = {blocks:[{alive:true,requested_bytes:1024},{alive:true,requested_bytes:262144}],
    related_rss_kib:8, related_size_kib:400, related_vma_count:2, action_minor:1};
  const other = {...current, blocks:current.blocks.map(b=>({...b,alive:false})), related_rss_kib:4};
  const rows = comparisonMetrics('sequence', current, other);
  assert.equal(rows.find(r=>r.label==='存活块申请量').current, 257);
  assert.equal(rows.find(r=>r.label==='存活块申请量').other, 0);
  assert.equal(rows.find(r=>r.label.includes('每段只计一次')).delta, -4);
});
test('missing metrics stay null instead of becoming observed zeroes', () => {
  const rows = comparisonMetrics('course', {rss_kib:0,action_minor:2}, {rss_kib:4});
  const rss = rows.find(r=>r.label==='目标映射 RSS'), faults = rows.find(r=>r.label==='本步次缺页');
  assert.deepEqual([rss.current,rss.other,rss.delta], [0,4,4]);
  assert.deepEqual([faults.current,faults.other,faults.delta], [2,null,null]);
});
test('changing experiment parameters is visible while repeat number is ignored', () => {
  const diff = parameterDifferences({parameters:{repeat:1,requested_kib:1024,mode:'normal'}},
    {parameters:{repeat:2,requested_kib:2048,mode:'normal'}});
  assert.deepEqual(diff, [{key:'requested_kib',current:1024,other:2048}]);
});
test('empty or incomplete cases have no invented samples or metrics', () => {
  assert.equal(replaySample({suite:'course'}, 0), null);
  assert.deepEqual(comparisonMetrics('course',null,{}), []);
  assert.equal(matchingSample(item('baseline', []), {phase:'read_all'}), null);
});

test('environment comparison includes allocator and page settings but excludes capture time', async () => {
  const {environmentDifferences} = await import('../work/vmobserve/web/comparison-data.js');
  const left = {kernel:'6.6',page_bytes:4096,allocator_environment:{A:null,B:'1'},captured_at:'yesterday'};
  const reordered = {...left, allocator_environment:{B:'1',A:null},captured_at:'today'};
  assert.deepEqual(environmentDifferences(left,reordered), []);
  assert.deepEqual(environmentDifferences(left,{...reordered,page_bytes:65536}), [{key:'page_bytes',current:4096,other:65536}]);
});
test('source manifests compare by file and hash instead of JSON property order', async () => {
  const {sameSources} = await import('../work/vmobserve/web/comparison-data.js');
  assert.equal(sameSources({a:'1',b:'2'},{b:'2',a:'1'}), true);
  assert.equal(sameSources({a:'1'},{a:'2'}), false);
});

import {demandEnvironmentReplays} from '../work/vmobserve/web/curriculum.js';

test('demand environment links preserve policy, repeat and phase across distinct case ordering', () => {
  const run = (id, distribution, case_keys) => ({
    id, run_id: id.slice(id.indexOf('--') + 2), distribution, case_keys,
    group: 'example', status: 'completed', data_origin: 'real_execution'
  });
  const group = (policy, repeat) => ['demand512', null, policy, repeat];
  const current = run('example--0002','openEuler',[group('off',2),group('on',2)]);
  const other = run('example--0001','Ubuntu',[
    ['io','7.2'],group('off',1),group('on',1),group('on',2),group('off',2)
  ]);
  const alias = {...current,id:'local--0002',group:'local'};
  const partial = run('example--0003','Debian',[group('on',2)]);
  const invalid = {...other,id:'example--0004',run_id:'0004',environment_issue:'digest mismatch'};
  const simulated = {...other,id:'example--0005',run_id:'0005',data_origin:'simulation'};
  const options = demandEnvironmentReplays([other, current, alias, partial, invalid, simulated],current.id,
    {repeat:2,thp_advice:'on'},4);
  assert.deepEqual(options.map(({run,index,step,current}) => [run.id,index,step,current]),[
    ['example--0002',1,4,true],['example--0001',2,4,false]
  ]);
});

test('demand pair timeline joins by phase and rejects incomplete or mismatched measurements', () => {
  const sample = (phase, count, rss_kib) => ({phase, count, rss_kib});
  const make = samples => ({validation: {status: 'passed'}, data: {samples}});
  const off = make([sample('allocated', 0, 0), sample('write_quarter', 32768, 131072)]);
  const on = make([sample('write_quarter', 32768, 131072), sample('allocated', 0, 0)]);
  assert.deepEqual(demandPairTimeline([off, on]).map(row => [row.phase, row.enabled.rss_kib]),
    [['allocated', 0], ['write_quarter', 131072]]);
  assert.deepEqual(demandPairTimeline([off]), []);
  assert.deepEqual(demandPairTimeline([off, {...on, validation: {status: 'failed'}}]), []);
  on.data.samples[0].count = 1;
  assert.deepEqual(demandPairTimeline([off, on]), []);
});

test('demand charts distinguish missing mappings, zero RSS and per-process counts', () => {
  const absent = {mapping_present: false, rss_kib: 0, huge_kib: 0, action_minor: 3};
  const untouched = {mapping_present: true, rss_kib: 0, huge_kib: null, action_minor: 0};
  const written = {mapping_present: true, rss_kib: 131072, huge_kib: 131072, action_minor: 64};
  const rows = [
    {phase: 'before_alloc', disabled: absent, enabled: absent},
    {phase: 'allocated', disabled: untouched, enabled: untouched},
    {phase: 'write_quarter', disabled: {...written, huge_kib: 0, action_minor: 32768}, enabled: written}
  ];
  const rss = demandMetricData(rows, 'rss_kib');
  assert.equal(rss.maximum, 131072);
  assert.deepEqual(rss.readings.map(row => row.values), [[null, null], [0, 0], [131072, 131072]]);
  const huge = demandMetricData(rows, 'huge_kib');
  assert.deepEqual(huge.readings.map(row => row.values), [[null, null], [null, null], [0, 131072]]);
  const faults = demandMetricData(rows, 'action_minor');
  assert.equal(faults.maximum, 32768);
  assert.deepEqual(faults.readings.map(row => row.values), [[3, 3], [0, 0], [32768, 64]]);
  assert.deepEqual(demandMetricData(rows.slice(0, 1), 'rss_kib'), {maximum: 0,
    readings: [{phase: 'before_alloc', values: [null, null]}]});
});

test('requested size drops to zero when the sampled blocks have been freed', () => {
  const block = {alive: true, requested_bytes: 262144};
  assert.equal(liveRequestedKib({blocks: [block]}), 256);
  assert.equal(liveRequestedKib({blocks: [{...block, alive: false}]}), 0);
  assert.equal(liveRequestedKib({}), null);
});

test('repeat review uses eligible pairs in repeat order and gives a reason for exclusions', () => {
  const phase = 'write_quarter';
  const thp = (repeat, advice, rows, status = 'passed') => ({
    ...item('demand512', rows, {repeat, thp_advice: advice}),
    status: 'completed', validation: {status}
  });
  const sample = {phase, count: 32768, mapping_present: true, rss_kib: 131072, action_minor: 32768};
  const huge = {...sample, action_minor: 64};
  const cases = [
    thp(4, 'off', [sample]), thp(4, 'on', [{...huge, count: 0}]),
    thp(2, 'off', [sample]),
    thp(3, 'off', [sample]), thp(3, 'on', [huge], 'failed'),
    thp(1, 'on', [huge]), thp(1, 'off', [sample]),
    thp(5, 'off', [sample]), thp(5, 'off', [sample]), thp(5, 'on', [huge]),
    item('demand512', [sample], {repeat: 6})
  ];
  const report = {data_origin: 'real_execution', integrity: {status: 'verified'}, cases};
  const rows = demandRepeatReadings(report, phase);
  assert.deepEqual(rows.map(row => [row.repeat, row.issue]), [
    [1, undefined], [2, 'pair'], [3, 'validation'], [4, 'phase'], [5, 'pair']
  ]);
  assert.deepEqual(demandRepeatMetric(rows, 'action_minor').summary,
    {count: 1, median: -32704, min: -32704, max: -32704});
  assert.deepEqual(demandRepeatReadings({...report, data_origin: 'simulation'}, phase), []);
  assert.deepEqual(demandRepeatReadings({...report, integrity: {status: 'unverified'}}, phase), []);
});

test('repeat metrics use paired differences and leave absent mappings blank', () => {
  const reading = (rss_kib, action_minor, mapping_present = true) => ({rss_kib, action_minor, mapping_present});
  const rows = [
    {disabled: reading(32, 8), enabled: reading(40, 2)},
    {disabled: reading(0, 9, false), enabled: reading(50, 3)},
    {disabled: reading(20, 7), enabled: reading(21, 3)}
  ];
  assert.deepEqual(demandRepeatMetric(rows, 'rss_kib'), {
    values: [[32, 40], [null, 50], [20, 21]], summary: {count: 2, median: 4.5, min: 1, max: 8}
  });
  assert.deepEqual(demandRepeatMetric(rows, 'action_minor').summary, {count: 3, median: -6, min: -6, max: -4});
  assert.deepEqual(demandRepeatMetric(rows.slice(1, 2), 'rss_kib'), {values: [[null, 50]], summary: null});
});

test('demand comparisons keep a missing mapping separate from a measured zero', () => {
  const absent = {phase: 'freed', mapping_present: false, count: 0, rss_kib: 0, huge_kib: 0, action_minor: 2};
  const mapped = {phase: 'freed', mapping_present: true, count: 0, rss_kib: 8, huge_kib: 0, action_minor: 1};
  const rows = comparisonMetrics('demand512', absent, mapped);
  assert.deepEqual(rows.map(({label, current, other, delta}) => [label, current, other, delta]), [
    ['目标映射 RSS', null, 8, null], ['其中匿名大页', null, 0, null], ['本步次缺页', 2, 1, -1]
  ]);
  assert.deepEqual(comparisonMetrics('demand512', absent, absent).map(row => row.label), ['本步次缺页']);
  const allocated = {...mapped, phase: 'allocated'};
  assert.equal(comparisonMetrics('demand512', allocated, allocated)[0].current, 0);
});

test('a shared range does not imply the malloc pointers belong to the same VMA', () => {
  const first = {start: '1000', end: '2000', rss_kib: 4};
  const second = {start: '2000', end: '3000', rss_kib: 8};
  const block = (address, mapping, mappings) => ({address, mapping, mappings, alive: true});
  const blocks = [
    block('1010', first, [first]),
    block('1ff0', first, [first, second]),
    block('2200', second, [second])
  ];
  const regions = groupBlocksIntoRegions({blocks});
  assert.deepEqual(regions[1].blocks.map(({num, containsPointer}) => [num, containsPointer]), [[2, false], [3, true]]);
  assert.equal(sharedPointerRegion(regions), undefined);
  assert.equal(regions.reduce((total, region) => total + region.rss_kib, 0), 12);
});

test('learning report keeps released write count and absent VMA measurements blank', () => {
  const sample = {phase: 'freed', count: 0, mapping_present: false, rss_kib: 0, huge_kib: 0, action_minor: 0};
  const cases = [{suite: 'demand512', case_id: 'case-1', samples: [sample]}];
  const html = learningReport([{evidence: {topic: 'group3', step_index: 5, cases}}]);
  assert.match(html, /<dt>累计写入位置<\/dt><dd>—<\/dd>/);
  assert.match(html, /<dt>目标映射 RSS（KiB）<\/dt><dd>—<\/dd>/);
  assert.match(html, /<dt>进程本步次缺页<\/dt><dd>0<\/dd>/);
});
