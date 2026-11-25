import { $, api, download, table, url } from './ui.js';
import { parsePracticeAttempt, practiceAttemptKey, reviewPracticeAttempt, summarizePracticeReviews } from './practice-data.js';

const input = $('#practice-files');
const status = $('#practice-review-status');
const results = $('#practice-review-results');
const exportButton = $('#practice-review-export');
const labels = {verified: '通过', score_mismatch: '分数不一致', duplicate: '重复', invalid: '格式无效', unverified: '未核对'};
const processNames = {allow: '解除进程禁用', disable: '进程级禁用'};
const phaseNames = {allocated: '申请内存', write_quarter: '写到四分之一', write_half: '写到一半', write_all: '全部写完'};
let revision = 0;
let summary = null;

async function findReport(evidence, runs) {
  const candidates = runs.filter(run => run.run_id === evidence.run_id);
  if (!candidates.length) return {message: '本地回放目录中缺少这份运行记录'};
  let readable = false;
  let unverified = null;
  for (const candidate of candidates) {
    try {
      const report = await api(url('/api/report', {id: candidate.id}));
      readable = true;
      if (report.original_report_sha256 === evidence.report_sha256) {
        if (report.integrity?.status === 'verified') return {report};
        unverified = report;
      }
    } catch {
      // Other copies of the same run may still match the submitted report.
    }
  }
  if (unverified) return {report: unverified};
  return {message: readable ? '本地记录与首答的报告哈希不一致' : '本地服务无法读取对应运行记录'};
}

async function reviewFile(file, find, seen) {
  let attempt;
  try {
    if (file.size > 1024 * 1024) return {status: 'invalid', message: '文件超过 1 MiB'};
    attempt = parsePracticeAttempt(JSON.parse(await file.text()));
  } catch (error) {
    return {status: 'invalid', message: error instanceof SyntaxError ? '文件内容无法解析为 JSON' : error.message};
  }
  const key = practiceAttemptKey(attempt);
  if (seen.has(key)) return {attempt, status: 'duplicate', message: '重复的首答文件，本批只核对一次'};
  seen.add(key);
  const {report, message} = await find(attempt.evidence);
  return report ? {attempt, ...reviewPracticeAttempt(attempt, report)} : {attempt, status: 'unverified', message};
}

function render(rows) {
  const totals = summarizePracticeReviews(rows);
  const {counts} = totals;
  $('#practice-review-counts').innerHTML = [
    ['已通过', counts.verified], ['需核对', counts.needs_review], ['重复', counts.duplicate]
  ].map(([label, count]) => `<div><dt>${label}</dt><dd>${count}</dd></div>`).join('');
  $('#practice-review-questions').innerHTML = counts.verified ? `<h3>按阶段查看逐题结果</h3>`
    + table(['阶段', '进程条件', '通过文件数', 'RSS 答对', '大页驻留答对', '次缺页范围答对'], totals.by_stage.map(row =>
      [phaseNames[row.phase] || row.phase, processNames[row.process_thp] || '原有进程设置',
        row.checked, row.correct.rss, row.correct.huge, row.correct.scope])) : '';
  $('#practice-review-table').innerHTML = `<h3>文件明细</h3>` + table(
    ['文件', '运行编号', '阶段', '文件内得分', '复算得分', '自报经过时间', '核对结果'],
    rows.map(({file, attempt, recalculated, status: outcome, message}) => {
      const evidence = attempt?.evidence;
      const elapsed = attempt?.elapsed_ms_since_evidence_opened;
      return [file, evidence?.run_id,
        evidence ? `第 ${evidence.repeat} 轮 · ${phaseNames[evidence.phase] || evidence.phase}` : null,
        attempt ? `${attempt.score} / ${attempt.total}` : null,
        recalculated ? `${recalculated.score} / ${recalculated.total}` : null,
        elapsed == null ? null : `${(elapsed / 1000).toFixed(1)} 秒`,
        `${labels[outcome]} · ${message}`];
    }));
  summary = {
    schema_version: 'vmobserve.practice-review/v1',
    reviewed_at: new Date().toISOString(),
    ...totals,
    results: rows.map(({attempt, recalculated, status: outcome, message}, index) => ({
      index: index + 1, status: outcome, message,
      evidence: attempt?.evidence ?? null, recorded_score: attempt?.score ?? null,
      submitted_at: attempt?.submitted_at ?? null,
      elapsed_ms_since_evidence_opened: attempt?.elapsed_ms_since_evidence_opened ?? null,
      recalculated: recalculated ?? null
    }))
  };
  results.hidden = false;
}

input.addEventListener('change', async () => {
  const files = Array.from(input.files || []);
  input.value = '';
  const token = ++revision;
  summary = null;
  results.hidden = true;
  if (!files.length) {
    status.textContent = '';
    return;
  }
  status.textContent = '正在读取本地回放目录…';
  let runs = [];
  let catalogAvailable = true;
  try {
    runs = await api('/api/runs');
  } catch {
    catalogAvailable = false;
  }
  if (token !== revision) return;
  const cache = new Map();
  const find = evidence => {
    if (!catalogAvailable) return {message: '本地回放目录无法读取'};
    const key = JSON.stringify([evidence.run_id, evidence.report_sha256]);
    if (!cache.has(key)) cache.set(key, findReport(evidence, runs));
    return cache.get(key);
  };
  const seen = new Set(), rows = [];
  for (const file of files) {
    const verdict = await reviewFile(file, find, seen);
    if (token !== revision) return;
    rows.push({file: file.name, ...verdict});
    status.textContent = `已读取 ${rows.length} / ${files.length} 个文件`;
  }
  render(rows);
});

exportButton.addEventListener('click', () => {
  if (summary) download(summary, 'vmobserve-practice-review.json');
});
