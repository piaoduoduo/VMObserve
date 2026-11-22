import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demandPairTimeline, demandMetricData, liveRequestedKib, replaySample, matchingSample, comparisonMetrics, parameterDifferences} from '../work/vmobserve/web/comparison-data.js';
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
