import {state, esc, api, url, table, friendlyTime} from './ui.js';
import {viewCases} from './curriculum.js';
import {replaySample, matchingSample, comparisonMetrics, parameterDifferences, environmentDifferences, sameSources} from './comparison-data.js';

const supported = new Set(['sequence', 'demand512', 'stack', 'course', 'baseline']);
const choices = new Map();
const parameterNames = {requested_kib: '申请量（KiB）', mib: '映射大小（MiB）', mode: '运行方式',
  limit_kib: '栈上限（KiB）', cow_fraction: '子进程改写比例', pattern: '访问方式', implementation: '实现版本'};
const environmentNames = {system: '操作系统', kernel: '内核', machine: '架构', libc: 'C 库', page_bytes: '基础页大小（字节）',
  allocator_environment: '分配器环境变量', thp_enabled: 'THP 全局开关', thp_defrag: 'THP 碎片整理', pmd_size: 'PMD 大页大小', execution_context: '执行环境'};
const phaseNames = {before_alloc: '申请前', alloc_1KiB: '申请 1 KiB 后', alloc_256KiB: '申请 256 KiB 后',
  alloc_1MiB: '申请 1 MiB 后', allocated: '申请后', freed: '释放后', untouched: '尚未读写', read_all: '逐页只读',
  write_quarter: '写入四分之一', write_half: '写入一半', write_all: '全部写入', fork_shared: '刚 fork 共享',
  child_write: '子进程改写后', child_write_quarter: '子进程改写后', before_stack: '递归前', stack: '递归增长'};
const stageLabel = sample => (phaseNames[sample.phase] || sample.phase) + (sample.role ? ' · ' + ({parent: '父进程', child: '子进程'}[sample.role] || sample.role) : '');
const show = value => value == null ? '未记录' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const format = (value, unit, delta = false) => value == null ? '未采集' :
  (delta && value > 0 ? '+' : '') + value + ' ' + unit;
const environment = report => [report.environment?.distribution?.PRETTY_NAME || report.environment?.system,
  report.environment?.kernel].filter(Boolean).join(' · ') || '环境未记录';
const origin = report => report.data_origin === 'real_execution' ? '实测记录' :
  report.data_origin === 'synthetic' ? '模拟记录' : '数据来源未标记';

export function renderReplayComparison() {
  const list = viewCases(state.report?.cases || [], state.tab, item => item.suite);
  if (state.tab === 'course') list.sort((a, b) =>
    b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  const current = list[state.selected], sample = replaySample(current, state.phase);
  if (!current || !supported.has(current.suite) || !sample) return;
  const binding = {id: state.id, topic: state.tab, report: state.report, current, sample, step: state.phase};
  const key = JSON.stringify([binding.id, binding.topic, current.id]);
  const previous = choices.get(key);
  const runs = state.runs.filter(run => run.id === binding.id || run.suites?.includes(current.suite));
  const hasAnotherCase = list.some(item => item.suite === current.suite && item.id !== current.id && item.data?.samples?.length);
  const defaultRun = hasAnotherCase ? binding.id : runs.find(run => run.id !== binding.id)?.id || binding.id;
  const initial = previous && runs.some(run => run.id === previous.run) ? previous : {run: defaultRun};
  document.querySelector('#content').insertAdjacentHTML('beforeend',
    '<details class="replay-comparison"><summary>把本步与另一轮实验并排对照</summary>' +
    '<p class="detail-copy">按采样阶段与父／子进程角色匹配。差值 = 对照 − 当前；缺少数据时保留“未采集”。</p>' +
    '<div class="comparison-pickers"><label>对照记录<select class="comparison-run">' +
    runs.map(run => '<option value="' + esc(run.id) + '" ' + (run.id === initial.run ? 'selected' : '') + '>' +
      esc((run.id === binding.id ? '当前记录' : run.distribution || run.group) + ' · ' + friendlyTime(run.run_id)) +
      '</option>').join('') + '</select></label><label>对照案例<select class="comparison-case"></select></label></div>' +
    '<div class="comparison-result" role="region" aria-label="本步实验对照"></div></details>');
  const panel = document.querySelector('.replay-comparison');
  const runPicker = panel.querySelector('.comparison-run'), casePicker = panel.querySelector('.comparison-case');
  const result = panel.querySelector('.comparison-result');
  let otherReport = null, otherRun = null, request = 0;
  const render = () => {
    const other = otherReport?.cases.find(item => item.id === casePicker.value);
    choices.set(key, {run: otherRun, caseId: other?.id, open: panel.open});
    if (!other) { result.innerHTML = '<p class="detail-copy">这份记录里没有可对照的同类案例。</p>'; return; }
    const matched = matchingSample(other, sample);
    if (!matched) {
      result.innerHTML = '<p class="detail-copy">对照案例没有唯一匹配的阶段与进程角色，暂不计算差值。当前阶段：' +
        esc(sample.phase) + ' · ' + esc(sample.role || '未记录角色') + '。</p>';
      return;
    }
    const differences = parameterDifferences(current, other);
    const metrics = comparisonMetrics(current.suite, sample, matched);
    const same = otherRun === binding.id && other.id === current.id;
    const environmentChanges = environmentDifferences(binding.report.environment, otherReport.environment);
    const changedEnvironment = environment(otherReport) !== environment(binding.report) || environmentChanges.length > 0;
    const changedSources = !sameSources(otherReport.sources, binding.report.sources);
    const warning = [
      same ? '当前选中了同一个案例，可切换另一轮查看变化。' : '',
      differences.length ? '实验参数有差异，先核对下表，再解释数值变化。' : '记录中的实验参数相同（重复编号除外）。',
      changedEnvironment ? '环境记录有差异，可展开核对内核、分配器与大页设置。' : '',
      changedSources ? '两份记录的源码清单有差异。' : '',
      current.suite === 'stack' && sample.count !== matched.count ? '两次最后采样的递归深度不同，驻留量不能直接作为相同深度的对照。' : '',
      otherReport.integrity?.status === 'failed' ? '对照记录有文件未通过完整性检查，请先核对原文。' : ''
    ].filter(Boolean).join(' ');
    const candidates = viewCases(otherReport.cases, binding.topic, item => item.suite);
    if (binding.topic === 'course') candidates.sort((a, b) =>
      b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
    const otherIndex = candidates.findIndex(item => item.id === other.id);
    const otherStep = other.suite === 'stack' ? binding.step : other.data.samples.indexOf(matched);
    const link = new URL('/', location.origin);
    if (new URLSearchParams(location.search).get('verification') === '1') link.searchParams.set('verification', '1');
    link.hash = new URLSearchParams({run: otherRun, topic: binding.topic, case: otherIndex, step: otherStep});
    result.innerHTML = '<p class="comparison-context">当前：' + esc(current.id) + ' · 对照：' + esc(other.id) +
      ' · ' + esc(stageLabel(sample)) + '</p>' +
      '<p class="detail-copy">' + esc(warning) + '</p>' +
      (differences.length ? table(['条件', '当前', '对照'], differences.map(diff =>
        [parameterNames[diff.key] || diff.key, show(diff.current), show(diff.other)])) : '') +
      table(['观测指标', '当前', '对照', '差值'], metrics.map(metric => [metric.label,
        format(metric.current, metric.unit), format(metric.other, metric.unit), format(metric.delta, metric.unit, true)])) +
      '<details class="secondary-fold"><summary>核对两份数据的环境与检查状态</summary>' +
      table(['项目', '当前', '对照'], [
        ['案例', current.id, other.id], ['数据来源', origin(binding.report), origin(otherReport)],
        ['系统与内核', environment(binding.report), environment(otherReport)],
        ['数据检查', current.validation?.status, other.validation?.status],
        ['完整性', binding.report.integrity?.status, otherReport.integrity?.status],
        ...Object.keys(environmentNames).filter(key => binding.report.environment?.[key] != null || otherReport.environment?.[key] != null)
          .map(key => [environmentNames[key], show(binding.report.environment?.[key]), show(otherReport.environment?.[key])])]) + '</details>' +
      '<div class="actions"><a class="btn-link" href="' + esc(link.href) + '">打开对照实验与原文</a>' +
      '<button class="comparison-export">导出当前对照</button></div>';
    result.querySelector('.comparison-export').onclick = () => {
      const archived = {schema_version: 'vmobserve.replay-comparison/v1', exported_at: new Date().toISOString(),
        calculation: 'other_minus_current', parameters_differ: differences, environment_differ: environmentChanges, sources_differ: changedSources, metrics,
        current: {record: binding.id, report_sha256: binding.report.original_report_sha256,
          environment: binding.report.environment, source_sha256: binding.report.sources, data_origin: binding.report.data_origin, integrity: binding.report.integrity,
          case_id: current.id, parameters: current.parameters, validation: current.validation, artifacts: current.artifacts, sample},
        other: {record: otherRun, report_sha256: otherReport.original_report_sha256,
          environment: otherReport.environment, source_sha256: otherReport.sources, data_origin: otherReport.data_origin, integrity: otherReport.integrity,
          case_id: other.id, parameters: other.parameters, validation: other.validation, artifacts: other.artifacts, sample: matched}};
      const blob = URL.createObjectURL(new Blob([JSON.stringify(archived, null, 2)], {type: 'application/json'}));
      const anchor = document.createElement('a'); anchor.href = blob; anchor.download = 'vmobserve-comparison.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    };
  };
  const load = async () => {
    const ticket = ++request, id = runPicker.value;
    result.textContent = '正在读取对照记录…'; casePicker.disabled = true;
    try {
      const report = id === binding.id ? binding.report : await api(url('/api/report', {id}));
      if (ticket !== request || !panel.isConnected) return;
      otherReport = report; otherRun = id;
      const cases = report.cases.filter(item => item.suite === current.suite && item.data?.samples?.length);
      const remembered = choices.get(key)?.caseId || initial.caseId;
      const selected = cases.find(item => item.id === remembered) ||
        cases.find(item => !(id === binding.id && item.id === current.id)) || cases[0];
      casePicker.innerHTML = cases.map(item => '<option value="' + esc(item.id) + '" ' +
        (item.id === selected?.id ? 'selected' : '') + '>' + esc(item.id + ' · 第 ' + item.parameters.repeat + ' 次') + '</option>').join('');
      render();
    } catch (error) {
      if (ticket === request && panel.isConnected) result.textContent = '无法读取对照记录：' + error.message;
    } finally { if (ticket === request) casePicker.disabled = false; }
  };
  runPicker.addEventListener('change', load);
  casePicker.addEventListener('change', render);
  panel.addEventListener('toggle', () => {
    if (panel.open && !otherReport) load();
    const selection = choices.get(key) || initial;
    choices.set(key, {...selection, open: panel.open});
  });
  if (initial.open) panel.open = true;
}
