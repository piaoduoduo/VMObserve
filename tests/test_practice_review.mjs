import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canCollect} from '../work/vmobserve/web/ui.js';
import {gradeDemandExercise} from '../work/vmobserve/web/comparison-data.js';
import {
  demandPracticeEvidence, parsePracticeAttempt, practiceAttemptKey, practiceAttemptSchema, reviewPracticeAttempt, summarizePracticeReviews
} from '../work/vmobserve/web/practice-data.js';

const makeReport = () => {
  const report = {
    run_id: 'test-only', original_report_sha256: 'a'.repeat(64), data_origin: 'real_execution',
    view_mode: 'historical_replay', integrity: {status: 'verified'}, artifacts: {}, cases: []
  };
  for (const advice of ['off', 'on']) {
    const id = 'demand-' + advice;
    const artifacts = {jsonl: id + '/stdout.jsonl', smaps: id + '/smaps.txt'};
    report.artifacts[artifacts.jsonl] = 'b'.repeat(64);
    report.artifacts[artifacts.smaps] = 'c'.repeat(64);
    report.cases.push({
      suite: 'demand512', id, status: 'completed', validation: {status: 'passed'},
      parameters: {repeat: 1, thp_advice: advice}, artifacts,
      data: {samples: [{phase: 'write_quarter', count: 32768, mapping_present: true,
        rss_kib: 131072, huge_kib: advice === 'on' ? 131072 : 0, action_minor: advice === 'on' ? 64 : 32768}]}
    });
  }
  return report;
};

const makeAttempt = report => ({
  schema_version: practiceAttemptSchema, kind: 'learner_self_check',
  submitted_at: '2026-11-25T12:00:00.000Z', elapsed_ms_since_evidence_opened: 13000,
  evidence: demandPracticeEvidence(report, report.cases, 1, 'write_quarter'),
  ...gradeDemandExercise({rss: 0, huge: 'present'}, {rss: '0', huge: 'zero', scope: 'process'})
});

test('only Linux or a configured VM expose collection actions', () => {
  assert.equal(canCollect({executor: 'local', host_system: 'Windows'}), false);
  assert.equal(canCollect({executor: 'local', host_system: 'Linux'}), true);
  assert.equal(canCollect({executor: 'openeuler-vm', host_system: 'Windows'}), true);
  assert.equal(canCollect(null), false);
});

test('review recomputes the score from the paired evidence and picks up modified feedback', () => {
  const report = makeReport();
  const raw = makeAttempt(report);
  const parsed = parsePracticeAttempt(raw);
  assert.deepEqual([parsed.score, parsed.total], [2, 3]);
  const graded = reviewPracticeAttempt(parsed, report);
  assert.equal(graded.status, 'verified');
  assert.equal(graded.recalculated.score, 2);
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt({...raw, score: 3}), report).status, 'score_mismatch');
  raw.responses[1].expected = 'zero';
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt(raw), report).status, 'score_mismatch');
});

test('original report and artifact hashes gate classroom verification', () => {
  const report = makeReport();
  const raw = makeAttempt(report);
  const reportChanged = {...report, original_report_sha256: 'd'.repeat(64)};
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt(raw), reportChanged).status, 'unverified');
  const previewOnly = {...report, integrity: {status: 'failed'}};
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt(raw), previewOnly).status, 'unverified');
  const altered = structuredClone(raw);
  altered.evidence.cases[0].artifacts.smaps.sha256 = 'e'.repeat(64);
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt(altered), report).status, 'unverified');
  assert.notEqual(practiceAttemptKey(parsePracticeAttempt(altered)), practiceAttemptKey(parsePracticeAttempt(raw)));
});

test('duplicate keys are stable across harmless answer order and omit undeclared fields', () => {
  const raw = makeAttempt(makeReport());
  const original = parsePracticeAttempt(raw);
  raw.responses.reverse();
  raw.evidence.unrelated = 'must not appear in summary';
  raw.evidence.cases[0].artifacts.jsonl.unrelated = 'also omitted';
  const reordered = parsePracticeAttempt(raw);
  assert.equal(practiceAttemptKey(original), practiceAttemptKey(reordered));
  assert.equal(reordered.evidence.unrelated, undefined);
  assert.equal(reordered.evidence.cases[0].artifacts.jsonl.unrelated, undefined);
});

test('rejects malformed answers and reports a phase without measured evidence', () => {
  const report = makeReport();
  const raw = makeAttempt(report);
  assert.throws(() => parsePracticeAttempt({...raw, elapsed_ms_since_evidence_opened: -1}));
  assert.throws(() => parsePracticeAttempt({...raw, responses: [raw.responses[0], ...raw.responses.slice(0, 2)]}));
  const released = structuredClone(raw);
  released.evidence.phase = 'freed';
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt(released), report).status, 'unverified');
  raw.responses[0].answer = 'unsupported';
  assert.equal(reviewPracticeAttempt(parsePracticeAttempt(raw), report).status, 'invalid');
});

test('summary counts only verified files and keeps phase and process groups separate', () => {
  const report = makeReport();
  const attempt = parsePracticeAttempt(makeAttempt(report));
  const verdict = reviewPracticeAttempt(attempt, report);
  const allowed = structuredClone(attempt);
  allowed.evidence.cases.forEach(row => { row.process_thp = 'allow'; });
  const allocated = structuredClone(attempt);
  allocated.evidence.phase = 'allocated';
  const rows = [
    {attempt, ...verdict}, {attempt: allowed, ...verdict}, {attempt: allocated, ...verdict},
    {attempt, status: 'duplicate'}, {attempt, status: 'score_mismatch'}, {status: 'invalid'}
  ];
  const summary = summarizePracticeReviews(rows);
  assert.deepEqual(summary.counts, {processed: 6, verified: 3, needs_review: 2, duplicate: 1});
  assert.deepEqual(summary.by_stage.map(row => [row.phase, row.process_thp, row.checked, row.correct]),
    [['write_quarter', null, 1, {rss: 1, huge: 0, scope: 1}],
     ['write_quarter', 'allow', 1, {rss: 1, huge: 0, scope: 1}],
     ['allocated', null, 1, {rss: 1, huge: 0, scope: 1}]]);
});
