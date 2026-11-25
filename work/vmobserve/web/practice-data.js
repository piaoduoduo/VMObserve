import { demandExerciseReadings, demandRepeatReadings, gradeDemandExercise } from './comparison-data.js';
import { demandPair } from './ui.js';

export const practiceAttemptSchema = 'vmobserve.demand-practice-attempt/v1';
const questionIds = ['rss', 'huge', 'scope'];
const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function demandPracticeEvidence(report, pair, repeat, phase) {
  const cases = pair.map(item => ({
    case_id: item.id, thp_advice: item.parameters.thp_advice, process_thp: item.parameters.process_thp ?? null,
    artifacts: Object.fromEntries(['jsonl', 'smaps'].map(kind => {
      const path = item.artifacts?.[kind] ?? null;
      return [kind, {path, sha256: path ? report.artifacts?.[path] ?? null : null}];
    }))
  }));
  return {
    run_id: report.run_id, report_sha256: report.original_report_sha256,
    data_origin: report.data_origin, view_mode: report.view_mode, repeat, phase, cases
  };
}

export function parsePracticeAttempt(value) {
  if (value?.schema_version !== practiceAttemptSchema || value.kind !== 'learner_self_check') {
    throw new Error('此文件不是受支持的 3.3 首答记录');
  }
  const {evidence, responses, score, total, submitted_at, elapsed_ms_since_evidence_opened: elapsed} = value;
  if (!evidence || typeof evidence.run_id !== 'string' || !evidence.run_id.trim() ||
      !isHash(evidence.report_sha256) || !Number.isSafeInteger(evidence.repeat) || evidence.repeat < 1 ||
      typeof evidence.phase !== 'string' || !evidence.phase ||
      !Array.isArray(evidence.cases) || evidence.cases.length !== 2) {
    throw new Error('首答的运行编号、阶段或案例证据字段不完整');
  }
  if (typeof submitted_at !== 'string' || !Number.isFinite(Date.parse(submitted_at)) ||
      new Date(submitted_at).toISOString() !== submitted_at ||
      (elapsed !== null && (!Number.isSafeInteger(elapsed) || elapsed < 0)) ||
      total !== questionIds.length || !Number.isInteger(score) || score < 0 || score > total) {
    throw new Error('首答时间、用时或分数格式无效');
  }
  if (!Array.isArray(responses) || responses.length !== questionIds.length) {
    throw new Error('首答必须包含三项判断');
  }
  const ordered = questionIds.map(question => responses.filter(row => row?.question === question));
  if (ordered.some(matches => matches.length !== 1 || typeof matches[0].answer !== 'string' ||
      typeof matches[0].expected !== 'string' || typeof matches[0].correct !== 'boolean')) {
    throw new Error('三项判断存在缺失、重复或无效答案');
  }
  const stringOrNull = input => typeof input === 'string' ? input : null;
  const cases = evidence.cases.map(item => ({
    case_id: stringOrNull(item?.case_id), thp_advice: stringOrNull(item?.thp_advice),
    process_thp: stringOrNull(item?.process_thp),
    artifacts: Object.fromEntries(['jsonl', 'smaps'].map(kind => [kind, {
      path: stringOrNull(item?.artifacts?.[kind]?.path), sha256: stringOrNull(item?.artifacts?.[kind]?.sha256)
    }]))
  }));
  return {
    submitted_at, elapsed_ms_since_evidence_opened: elapsed, score,
    evidence: {run_id: evidence.run_id, report_sha256: evidence.report_sha256,
      phase: evidence.phase, repeat: evidence.repeat, data_origin: stringOrNull(evidence.data_origin),
      view_mode: stringOrNull(evidence.view_mode), cases},
    responses: ordered.map(([{question, answer, expected, correct}]) => ({question, answer, expected, correct}))
  };
}

export function practiceAttemptKey(attempt) {
  const {evidence, responses} = attempt;
  return JSON.stringify([evidence, attempt.submitted_at, attempt.elapsed_ms_since_evidence_opened, responses, attempt.score]);
}

function samePracticeCase(saved, current) {
  if (!saved || saved.case_id !== current.case_id || saved.thp_advice !== current.thp_advice ||
      saved.process_thp !== current.process_thp) return false;
  return ['jsonl', 'smaps'].every(kind => {
    const recorded = saved.artifacts?.[kind];
    const original = current.artifacts[kind];
    return isHash(original.sha256) && recorded?.path === original.path && recorded.sha256 === original.sha256;
  });
}

export function reviewPracticeAttempt(attempt, report) {
  const {evidence} = attempt;
  if (report.data_origin !== 'real_execution' || report.integrity?.status !== 'verified' ||
      report.run_id !== evidence.run_id || report.original_report_sha256 !== evidence.report_sha256) {
    return {status: 'unverified', message: '原报告哈希、数据来源或完整性无法核对'};
  }
  const {repeat, phase} = evidence;
  const row = demandRepeatReadings(report, phase).find(reading => reading.repeat === repeat);
  const practice = demandExerciseReadings(row);
  if (!practice) return {status: 'unverified', message: '该轮和阶段没有通过校验的答题读数'};

  const enabled = report.cases.find(item => item.suite === 'demand512' &&
    item.parameters.repeat === repeat && item.parameters.thp_advice === 'on');
  const pair = demandPair(report.cases, enabled);
  const current = demandPracticeEvidence(report, pair, repeat, phase);
  if (current.data_origin !== evidence.data_origin || current.view_mode !== evidence.view_mode ||
      current.cases.length !== 2 || !current.cases.every((item, i) => samePracticeCase(evidence.cases[i], item))) {
    return {status: 'unverified', message: '首答绑定的案例、来源或原文哈希与回放不符'};
  }

  const answers = Object.fromEntries(attempt.responses.map(row => [row.question, row.answer]));
  const recalculated = gradeDemandExercise(practice, answers);
  if (!recalculated) return {status: 'invalid', message: '首答包含无效选项'};
  const consistent = attempt.score === recalculated.score && recalculated.responses.every((row, i) =>
    row.expected === attempt.responses[i].expected && row.correct === attempt.responses[i].correct);
  return {
    status: consistent ? 'verified' : 'score_mismatch',
    message: consistent ? '答案、得分和原文证据一致' : '文件中的分数或逐题反馈与复算不一致',
    recalculated
  };
}

export function summarizePracticeReviews(rows) {
  const counts = {processed: rows.length, verified: 0, needs_review: 0, duplicate: 0};
  const groups = new Map();
  for (const row of rows) {
    if (row.status === 'duplicate') {
      counts.duplicate++;
      continue;
    }
    if (row.status !== 'verified') {
      counts.needs_review++;
      continue;
    }
    counts.verified++;
    const {phase, cases} = row.attempt.evidence;
    const process = cases[0].process_thp;
    const key = JSON.stringify([phase, process]);
    if (!groups.has(key)) {
      groups.set(key, {phase, process_thp: process, checked: 0,
        correct: Object.fromEntries(questionIds.map(question => [question, 0]))});
    }
    const group = groups.get(key);
    group.checked++;
    for (const response of row.recalculated.responses) {
      if (response.correct) group.correct[response.question]++;
    }
  }
  return {counts, by_stage: [...groups.values()]};
}
