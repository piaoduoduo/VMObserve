import { $, state, esc, labels, evidenceButtons, diagnosisHTML, thpPairs } from './ui.js';
import { viewCases } from './curriculum.js';

const experimentNames = {
  sync: '线程同步', io: '文件与设备',
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
  const pairs = thpPairs(cases);
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
    const topic = ['stack','demand512'].includes(c.suite) ? 'group3' : c.suite;
    let replay = '';
    if (topic === 'course') {
      const href = '/lesson?' + new URLSearchParams({run:state.id, case:c.id});
      replay = `<a class="nav-link" href="${esc(href)}">用这份实测写小结 →</a>`;
    } else if (['sequence','group3','baseline','thp'].includes(topic)) {
      const index = topic === 'thp' ? pairs.findIndex(pair => pair.cases.includes(c)) : viewCases(cases, topic, x => x.suite).indexOf(c);
      const href = '/#' + new URLSearchParams({run:state.id, topic, case:index, step:topic === 'sequence' ? 3 : 0});
      replay = `<a class="nav-link" href="${esc(href)}">${topic === 'sequence' ? '在第④步查看这次实测' : '按步骤查看这份记录'} →</a>`;
    }
    return `<article class="evidence-row">
      <div>
        <strong>${esc(c.id)}</strong>
        <small>${esc(name)}${esc(repeat)} · ${esc(labels[c.status] || c.status)} · ${esc(vText)}</small>
      </div>
      <div class="raw-links">${replay}${evidenceButtons(c)}</div>
      ${c.error ? `<details><summary>查看异常原因</summary><pre>${esc(JSON.stringify(c.error, null, 2))}</pre></details>` : ''}
    </article>`;
  }).join('') || '<p class="empty">没有匹配的实验记录，试试清空关键词或改选“全部”。</p>';
}

export function renderEvidence() {
  const r = state.report;
  const env = r.environment || {};
  const example = r.cases[0]?.id;
  $('#content').innerHTML = `
    <div class="course-intro">
      <small class="question-kicker">原始数据检索</small>
      <h1>原始证据</h1>
      <p>这里收齐了这一轮所有实验的系统原始记录（<code>strace</code> 系统调用日志、<code>/proc/self/smaps</code> 内存快照和分段采样数据）。${example ? `在下面输入本轮编号（比如 <code>${esc(example)}</code>）就能直接找到对应原文。` : '本轮暂无记录可供检索。'}</p>
    </div>
    <div class="evidence-filters">
      <div class="filter-field">
        <label for="evidence-search">搜索编号、实验名或参数</label>
        <input id="evidence-search" type="search" placeholder="${example ? esc(example) : '搜索本轮实验'}">
      </div>
      <div class="filter-field filter-field-sm">
        <label for="evidence-status">按状态筛选</label>
        <select id="evidence-status">
          <option value="all">全部</option>
          <option value="passed">通过</option>
          <option value="attention">失败或偏差</option>
          <option value="unavailable">暂无完整结果</option>
        </select>
      </div>
      <output id="evidence-count"></output>
    </div>
    <div id="evidence-cases"></div>
    ${r.diagnosis?.findings?.length ? `<details class="secondary-fold"><summary>查看本轮诊断与依据</summary>${diagnosisHTML(r.diagnosis.findings)}</details>` : ''}
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
