import { $, state, phases, esc, kib, table, recheckTarget, diagnosisHTML, chart, findingFor, evidenceButtons } from './ui.js';

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
              ct?.madvise_result === 0 ? '返回成功 (0)' : '未成功',
              c.validation?.status === 'passed' ? '通过' : (c.validation?.status || '未完成')
            ];
          }))
      : '<p class="empty-note">当前这份记录里还没有“进程开关对照”实验，可以点上方按钮跑一轮。</p>'}
    ${paired.map(c => `<div class="explanation-box"><span class="explain-tag">${c.pattern === 'sparse' ? '稀疏写' : '逐页写'} · 第 ${c.repeat} 次结论</span><p>${c.control_valid ? '条件一致：禁止组大页驻留为 0，允许组成功分到了大页，说明确实是进程级开关拦住了透明大页。' : '证据不足：这组里即使允许使用大页，AnonHugePages 依然为 0，缺少大页分配成功的正例作对比。'}</p></div>`).join('')}
    <div class="raw-links">${cases.filter(c => c.artifacts).map(c => `<button data-raw="${esc(c.id)}" data-kind="smaps">${esc(c.id)} · 原始状态</button>`).join('')}</div>
    ${findings.length ? `<details class="secondary-fold"><summary>展开本组详细判断与依据</summary>${diagnosisHTML(findings)}</details>` : ''}
  </section>`;
}

function renderTHP() {
  const cases = state.report.cases.filter(c => c.suite === 'thp' && !['allow', 'disable'].includes(c.parameters.process_thp));
  if (!cases.length) {
    $('#content').innerHTML = policyHTML() + '<p class="empty">当前记录里没有透明大页开/关对比实验，请点顶部“切换记录”选一条“透明大页”记录。</p>';
    return;
  }
  const groups = [...new Set(cases.map(c => `${c.parameters.pattern}:${c.parameters.repeat}`))];
  state.selected = Math.min(state.selected, groups.length - 1);
  const [pattern, repeat] = groups[state.selected].split(':');
  const pair = cases.filter(c => c.parameters.pattern === pattern && c.parameters.repeat === Number(repeat));
  const off = pair.find(c => c.parameters.thp === 'off'), on = pair.find(c => c.parameters.thp === 'on');
  const a = off?.data?.samples.at(-1), b = on?.data?.samples.at(-1);
  const condition = off?.data?.condition || on?.data?.condition;
  const valid = state.report.diagnosis.comparisons.find(c => c.off === off?.id && c.on === on?.id && c.control_valid);
  const findings = findingFor(pair.map(c => c.id), valid ? [`thp_${pattern}_control`] : ['thp_not_observed', 'observed_thp', 'incomplete_evidence', 'expectation_deviation']);
  const title = valid && pattern === 'sparse' && b.rss_kib > a.rss_kib
    ? `同样写了 ${condition.writes} 次，为什么开启大页后驻留内存变大了？`
    : '透明大页：请求了大页，物理内存会多占吗？';

  $('#content').innerHTML = `<div class="experiment"><div class="observation">
    <small class="question-kicker">核心对照 · 关闭 vs 请求透明大页</small>
    <h2>${esc(title)}</h2>
    <label class="selector"><span>换一组实验：</span><select id="case-select">${groups.map((g, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${g.split(':')[0] === 'sparse' ? '稀疏写（间隔大）' : '逐基础页写'} · 第 ${g.split(':')[1]} 次</option>`).join('')}</select></label>
    ${a || b ? `<div class="thp-visual-grid">
      <div class="thp-box"><span>关闭透明大页</span><strong>${kib(a?.rss_kib)}</strong><small>每次写入分配 4 KiB 基础页</small></div>
      <div class="thp-box thp-on"><span>请求透明大页</span><strong>${kib(b?.rss_kib)}</strong><small>其中大页 ${kib(b?.huge_kib)}（2 MiB 整页分配）</small></div>
    </div>${chart([['关闭透明大页', a?.rss_kib, 'off'], ['请求透明大页', b?.rss_kib, 'on']])}` : '<p class="empty">数据不完整，点开原始文件查看运行错误。</p>'}
    ${table(['配置', '物理驻留 RSS', '其中大页 (AnonHugePages)', '次缺页次数'], [['关闭大页', kib(a?.rss_kib), kib(a?.huge_kib), a?.action_minor ?? '—'], ['请求大页', kib(b?.rss_kib), kib(b?.huge_kib), b?.action_minor ?? '—']])}
    <p class="detail-copy">${condition ? `实验写法：在 ${kib(condition.region_bytes / 1024)} 的区域里，每隔 ${kib(condition.stride_bytes / 1024)} 写入 1 个字节。` : '本轮采样条件不完整。'}</p>
    ${valid && pattern === 'sparse' && b.rss_kib > a.rss_kib ? `<div class="explanation-box"><span class="explain-tag">为什么涨了 ${valid.rss_ratio} 倍？</span><p>关闭大页时，写 1 字节只分配 1 个 4 KiB 基础页；开启透明大页后，只要写 1 字节就会整块分配 2 MiB 大页。所以总驻留变成 ${valid.rss_ratio} 倍，这里看到的是“空间放大代价”，和运行速度提升无关。</p></div>` : ''}
    <button id="view-raw">查看这组对比的原始文件</button>
    <div id="raw-links" class="raw-links" hidden>${pair.filter(c => c.artifacts).map(c => `<button data-raw="${esc(c.id)}" data-kind="smaps">${c.parameters.thp === 'off' ? '关闭组' : '请求组'} · smaps</button><button data-raw="${esc(c.id)}" data-kind="jsonl">${c.parameters.thp === 'off' ? '关闭组' : '请求组'} · 采样记录</button>`).join('')}</div>
  </div>${diagnosisHTML(findings, true)}</div>` + policyHTML();
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
  if (sample.phase === 'child_write') return c.data.cow.written_pages === 0 ? '子进程保持未改写' : `子进程改写 ${c.data.cow.fraction}（${c.data.cow.written_pages} 页）`;
  return phases[sample.phase] || sample.phase;
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

  const cowDiagram = sample ? `<div class="cow-diagram">
    <div class="cow-node"><span>当前视角</span><strong>${sample.role === 'parent' ? '父进程' : '子进程'}</strong></div>
    <div class="cow-arrow">⇄</div>
    <div class="cow-node"><span>RSS（记账含共享）</span><strong>${kib(sample.rss_kib)}</strong></div>
    <div class="cow-arrow">→</div>
    <div class="cow-node highlight"><span>PSS（按共享平摊）</span><strong>${kib(sample.pss_kib)}</strong></div>
  </div>` : '';

  $('#content').innerHTML = `<div class="experiment"><div class="observation">
    <small class="question-kicker">核心实验 · 写时复制（Copy-on-Write）</small>
    <h2>fork 之后，父子进程什么时候才真正复制物理页？</h2>
    <label class="selector"><span>换一组实验：</span><select id="case-select">${cases.map((item, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${item.parameters.mib} MiB · 改写 ${esc(item.data?.cow?.fraction || item.parameters.cow_fraction || '1/4')} · 第 ${item.parameters.repeat} 次</option>`).join('')}</select></label>
    ${sample ? `
      <div class="playback">
        <button data-course-step="${state.phase - 1}" ${state.phase === 0 ? 'disabled' : ''}>← 上一步</button>
        <button id="play">${state.timer ? '暂停' : '自动播放'}</button>
        <input id="phase" aria-label="切换实验步骤" type="range" min="0" max="${samples.length - 1}" value="${state.phase}">
        <button class="primary" data-course-step="${state.phase + 1}" ${state.phase === samples.length - 1 ? 'disabled' : ''}>下一步 →</button>
      </div>
      <p><strong>第 ${state.phase + 1} / ${samples.length} 步 · ${esc(phaseLabel(sample, c))} · ${sample.role === 'parent' ? '父进程视角' : '子进程视角'}</strong></p>
      ${cowDiagram}
      ${chart([['RSS（含共享页）', sample.rss_kib, 'off'], ['PSS（按比例分摊）', sample.pss_kib, 'on']])}
      ${table(['阶段', '进程', 'RSS', 'PSS', '本步次缺页'], samples.map(s => [phaseLabel(s, c), s.role === 'parent' ? '父进程' : '子进程', kib(s.rss_kib), kib(s.pss_kib), s.action_minor]), state.phase)}
      <div class="explanation-box"><span class="explain-tag">为什么看 PSS 而不只看 RSS？</span><p>共享同一份物理页时，父进程和子进程的 RSS 都会把这份内存算一遍（看起来翻倍了）；而 PSS 会把共享页平摊到两个进程头上，所以比较“一共占了多少物理内存条空间”，看 PSS 最准。</p></div>`
      : '<p class="empty">本次采集不完整，点下方按钮可查看原始日志。</p>'}
    ${summary}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c, { phase: sample?.phase, stepLabel: sample ? phaseLabel(sample, c) : '' })}</div>` : ''}
  </div>${diagnosisHTML(findings)}</div>` + cowControls();
}

export { renderTHP, renderBaseline };
