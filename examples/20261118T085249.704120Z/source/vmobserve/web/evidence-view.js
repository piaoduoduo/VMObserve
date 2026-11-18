import { $, state, esc, labels, evidenceButtons } from './ui.js';

const experimentNames = {
  sequence: '连续分配 malloc',
  baseline: '写时复制 COW',
  thp: '透明大页',
  layout: '程序地址与映射',
  course: '按需分配',
  stack: '栈增长',
  demand512: '按需调页',
  'link-dynamic': '动态链接',
  'link-static': '静态链接'
};

const validationLabels = {
  passed: '检查通过',
  failed: '检查未通过',
  deviation: '有数值偏差',
  insufficient_evidence: '数据不完整'
};

function statusOf(c) {
  if (c.integrity === 'failed' || ['failed', 'deviation'].includes(c.validation?.status) ||
      ['failed', 'timeout', 'cancelled', 'completed_with_deviations'].includes(c.status)) return 'attention';
  return c.status === 'completed' && c.validation?.status === 'passed' ? 'passed' : 'unavailable';
}

function showMatches() {
  const term = $('#evidence-search').value.trim().toLowerCase();
  const status = $('#evidence-status').value;
  const cases = state.report.cases;
  const found = cases.filter(c => {
    const name = experimentNames[c.suite] || (c.suite.startsWith('g4-') ? '进程与线程' : '');
    const text = [c.id, c.suite, name, ...Object.entries(c.parameters || {}).map(([k, v]) => k + '=' + v)].join(' ');
    return text.toLowerCase().includes(term) && (status === 'all' || statusOf(c) === status);
  });
  $('#evidence-count').textContent = `找到 ${found.length} / ${cases.length} 组实验`;
  $('#evidence-cases').innerHTML = found.map(c => {
    const name = experimentNames[c.suite] || (c.suite.startsWith('g4-') ? '进程与线程' : c.suite);
    const repeat = c.parameters?.repeat ? ` · 第 ${c.parameters.repeat} 次` : '';
    const vText = validationLabels[c.validation?.status] || c.validation?.status || '待核对';
    return `<article class="evidence-row">
      <div>
        <strong>${esc(c.id)}</strong>
        <small>${esc(name)}${esc(repeat)} · ${esc(labels[c.status] || c.status)} · ${esc(vText)}</small>
      </div>
      <div class="raw-links">${evidenceButtons(c)}</div>
      ${c.error ? `<details><summary>查看异常原因</summary><pre>${esc(JSON.stringify(c.error, null, 2))}</pre></details>` : ''}
    </article>`;
  }).join('') || '<p class="empty">没有匹配的实验记录，试试清空关键词或改选“全部”。</p>';
}

export function renderEvidence() {
  const r = state.report;
  const env = r.environment || {};
  $('#content').innerHTML = `
    <div class="lesson-heading">
      <small class="question-kicker">原始数据检索</small>
      <h2>原始记录与文件</h2>
      <p>这里保留了本轮每次实验采集到的底层原件（<code>strace</code> 系统调用、<code>smaps</code> 内存映射和采样事件）。输入编号如 <code>sequence-2</code> 就能直接找到对应实验的原文。</p>
    </div>
    <div class="evidence-filters">
      <label>搜索编号、实验名或参数<input id="evidence-search" type="search" placeholder="例如：sequence-2、16MiB、sparse"></label>
      <label>按状态筛选<select id="evidence-status">
        <option value="all">全部</option>
        <option value="passed">通过</option>
        <option value="attention">失败或偏差</option>
        <option value="unavailable">暂无完整结果</option>
      </select></label>
      <output id="evidence-count"></output>
    </div>
    <div id="evidence-cases"></div>
    <details class="secondary-fold">
      <summary>展开本次运行的系统与环境设置</summary>
      <dl class="info">
        <dt>数据来源</dt><dd>${r.data_origin === 'real_execution' ? '真实程序运行采集' : '合成测试数据'}</dd>
        <dt>完整性状态</dt><dd>${r.integrity.status === 'verified' ? '文件哈希核对通过' : r.integrity.status === 'legacy_partial' ? '早期格式（采样格式完整）' : '部分文件核对异常'}</dd>
        <dt>操作系统与内核</dt><dd>${esc(env.distribution?.PRETTY_NAME || env.os_release || '未知')} · ${esc(env.kernel || '未知')}</dd>
        <dt>系统全局透明大页（THP）策略</dt><dd>${esc(env.thp_enabled || '未记录')}</dd>
      </dl>
      <pre>${esc(JSON.stringify(env, null, 2))}</pre>
    </details>`;
  $('#evidence-search').addEventListener('input', showMatches);
  $('#evidence-status').addEventListener('change', showMatches);
  showMatches();
}
