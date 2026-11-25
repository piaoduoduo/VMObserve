export function demandPairTimeline(pair) {
  if (pair.length !== 2 || pair.some(item => item?.status !== 'completed' || item.validation?.status !== 'passed')) return [];
  if (pair[0].parameters?.process_thp !== pair[1].parameters?.process_thp) return [];
  const [off, on] = pair.map(caseItem => caseItem.data?.samples || []);
  if (!off.length || off.length !== on.length) return [];
  const byPhase = new Map(on.map(sample => [sample.phase, sample]));
  const uniqueOff = new Set(off.map(sample => sample.phase));
  if (byPhase.size !== on.length || uniqueOff.size !== off.length) return [];
  const rows = off.map(disabled => ({phase: disabled.phase, disabled, enabled: byPhase.get(disabled.phase)}));
  return rows.every(({disabled, enabled}) => enabled && enabled.count === disabled.count) ? rows : [];
}

export function demandMeasurement(sample, metric) {
  if (!sample) return null;
  if (metric === 'count' ? sample.phase === 'freed' :
    metric !== 'action_minor' && !sample.mapping_present) return null;
  const value = sample[metric];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function demandMetricValues({disabled, enabled}, metric) {
  return [demandMeasurement(disabled, metric), demandMeasurement(enabled, metric)];
}

export function demandMetricData(rows, metric) {
  const readings = rows.map(row => ({phase: row.phase, values: demandMetricValues(row, metric)}));
  const maximum = Math.max(0, ...readings.flatMap(row => row.values.filter(value => value !== null)));
  return {readings, maximum};
}

export function demandRepeatReadings(report, phase) {
  if (report.data_origin !== 'real_execution' || report.integrity?.status !== 'verified') return [];
  const rounds = new Map();
  for (const item of report.cases) {
    const {repeat, thp_advice} = item.parameters || {};
    if (item.suite !== 'demand512' || !Number.isSafeInteger(repeat) || repeat < 1 ||
        !['off', 'on'].includes(thp_advice)) continue;
    if (!rounds.has(repeat)) rounds.set(repeat, {off: [], on: []});
    rounds.get(repeat)[thp_advice].push(item);
  }

  return [...rounds].sort(([a], [b]) => a - b).map(([repeat, {off, on}]) => {
    if (off.length !== 1 || on.length !== 1) return {repeat, issue: 'pair'};
    const pair = [off[0], on[0]];
    if (pair.some(item => item.status !== 'completed' || item.validation?.status !== 'passed')) {
      return {repeat, issue: 'validation'};
    }
    if (off[0].parameters.process_thp !== on[0].parameters.process_thp) return {repeat, issue: 'condition'};
    const reading = demandPairTimeline(pair).find(row => row.phase === phase);
    return reading ? {repeat, ...reading} : {repeat, issue: 'phase'};
  });
}

export function demandExerciseReadings(row) {
  if (!row || row.issue) return null;
  const [disabledRss, enabledRss] = demandMetricValues(row, 'rss_kib');
  const enabledHuge = demandMeasurement(row.enabled, 'huge_kib');
  const faults = demandMetricValues(row, 'action_minor');
  if ([disabledRss, enabledRss, enabledHuge, ...faults].includes(null)) return null;
  return {
    disabledRss, enabledRss, enabledHuge,
    rss: Math.sign(enabledRss - disabledRss),
    huge: enabledHuge > 0 ? 'present' : 'zero'
  };
}

export function demandRepeatMetric(rows, metric) {
  const values = rows.map(row => demandMetricValues(row, metric));
  const deltas = values.filter(([off, on]) => off !== null && on !== null)
    .map(([off, on]) => on - off).sort((a, b) => a - b);
  const count = deltas.length;
  const middle = Math.floor(count / 2);
  const summary = count ? {
    count, median: (deltas[Math.floor((count - 1) / 2)] + deltas[middle]) / 2,
    min: deltas[0], max: deltas.at(-1)
  } : null;
  return {values, summary};
}

export function liveRequestedKib(sample) {
  return Array.isArray(sample.blocks)
    ? sample.blocks.filter(block => block.alive)
      .reduce((sum, block) => sum + block.requested_bytes / 1024, 0)
    : null;
}

export function replaySample(item, step) {
  const samples = item?.data?.samples || [];
  if (item?.suite === 'stack') return step === 0 ? samples[0] : step === 1 ? samples.at(-1) : null;
  return samples[step] || null;
}
export function matchingSample(item, source) {
  if (!source) return null;
  const matches = (item?.data?.samples || []).filter(sample =>
    sample.phase === source.phase && (sample.role || '') === (source.role || ''));
  return item?.suite === 'stack' ? matches.at(-1) : matches.length === 1 ? matches[0] : null;
}
const specs = {
  sequence: [
    ['存活块申请量', 'KiB', liveRequestedKib],
    ['涉及的 VMA 数', '个', sample => sample.related_vma_count],
    ['相关映射大小', 'KiB', sample => sample.related_size_kib],
    ['相关映射 RSS（每段只计一次）', 'KiB', sample => sample.related_rss_kib]
  ],
  memory: [
    ['目标映射大小', 'KiB', 'size_kib'],
    ['目标映射 RSS', 'KiB', 'rss_kib'],
    ['目标映射 PSS', 'KiB', 'pss_kib'],
    ['其中匿名大页', 'KiB', 'huge_kib']
  ]
};
export function comparisonMetrics(suite, current, other) {
  if (!current || !other) return [];
  const readField = key => sample => suite === 'demand512' ? demandMeasurement(sample, key) : sample[key];
  const metrics = suite === 'sequence' ? [...specs.sequence] :
    specs.memory.map(([label, unit, key]) => [label, unit, readField(key)]);
  metrics.push(['本步次缺页', '次', readField('action_minor')]);
  if (suite === 'stack') metrics.unshift(['采样递归深度', '层', sample => sample.count]);
  if (suite === 'course') metrics.unshift(['已写位置', '个', sample => sample.written_positions]);
  if (suite === 'demand512') metrics.unshift(['已写位置', '个', readField('count')]);
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  return metrics.map(([label, unit, read]) => {
    const left = read(current), right = read(other);
    return {label, unit, current: numeric(left) ? left : null, other: numeric(right) ? right : null,
      delta: numeric(left) && numeric(right) ? right - left : null};
  }).filter(metric => metric.current !== null || metric.other !== null);
}
export function parameterDifferences(current, other) {
  const left = current?.parameters || {}, right = other?.parameters || {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => key !== 'repeat')
    .filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .map(key => ({key, current: left[key] ?? null, other: right[key] ?? null}));
}

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function environmentDifferences(current, other) {
  const keys = ['system', 'kernel', 'machine', 'libc', 'page_bytes', 'allocator_environment',
    'thp_enabled', 'thp_defrag', 'pmd_size', 'execution_context'];
  return keys.filter(key => canonical(current?.[key]) !== canonical(other?.[key]))
    .map(key => ({key, current: current?.[key] ?? null, other: other?.[key] ?? null}));
}
export function sameSources(current, other) { return canonical(current) === canonical(other); }
