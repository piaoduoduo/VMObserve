import {esc, kib} from './ui.js';
import {demandMeasurement} from './comparison-data.js';
import {groupBlocksIntoRegions, sequenceRssEquation} from './sequence-view.js';

function sequenceReading(sample, label) {
  const regions = groupBlocksIntoRegions(sample);
  const addresses = regions.map(region => esc(region.start) + '–' + esc(region.end) + '：' + esc(kib(region.rss_kib)));
  return '<p>' + label + '，按映射去重的 RSS 为 ' + esc(sequenceRssEquation(sample, regions)) + '。' +
    (addresses.length ? '各段读数（地址范围）：' + addresses.join('，') + '。' : '') + '</p>';
}

function rowsFor(caseRecord) {
  const sample = caseRecord.samples?.[0];
  if (!sample) return '';
  if (caseRecord.suite === 'sequence') {
    if (caseRecord.stage !== 'comparison') return sequenceReading(sample, '本步采样');
    return caseRecord.samples.filter(row => row.phase === 'alloc_1MiB' || row.phase === 'freed')
      .map(row => sequenceReading(row, row.phase === 'freed' ? '全部释放后，按旧地址查找' : '第三次申请后'))
      .join('');
  }
  return '<dl>' + [
    ['采样阶段', sample.phase], ['累计写入位置', demandMeasurement(sample, 'count')],
    ['目标映射 RSS（KiB）', demandMeasurement(sample, 'rss_kib')],
    ['匿名大页（KiB）', demandMeasurement(sample, 'huge_kib')],
    ['进程本步次缺页', demandMeasurement(sample, 'action_minor')],
    ['大页建议及返回值', caseRecord.policy && caseRecord.policy.policy + ' / ' + caseRecord.policy.result],
    ...(caseRecord.condition?.process_thp ? [
      ['进程级大页设置', caseRecord.condition.process_thp],
      ['进程级禁用读回', caseRecord.condition.process_thp_disabled]
    ] : []),
    ['VmFlags', sample.vm_flags?.join(' ')]
  ].map(([name, value]) => '<dt>' + esc(name) + '</dt><dd>' + esc(value ?? '—') + '</dd>').join('') + '</dl>';
}

export function learningReport(entries, {verification = false} = {}) {
  const page = entries.map(({evidence, prediction, observation, explanation}) => {
    const lab = evidence.topic === 'sequence' ? '3.2 连续 malloc' : '3.3 按需调页';
    const env = evidence.environment || {};
    const conditions = [
      Number.isFinite(env.page_bytes) ? '基础页 ' + env.page_bytes + ' 字节' : null,
      env.thp_enabled ? '系统 THP ' + env.thp_enabled : null
    ].filter(Boolean);
    return '<section><h2>' + lab + ' · 第 ' + (evidence.step_index + 1) + ' 步</h2>' +
      '<p>运行编号 <code>' + esc(evidence.run_id) + '</code> · ' + esc(env.distribution || '系统未记录') + ' · ' +
      esc(env.kernel || '内核未记录') + ' · ' + esc(env.execution_context || '执行环境未记录') + '</p>' +
      (conditions.length ? '<p>' + esc(conditions.join(' · ')) + '</p>' : '') +
      '<p>报告 SHA-256 <code>' + esc(evidence.report_sha256) + '</code></p>' +
      '<p>校验状态 ' + esc(evidence.integrity?.status || '未记录') + ' · 数据来源 ' + esc(evidence.data_origin || '未记录') + '</p>' +
      [['我的预测', prediction], ['我的观测与原文依据', observation], ['解释与复验', explanation]].map(([name, value]) =>
        '<h3>' + name + '</h3><p class="answer">' + esc(value || '待填写') + '</p>').join('') +
      '<h3>采样与复核</h3>' + evidence.cases.map(item => {
        const artifacts = Object.values(item.artifacts || {}).map(path => '<li><code>' + esc(path) + '</code>' +
          (item.artifact_sha256?.[path] ? ' · SHA-256 <code>' + esc(item.artifact_sha256[path]) + '</code>' : '') + '</li>');
        return '<article><h4>' + esc(item.case_id) + '</h4>' +
          '<p>检查结果 ' + esc(item.validation?.status || '未记录') + '</p>' + rowsFor(item) +
          '<ul>' + artifacts.join('') + '</ul></article>';
      }).join('') + '</section>';
  }).join('');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>VMObserve 实验报告</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#152139}' +
    'section{border-top:1px solid #b9c6d7;margin-top:24px}article{background:#f2f6fb;padding:8px 16px;margin:12px 0;break-inside:avoid}' +
    'code{overflow-wrap:anywhere}dt{font-weight:600}dd{margin:0 0 8px}.answer{white-space:pre-wrap;overflow-wrap:anywhere}h4{margin:8px 0}</style>' +
    '<h1>VMObserve 实验报告</h1><p>' + (verification ? '界面验证记录' : '学习者记录') + ' · 个人解释未评分</p>' +
    page + '</html>';
}
