import { $, state, phases, esc, kib, table, recheckTarget, diagnosisHTML, findingFor, evidenceButtons, stepNavigation, stepExplanation, stepActions } from './ui.js';

function policyHTML() {
  const cases = state.report.cases.filter(c => c.suite === 'thp' && ['allow', 'disable'].includes(c.parameters.process_thp));
  const findings = findingFor(cases.map(c => c.id), ['thp_process_disabled', 'thp_process_control', 'thp_not_observed', 'incomplete_evidence']);
  const paired = state.report.diagnosis.policy_comparisons || [];
  const canRecheck = state.report.integrity.status === 'verified' && state.report.cases.some(c => c.suite === 'thp') && !state.report.original_schema;
  return `<section class="course-intro">
    <small class="question-kicker">实验进阶 · 进程开关对照</small>
    <h2>为什么代码请求了大页，实际还是没分配？</h2>
    <p>做一个受控对比：两组代码都调用 <code>madvise</code> 请求大页，系统全局设置保持不变，只把其中一个进程的“允许大页”开关关掉，看看大页驻留（AnonHugePages）怎么变。</p>
    <div class="sequence-controls">
      <button id="run-policy">运行进程开关对照</button>
      ${canRecheck ? `<button id="policy-recheck">按当前记录条件再跑一次</button><span class="picker-hint">${recheckTarget()}</span>` : ''}
    </div>
    <p class="detail-copy">下表显示的是当前选中的历史数据；点上方按钮运行后会自动生成一份独立的新记录。</p>
    ${cases.length
      ? table(['写入方式 / 轮次', '进程开关', '内核 THP_enabled', '大页驻留', 'madvise 调用', '检查结果'],
          cases.map(c => {
            const d = c.data, ct = d?.condition;
            return [
              (c.parameters.pattern === 'sparse' ? '稀疏写' : '逐页写') + ' · 第 ' + c.parameters.repeat + ' 次',
              c.parameters.process_thp === 'allow' ? '允许大页' : '禁止大页',
              ct?.status_thp_enabled ?? '未采集',
              kib(d?.samples.at(-1)?.huge_kib),
              ct?.madvise_result == null ? '未采集' : ct.madvise_result === 0 ? '返回成功 (0)' : '未成功',
              c.validation?.status === 'passed' ? '通过' : (c.validation?.status || '未完成')
            ];
          }))
      : '<p class="empty-note">当前这份记录里还没有“进程开关对照”实验，可以点上方按钮跑一轮。</p>'}
    ${paired.map(c => `<div class="explanation-box"><span class="explain-tag">${c.pattern === 'sparse' ? '稀疏写' : '逐页写'} · 第 ${c.repeat} 次结论</span><p>${c.control_valid ? '条件一致：禁止组大页驻留为 0，允许组成功分到了大页，说明确实是进程级开关拦住了透明大页。' : '这两组还不足以归因为进程开关。对照上表的开关状态、大页驻留和检查结果。'}</p></div>`).join('')}
    <div class="raw-links">${cases.filter(c => c.artifacts).map(c => `<button data-raw="${esc(c.id)}" data-kind="smaps">${esc(c.id)} · 原始状态</button>`).join('')}</div>
    ${findings.length ? `<details class="secondary-fold"><summary>展开本组详细判断与依据</summary>${diagnosisHTML(findings)}</details>` : ''}
  </section>`;
}

function renderTHP() {
  const all = state.report.cases.filter(c => c.suite === 'thp');
  if (!all.length) {
    $('#content').innerHTML = '<p class="empty">这份记录里没有透明大页实验，可以切换记录或运行进程开关对照。</p>' + policyHTML();
    return;
  }
  const ordinary = all.filter(c => !['allow', 'disable'].includes(c.parameters.process_thp));
  const policy = !ordinary.length;
  const cases = policy ? all : ordinary;
  const groups = [...new Set(cases.map(c => `${c.parameters.pattern}:${c.parameters.repeat}`))];
  state.selected = Math.min(state.selected, groups.length - 1);
  const group = groups[state.selected];
  const pair = cases.filter(c => `${c.parameters.pattern}:${c.parameters.repeat}` === group);
  const sides = (policy ? ['disable', 'allow'] : ['off', 'on']).map(v =>
    pair.find(c => (policy ? c.parameters.process_thp : c.parameters.thp) === v));
  const labels = policy ? ['进程禁止', '进程允许'] : ['关闭大页', '请求大页'];
  const titles = ['设置对照', '写入前', '按步长写入', '读回核对'];
  state.phase = Math.min(Math.max(0, state.phase), titles.length - 1);
  const step = state.phase;
  const phase = step === 1 ? 'untouched' : 'after_write';
  const conditions = sides.map(c => c?.data?.condition);
  const samples = sides.map(c => c?.data?.samples.find(s => s.phase === phase));
  const values = sides.map(c => c?.data?.value_check);
  const describe = (records, f) => records.map((v, i) => labels[i] + (v ? f(v) : '：未采到')).join('；') + '。';
  const bytesLabel = n => n == null ? '—' : kib(n / 1024);
  const rows = labels.map((name, i) => {
    const ct = conditions[i], sample = samples[i], check = values[i];
    if (step === 0) return [name, ct ? bytesLabel(ct.region_bytes) : '—', ct ? bytesLabel(ct.stride_bytes) : '—', ct?.writes ?? '—'];
    if (step === 3) return [name, ct?.writes ?? '—', check?.sum ?? '—', check ? (check.ok ? '相符' : '有偏差') : '未采到'];
    return [name, kib(sample?.rss_kib), kib(sample?.huge_kib), step === 1 ? kib(sample?.size_kib) : sample?.action_minor ?? '—'];
  });
  let explanation, headers;
  if (step === 0) {
    explanation = stepExplanation(policy ? '两组都调用 madvise 请求大页，只改变进程是否允许使用大页。' : '两组各自建立匿名映射，一组调用 madvise 关闭大页，另一组请求大页。写入规则见下表。',
      'Linux 记下这段映射的大页策略。后面要看 smaps 的 AnonHugePages，才能知道实际有多少内存用上了透明大页。',
      describe(conditions, ct => policy ? `的进程禁止标志为 ${ct.process_thp_disabled ?? '未记录'}` : `的区域大小为 ${bytesLabel(ct.region_bytes)}，起点${ct.huge_aligned ? '已' : '未记录是否'}按大页对齐`));
    headers = ['组别', '区域大小', '写入步长', '计划写入次数'];
  } else if (step === 1) {
    explanation = stepExplanation('程序停在第一次写入之前，各读一次目标映射的 smaps。',
      'Size 是虚拟地址范围的大小；RSS 是其中已经驻留在物理内存里的部分。此时可以先比较两者。',
      describe(samples, s => `的 Size 为 ${kib(s.size_kib)}，RSS 为 ${kib(s.rss_kib)}`));
    headers = ['组别', '驻留 RSS', '其中匿名大页', '映射 Size'];
  } else if (step === 2) {
    explanation = stepExplanation('从区域起点开始，每走一个步长，就把那个位置的一个字节写成 1。写完马上采样。',
      '第一次写入需要可写的物理页。若内核为这次访问分配了透明大页，一个字节的写入也可能让整张大页驻留。',
      describe(samples, s => `驻留 ${kib(s.rss_kib)}，其中匿名大页 ${kib(s.huge_kib)}`) +
      (samples[0]?.rss_kib > 0 && samples[1]?.rss_kib > samples[0].rss_kib ? `${labels[1]}组的 RSS 是${labels[0]}组的 ${Number((samples[1].rss_kib / samples[0].rss_kib).toFixed(2))} 倍。` : ''));
    headers = ['组别', '驻留 RSS', '其中匿名大页', '写入时次缺页'];
  } else {
    explanation = stepExplanation('程序沿同样的步长读回刚才写过的字节，求和，再与写入次数核对。',
      '普通页和透明大页都通过进程的虚拟地址访问。翻回上一步看页的大小和驻留量，这一步看程序读到的值。',
      describe(values, v => `读回的总和是 ${v.sum}，与预期${v.ok ? '一致' : '有偏差'}`));
    headers = ['组别', '预期总和', '实测总和', '核对'];
  }
  const rules = policy ? ['thp_process_control', 'thp_process_disabled'] : ['thp_sparse_control', 'thp_full_control', 'observed_thp'];
  const findings = findingFor(pair.map(c => c.id), [...rules, 'thp_not_observed', 'incomplete_evidence', 'expectation_deviation']);
  const evidence = sides.map((c, i) => {
    if (!c?.artifacts) return '';
    const opts = step === 0 || step === 3 ? { recordKind: step === 0 ? 'condition' : 'values' } : {phase};
    return `<div class="raw-links"><strong>${labels[i]}</strong>${evidenceButtons(c, {...opts, stepLabel: titles[step]}, opts.recordKind ? ['jsonl'] : ['jsonl', 'smaps'])}</div>`;
  }).join('');
  $('#content').innerHTML = `<section class="seq-reading"><header class="focus-intro"><small class="question-kicker">拓展实验 · 透明大页</small>
    <h1>同样的写法，为什么用的物理内存会不同？</h1></header>
    ${stepNavigation(titles, step, 'data-course-step')}
    <section id="sequence-result" class="seq-panel"><h2>${titles[step]}</h2>${explanation}${table(headers, rows)}${evidence}<div class="seq-navigation">${stepActions(step, titles.length)}</div></section>
    <label class="selector"><span>换一组对照</span><select id="case-select">${groups.map((g, i) => `<option value="${i}" data-pattern="${esc(g.split(':')[0])}" ${i === state.selected ? 'selected' : ''}>${g.startsWith('sparse:') ? '稀疏写' : '逐基础页写'} · 第 ${esc(g.split(':')[1])} 次</option>`).join('')}</select></label>
    <details class="secondary-fold"><summary>查看本组诊断与复验</summary>${diagnosisHTML(findings, !policy)}</details>
    <details class="secondary-fold"><summary>进程开关对照与采集</summary>${policyHTML()}</details></section>`;
}

function cowControls() {
  const options = [['all', '五组全跑：0、1/8、1/4、1/2、全部改写'], ['0', '子进程不改写 (0)'], ['1/8', '改写 1/8'], ['1/4', '改写 1/4'], ['1/2', '改写 1/2'], ['1', '全部改写 (1)']];
  return `<div class="cow-controls">
    <label for="cow-fraction">重新采集设置：子进程改写比例</label>
    <select id="cow-fraction">${options.map(([v, t]) => `<option value="${v}" ${v === state.cowFraction ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button id="run-cow">运行 COW 对照</button>
    <p class="detail-copy">会依次测试 16 MiB 和 64 MiB 各 3 次；完成前下方继续显示当前历史记录。</p>
  </div>`;
}

function phaseLabel(sample, c) {
  if (sample.phase === 'child_write') return c.data.cow?.written_pages === 0 ? '子进程保持未改写' : `子进程改写 ${c.data.cow?.fraction ?? c.parameters.cow_fraction ?? '指定比例'}`;
  return phases[sample.phase] || sample.phase;
}

function cowStep(s, c) {
  const cow = c.data.cow;
  const child = s.role === 'child', who = child ? '子' : '父';
  const memory = `${who}进程目标映射的 RSS 是 ${kib(s.rss_kib)}，按共享比例分摊后的 PSS 是 ${kib(s.pss_kib)}。`;
  const faults = `本步记录到 ${s.action_minor} 次次缺页。`;
  switch (s.phase) {
    case 'untouched': return ['建立映射', '父进程用 mmap 建立一段私有匿名映射，先不访问实验区。', 'Linux 划出虚拟地址范围，物理页可以等到实际访问时再分配。', `映射大小为 ${kib(s.size_kib)}。` + memory];
    case 'read_all': return ['逐页读取', '父进程从每张基础页读一个字节并求和。', '匿名页第一次读取应得到 0。Linux 可以把只读访问指向共享零页，发生缺页时也可能看不到 RSS 增长。', faults + memory];
    case 'write_quarter': return ['间隔写入', '父进程每隔四页，把页首字节写成 1。', '首次写入的页需要可写的物理内存，这时再看 RSS，就能和逐页只读的结果做对照。', faults + memory];
    case 'write_all': return ['写遍各页', '父进程把每一页的第一个字节都写成 1。', '已经写过的页可以继续用，其余页首次写入时需要分配可写页。', faults + memory];
    case 'fork_shared': return ['刚 fork · ' + who, child ? '子进程已经启动，通过管道等待改写指令。现在取子进程的快照。' : '父进程调用 fork，等子进程就绪，先取父进程的快照。',
      '两个进程各有自己的页表，此时可以共享同一批物理页。RSS 在两边都记入整页，PSS 按共享比例分摊。', memory];
    case 'child_write_quarter':
    case 'child_write': {
      const zero = cow?.written_pages === 0;
      const check = c.data.value_check;
      const peer = c.data.samples.find(other => other.phase === s.phase && other.role !== s.role);
      const total = peer && child ? `两边 PSS 合计 ${kib(peer.pss_kib + s.pss_kib)}。` : '';
      const result = child && check ? `读回页首字节求和，父进程为 ${check.parent_sum}，子进程为 ${check.child_sum}，隔离校验${check.ok ? '通过' : '有偏差'}。` : '';
      return [(zero ? '保持共享 · ' : '改写后 · ') + who,
        (zero ? '这组让子进程跳过改写。' : `子进程按设定比例把选中页的首字节改成 2。`) + (child ? '现在看子进程的记录。' : '父进程一直保留原值，现在看父进程的记录。'),
        zero ? '两边都没有向共享页写入，可以继续共享原来的物理页。' : '子进程写共享页时触发写时复制，得到自己的可写页。父进程仍然看到原值，其余页可以继续共享。',
        memory + total + (child ? faults : '') + result];
    }
    default: return [s.phase, '程序在这个阶段记录目标映射。', '根据 smaps 对照驻留量与共享份额。', memory];
  }
}

function renderBaseline() {
  const cases = state.report.cases.filter(c => c.suite === 'baseline');
  if (!cases.length) {
    $('#content').innerHTML = cowControls() + '<p class="empty">当前记录里没有写时复制（COW）实验，请点顶部“切换记录”选一条“写时复制”记录或点上方运行。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], samples = c.data?.samples || [];
  state.phase = Math.min(Math.max(0, state.phase), Math.max(0, samples.length - 1));
  const sample = samples[state.phase];
  const findings = findingFor([c.id], ['anonymous_zero_page', 'cow_accounting', 'incomplete_evidence', 'expectation_deviation']);
  const comparisons = (state.report.diagnosis.cow_observations || []).filter(x => x.mib === c.parameters.mib && x.repeat === c.parameters.repeat);
  const summary = comparisons.length
    ? `<details class="secondary-fold"><summary>对比五种改写比例的父子 PSS 合计（同轮 ${c.parameters.mib} MiB · 第 ${c.parameters.repeat} 次）</summary><p class="detail-copy">理论预期按“共享页只算一份，被改写的页各自独享一份”计算：</p>${table(['改写比例', '改写页数', '理论 PSS 合计', '实测 PSS 合计', '核对'], comparisons.map(x => [x.fraction, `${x.written_pages} / ${x.total_pages}`, kib(x.expected_pss_kib), kib(x.observed_pss_kib), x.confirmed ? '与预期一致' : '存在偏差']))}</details>`
    : '';

  const steps = samples.map(s => cowStep(s, c));
  const selected = steps[state.phase];
  $('#content').innerHTML = `<section class="seq-reading"><header class="focus-intro"><small class="question-kicker">拓展实验 · 写时复制</small>
    <h1>fork 之后，父子进程什么时候才会各有一份物理页？</h1></header>
    ${sample ? `${stepNavigation(steps.map(st => st[0]), state.phase, 'data-course-step')}
      <section id="sequence-result" class="seq-panel"><h2>${esc(selected[0])}</h2>
      ${stepExplanation(...selected.slice(1))}
      <div class="seq-navigation"><div class="raw-links">${evidenceButtons(c, {phase: sample.phase, role: sample.role, stepLabel: selected[0]})}</div>
      <button id="play">${state.timer ? '暂停' : '自动播放'}</button>${stepActions(state.phase, samples.length)}</div></section>`
      : `<p class="empty">本次采集不完整。</p><div class="raw-links">${evidenceButtons(c)}</div>`}
    <label class="selector"><span>换一组实验</span><select id="case-select">${cases.map((item, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${item.parameters.mib} MiB · 改写 ${esc(item.data?.cow?.fraction ?? item.parameters.cow_fraction ?? '1/4')} · 第 ${item.parameters.repeat} 次</option>`).join('')}</select></label>
    <details class="secondary-fold"><summary>对照各步与父子进程的数据</summary>${table(['阶段', '进程', 'RSS', 'PSS'], samples.map(s => [phaseLabel(s,c), s.role === 'parent' ? '父进程' : '子进程', kib(s.rss_kib), kib(s.pss_kib)]), state.phase)}</details>
    ${summary}
    <details class="secondary-fold"><summary>查看本组诊断与复验</summary>${diagnosisHTML(findings)}${cowControls()}</details></section>`;

}

export { renderTHP, renderBaseline };
