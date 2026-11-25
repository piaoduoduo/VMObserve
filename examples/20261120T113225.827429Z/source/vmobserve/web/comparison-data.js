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
    ['存活块申请量', 'KiB', sample => Array.isArray(sample.blocks)
      ? sample.blocks.filter(block => block.alive).reduce((sum, block) => sum + block.requested_bytes / 1024, 0) : null],
    ['涉及的 VMA 数', '个', sample => sample.related_vma_count],
    ['相关映射大小', 'KiB', sample => sample.related_size_kib],
    ['相关映射 RSS（每段只计一次）', 'KiB', sample => sample.related_rss_kib]
  ],
  memory: [
    ['目标映射大小', 'KiB', sample => sample.size_kib],
    ['目标映射 RSS', 'KiB', sample => sample.rss_kib],
    ['目标映射 PSS', 'KiB', sample => sample.pss_kib],
    ['其中匿名大页', 'KiB', sample => sample.huge_kib]
  ]
};
export function comparisonMetrics(suite, current, other) {
  if (!current || !other) return [];
  const metrics = [...specs[suite === 'sequence' ? 'sequence' : 'memory'],
    ['本步次缺页', '次', sample => sample.action_minor]];
  if (suite === 'stack') metrics.unshift(['采样递归深度', '层', sample => sample.count]);
  if (suite === 'course') metrics.unshift(['已写位置', '个', sample => sample.written_positions]);
  if (suite === 'demand512') metrics.unshift(['已写位置', '个', sample => sample.count]);
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
