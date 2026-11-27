import { $, state, esc, kib, table, runTargetLabel, evidenceButtons, stepNavigation, stepExplanation, stepControls, sampleReadings, lessonPractice, missingReading, thpPairs } from './ui.js';
import { renderCowPagemapPanel, renderThpPagemapPanel, resolveDiagnosisGuard } from './pagemap-view.js';

function renderTHP() {
  const groups = thpPairs(state.report.cases);
  if (!groups.length) { $('#content').innerHTML = missingReading(); return; }
  state.selected = Math.min(state.selected, groups.length - 1);
  const { policy, pattern, cases: pair } = groups[state.selected];
  const sides = (policy ? ['disable','allow'] : ['off','on']).map(value => pair.find(c =>
    (policy ? c.parameters.process_thp : c.parameters.thp) === value));
  const labels = policy ? ['进程禁止', '进程允许'] : ['关闭大页', '请求大页'];
  const titles = ['设置对照', '写入前', '按步长写入', '读回核对'];
  state.phase = Math.min(Math.max(0, state.phase), titles.length - 1);
  const step = state.phase;
  const phase = step === 1 ? 'untouched' : 'after_write';
  const conditions = sides.map(c => c?.data?.condition);
  const samples = sides.map(c => c?.data?.samples.find(s => s.phase === phase));
  const values = sides.map(c => c?.data?.value_check);
  const context = { caseRecord: sides[0], peerCaseRecord: sides[1], findings: state.report.diagnosis?.findings };
  const readings = step === 0 ? conditions : step === 3 ? values : samples;
  const describe = (records, f) => records.map((v, i) => labels[i] + (v ? f(v) : '：未采到')).join('；') + '。';
  const bytesLabel = n => n == null ? '—' : kib(n / 1024);
  const rows = labels.map((name, i) => {
    const ct = conditions[i], sample = samples[i], check = values[i];
    if (step === 0) return [name, ct ? bytesLabel(ct.region_bytes) : '—', ct ? bytesLabel(ct.stride_bytes) : '—', ct?.writes ?? '—'];
    if (step === 3) return [name, ct?.writes ?? '—', check?.sum ?? '—', check ? (check.ok ? '相符' : '有偏差') : '未采到'];
    return [name, kib(sample?.rss_kib), kib(sample?.huge_kib), step === 1 ? kib(sample?.size_kib) : sample?.action_minor ?? '—'];
  });
  let explanation, headers, compareVisual = '';
  if (step === 0) {
    explanation = stepExplanation(policy ? '两组都调用 madvise 请求透明大页，只改变进程是否允许使用大页的开关。' : '两组各自建立匿名映射，一组调用 madvise 关闭透明大页，另一组请求大页，其余写法完全一致。',
      'Linux 记下两段映射的大页策略。后面要去 smaps 里看 AnonHugePages（透明大页实际占用的内存），才能判断究竟用上了没有。',
      describe(conditions, ct => policy ? `的进程禁止标志为 ${ct.process_thp_disabled ?? '未记录'}` : `划出 ${bytesLabel(ct.region_bytes)} 区域，起点${ct.huge_aligned ? '已' : '未记录是否'}按大页边界对齐`));
    headers = ['组别', '区域大小', '写入步长', '计划写入次数'];
  } else if (step === 1) {
    explanation = stepExplanation('程序停在第一次写入之前，先各读一次目标映射的 smaps。',
      'Size 是只登记的虚拟地址大小，RSS 则是真正住进内存条的物理内存大小。还没写入时，两者应该差很远。',
      describe(samples, s => `的虚拟 Size 为 ${kib(s.size_kib)}，物理 RSS 只有 ${kib(s.rss_kib)}`));
    headers = ['组别', '驻留 RSS', '其中匿名大页', '映射 Size'];
  } else if (step === 2) {
    const writePlan = ct => `在 ${bytesLabel(ct.region_bytes)} 里每隔 ${bytesLabel(ct.stride_bytes)} 只写 1 字节（共写 ${ct.writes} 字节）`;
    const same = conditions.every(ct => ct && ct.region_bytes === conditions[0]?.region_bytes && ct.stride_bytes === conditions[0]?.stride_bytes && ct.writes === conditions[0]?.writes);
    explanation = stepExplanation(same ? '两组都' + writePlan(conditions[0]) + '，写完立即采样。' : describe(conditions, writePlan),
      '写 1 字节需要可写物理页框：关大页时 Linux 按 4 KiB 分配清零页框并建映射；开透明大页（THP）后，碰 1 字节就可能整张分配 2 MiB 透明大页（AnonHugePages）。',
      `看下方两个 RSS 与前两列：` + describe(samples, s => `组 RSS ${kib(s.rss_kib)}（匿名大页 ${kib(s.huge_kib)}）`) +
      (samples[0]?.rss_kib > 0 && samples[1]?.rss_kib > samples[0].rss_kib ? `${labels[1]}组是${labels[0]}组的 ${Number((samples[1].rss_kib / samples[0].rss_kib).toFixed(2))} 倍。` : ''));
    headers = ['组别', '驻留 RSS', '其中匿名大页', '写入时次缺页'];
    if (samples.every(Boolean) && !resolveDiagnosisGuard(context).caseBlocked) {
      const pageKib = Math.round((conditions[0]?.page_bytes || 4096) / 1024);
      const hugeKib = Math.round((conditions[1]?.huge_bytes || 2097152) / 1024);
      const r0 = samples[0].rss_kib || 0, r1 = samples[1].rss_kib || 0;
      const f0 = samples[0].action_minor, f1 = samples[1].action_minor;
      const maxR = Math.max(1, r0, r1);
      const ratio = r0 > 0 && r1 > 0 ? Number((r1 / r0).toFixed(2)) : null;
      let formulaLine = '';
      if (f0 != null && f1 != null && samples[1].huge_kib > 0 && samples[0].huge_kib === 0 && f0 * pageKib === r0) {
        const hugePages = Math.round(samples[1].huge_kib / hugeKib);
        const rem = r1 - hugePages * hugeKib;
        if (rem >= 0) {
          const faultLead = f0 === f1 ? `同为 ${f0} 次缺页` : `${labels[0]} ${f0} 次 vs ${labels[1]} ${f1} 次缺页`;
          const rightTerm = `${hugePages} × ${kib(hugeKib)}${rem > 0 ? ` + ${kib(rem)}` : ''} = ${kib(r1)}`;
          formulaLine = `${faultLead}：<strong>${f0} × ${kib(pageKib)} = ${kib(r0)}</strong> vs <strong>${rightTerm}</strong>`;
        }
      }
      if (!formulaLine) {
        formulaLine = `${labels[0]}（${f0 ?? '—'} 次缺页）RSS <strong>${kib(r0)}</strong> vs ${labels[1]}（${f1 ?? '—'} 次缺页）RSS <strong>${kib(r1)}</strong>`;
      }
      compareVisual = `<div class="formula-callout"><span class="formula-tag">页粒度对比算式</span><p>${formulaLine}</p></div>
        <div class="thp-compare-bars" aria-label="物理内存占用倍数对比">
          <div class="thp-bar-head"><span>物理内存占用对比（RSS）</span>${ratio != null ? `<strong class="ratio-badge">${ratio === 1 ? '1× · 占用相等' : `${ratio}× 差距`}</strong>` : ''}</div>
          ${[0, 1].map(idx => {
            const val = idx === 0 ? r0 : r1;
            const pct = Math.max(0, Math.min(100, (val / maxR) * 100));
            const accent = idx === 1 && r1 > r0;
            return `<div class="thp-bar-row"><span class="thp-bar-label">${esc(labels[idx])}</span>
              <div class="thp-bar-track"><div class="thp-bar-fill ${accent ? 'is-huge' : ''}" style="width:${pct}%"></div></div>
              <span class="thp-bar-val">${esc(kib(val))}</span></div>`;
          }).join('')}
        </div>`;
    }
  } else {
    explanation = stepExplanation('程序沿同样的步长把刚才写过的字节逐个读回来求和，核对内容是否一致。',
      '不论底层用 4 KiB 小页还是 2 MiB 大页，程序读写虚拟地址看到的逻辑完全一样（透明大页对程序逻辑本身是“透明”的）。',
      describe(values, v => `读回求和为 ${v.sum}，与预期写入次数${v.ok ? '完全一致' : '有偏差'}`));
    headers = ['组别', '预期总和', '实测总和', '核对'];
  }
  const evidence = sides.map((c, i) => {
    if (!c?.artifacts) return '';
    const opts = step === 0 || step === 3 ? { recordKind: step === 0 ? 'condition' : 'values' } : {phase};
    return `<div class="raw-links"><strong>${labels[i]}</strong>${evidenceButtons(c, {...opts, stepLabel: titles[step]}, opts.recordKind ? ['jsonl'] : ['jsonl', 'smaps', 'pagemap'])}</div>`;
  }).join('');
  const samePolicy = groups.map((g,i) => ({...g,i})).filter(g => g.policy === policy);
  const patterns = new Map(samePolicy.map(g => [g.pattern, samePolicy.find(x => x.pattern === g.pattern).i]));
  patterns.set(pattern, state.selected);
  const writeName = p => p === 'sparse' ? '稀疏写' : '逐基础页写';
  const selector = patterns.size > 1 ? `<div class="lesson-conditions">${[...patterns].map(([p,i]) => `<button data-condition="${i}" aria-pressed="${i === state.selected}">${writeName(p)}</button>`).join('')}</div>` : '';
  const settings = `<label>复做条件 <select id="thp-recipe">${['advice','process'].flatMap(kind => ['sparse','full'].map(p => `<option value="${kind}-${p}" ${kind === (policy ? 'process' : 'advice') && p === pattern ? 'selected' : ''}>${kind === 'process' ? '进程开关' : '映射开关'} · ${writeName(p)}</option>`)).join('')}</select></label>`;
  const complete = sides.every(c => c?.data?.samples?.length);
  const observation = complete ? writeName(pattern) + '，' + sides.map((c,i) =>
    labels[i] + '：RSS ' + kib(c.data.samples.at(-1).rss_kib) + '，匿名大页 ' + kib(c.data.samples.at(-1).huge_kib)).join('；') : '';
  $('#content').innerHTML = `<section class="seq-reading focused-lesson"><header class="focus-intro"><small class="question-kicker">拓展实验 · 透明大页 · ${writeName(pattern)}</small>
    <h1>同样的写法，为什么用的物理内存会不同？</h1></header>
    ${selector}${stepNavigation(titles, step, 'data-course-step')}
    <section id="sequence-result" class="seq-panel"><h2>${titles[step]}</h2>
    ${readings.some(Boolean) ? explanation : missingReading()}${compareVisual}${table(headers, rows)}
    ${(step === 1 || step === 2) && samples.some(Boolean) ? renderThpPagemapPanel(samples, labels, undefined, context) : ''}
    <details class="secondary-fold"><summary>查看两组原文</summary>${evidence}</details>
    ${step === titles.length - 1 ? lessonPractice('thp', '再跑一组，比较大页占用', observation, settings, `选好开关与写入方式后点按钮，将在${runTargetLabel()}实跑 1 对大页对照进程（约数秒）；如果一直停在这一步，跑完会自动切到新记录并与本次对照`) : ''}
    <div class="seq-navigation">${stepControls(step, titles.length, '<a class="btn-link primary" href="/labs/extensions">返回拓展实验</a>')}</div></section></section>`;
}
function cowStep(s, c) {
  const cow = c.data.cow;
  const child = s.role === 'child', who = child ? '子' : '父';
  const memory = `${who}进程看目标映射，RSS（页表指着多少算多少）是 ${kib(s.rss_kib)}；按共享比例分摊后的 PSS 是 ${kib(s.pss_kib)}。`;
  const faults = `这一步发生了 ${s.action_minor} 次缺页（都不需要从磁盘读入页面）。`;
  switch (s.phase) {
    case 'untouched': return ['建立映射', '父进程用 mmap 划出一段私有匿名映射，此时还没有任何读写。', 'Linux 只在映射表里登记虚拟地址区间，物理页等到真正访问时再分配。', `映射大小（Size）为 ${kib(s.size_kib)}，` + memory];
    case 'read_all': return ['逐页读取', '父进程从每一张基础页读 1 个字节并求和，全块还没写过数据。', '没写过的匿名页第一次读取固定得到 0。Linux 让这些只读页统一指向全系统共用的“零页”并建立只读页表映射，不急着分配独立物理页框。', faults + memory];
    case 'write_quarter': return ['间隔写入', '父进程每隔四页，把页首字节改写成 1。', '只要往页里写数据，共享零页就不能用了：Linux 触发匿名页次缺页（不读磁盘），现配一块清零的物理页框并建好可写映射；对照上一步就能看到 RSS 上涨。', faults + memory];
    case 'write_all': return ['写遍各页', '父进程把每一页的头一个字节都写成 1。', '已经配好可写页的地址直接写入不缺页，其余还没写过的页都在首次写入时分配清零物理页框并建映射。', faults + memory];
    case 'fork_shared': return ['刚 fork · ' + who, child ? '子进程启动就绪、通过管道等改写信号，先取子进程此时的快照。' : '父进程调用 fork 创建子进程并等其就绪，先取父进程的快照。',
      'fork 刚结束时，两个进程有各自独立的页表，但先指向同一批物理页：映射区间（VMA）在 smaps 里仍保持 rw-p 可写权限，只是内核把底层页表项（PTE）临时设为只读共享。注意两个指标：RSS 在两边各把共享页算了一整遍，PSS（按份平摊）则把两人共用的页各算 1/2。',
      `看下方前三个数：${memory}`];
    case 'child_write_quarter':
    case 'child_write': {
      const zero = cow?.written_pages === 0;
      const check = c.data.value_check;
      const result = child && check ? `读回各页首字节求和，父进程为 ${check.parent_sum}，子进程为 ${check.child_sum}。${zero ? '两边都保留了原值。' : '比较两个和，可以检查子进程改写后父进程的内容是否保持原样。'}这一步子进程发生了 ${s.action_minor} 次次缺页。` : '';
      return [(zero ? '保持共享 · ' : '改写后 · ') + who,
        (zero ? '这一组让子进程不改写任何页。' : '子进程按设定比例把选中页的首字节改成 2。') + (child ? '现在切换到子进程视角。' : '父进程没有改写任何内容，现在先看父进程视角。'),
        zero ? '两边都没有改写共享页，VMA 虽为 rw-p 但共享页表项仍保持只读，Linux 不必复制物理页框，PSS 保持每人 1/2。' : '子进程往页里写“2”时触发写保护缺页；内核核对 VMA 允许写入（rw-p）而 PTE 临时只读，于是触发写时复制（COW）：只给被改写的页现拷一份新物理页框并恢复该页 PTE 可写，父进程依然守着写“1”的旧页，其余未动页继续共享。',
        child && check ? result : memory];
    }
    default: return [s.phase, '程序在这个阶段记录目标映射。', '根据 smaps 对照驻留量与共享份额。', memory];
  }
}

function cowFormulaCallout(sample, peer, cow) {
  if (!sample || !peer) return '';
  const totalPss = sample.pss_kib + peer.pss_kib;
  if (sample.phase === 'fork_shared') {
    return `<div class="formula-callout"><span class="formula-tag">PSS 分摊算式</span><p>全部共享：单进程 <strong>${kib(sample.size_kib)} ÷ 2 = ${kib(sample.pss_kib)}</strong> → 父子合计 <strong>${kib(sample.pss_kib)} + ${kib(peer.pss_kib)} = ${kib(totalPss)}</strong></p></div>`;
  }
  if (!sample.phase.startsWith('child_write')) return '';
  const priv = cow?.written_kib ?? sample.private_dirty_kib;
  const shared = Math.max(0, sample.size_kib - priv);
  if (Math.abs(priv + shared / 2 - sample.pss_kib) > 4) {
    return `<div class="formula-callout"><span class="formula-tag">PSS 分摊观测</span><p>单进程实测 PSS <strong>${kib(sample.pss_kib)}</strong> → 父子合计 <strong>${kib(sample.pss_kib)} + ${kib(peer.pss_kib)} = ${kib(totalPss)}</strong></p></div>`;
  }
  let single = '';
  if (priv === 0) {
    single = `0 + ${kib(sample.size_kib)} ÷ 2 = ${kib(sample.pss_kib)}`;
  } else if (shared > 0) {
    single = `${kib(priv)} + ${kib(shared)} ÷ 2 = ${kib(sample.pss_kib)}`;
  } else {
    single = `${kib(priv)} + 0 = ${kib(sample.pss_kib)}`;
  }
  return `<div class="formula-callout"><span class="formula-tag">PSS 分摊算式（独占整算 + 共享折半）</span><p>单进程 <strong>${single}</strong> → 父子合计 <strong>${kib(sample.pss_kib)} + ${kib(peer.pss_kib)} = ${kib(totalPss)}</strong></p></div>`;
}

function renderBaseline() {
  const cases = state.report.cases.filter(c => c.suite === 'baseline');
  if (!cases.length) { $('#content').innerHTML = missingReading(); return; }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], samples = c.data?.samples || [];
  state.phase = Math.min(Math.max(0, state.phase), Math.max(0, samples.length - 1));
  const sample = samples[state.phase];

  const steps = samples.map(s => cowStep(s, c));
  const selected = steps[state.phase];
  const peer = sample && samples.find(s => s.phase === sample.phase && s.role !== sample.role);
  const readings = sample ? [['驻留 RSS', kib(sample.rss_kib)], ['分摊 PSS', kib(sample.pss_kib)]] : [];
  if (peer) readings.push(['父子 PSS 合计', kib(sample.pss_kib + peer.pss_kib)]);
  if (sample && (['read_all','write_quarter','write_all'].includes(sample.phase) || (sample.role === 'child' && sample.phase.startsWith('child_write')))) readings.push(['本步次缺页', sample.action_minor + ' 次']);
  const pssFormula = cowFormulaCallout(sample, peer, c.data?.cow);
  const fraction = c.data?.cow?.fraction ?? c.parameters.cow_fraction ?? '1/4';
  const settings = `<label>下次复做的改写比例 <select id="trial-fraction" data-mib="${esc(c.parameters.mib)}">${['0','1/8','1/4','1/2','1'].map(f => `<option value="${f}" ${f === (fraction === '0' ? '1/4' : '0') ? 'selected' : ''}>${f === '0' ? '不改写' : f === '1' ? '全部改写' : f}</option>`).join('')}</select></label>`;
  const final = samples.filter(s => s.phase.startsWith('child_write'));
  const observation = final.length === 2 ? `${c.parameters.mib} MiB，改写 ${fraction}，父子 PSS 合计 ${kib(final[0].pss_kib + final[1].pss_kib)}` : '';
  $('#content').innerHTML = `<section class="seq-reading focused-lesson"><header class="focus-intro"><small class="question-kicker">拓展实验 · 写时复制</small>
    <h1>fork 之后，哪些物理页会复制？</h1>
    <p>父进程先写满 ${esc(c.parameters.mib)} MiB，fork 后观察子进程${fraction === '0' ? '保持原样' : '改写 ' + esc(fraction) + ' 的页'}。用父子进程各自的 PSS 看它们总共占了多少物理内存。</p></header>
    ${sample ? stepNavigation(steps.map(st => st[0]), state.phase, 'data-course-step') : ''}
    <section class="seq-panel" id="sequence-result"><h2>${esc(selected?.[0] || '缺少采样')}</h2>
    ${sample ? stepExplanation(...selected.slice(1)) + sampleReadings(readings) + pssFormula + renderCowPagemapPanel(sample, peer, c.data?.cow, { caseRecord: c, findings: state.report?.diagnosis?.findings }) : missingReading()}
    ${sample ? `<details class="secondary-fold"><summary>查看这一步的原文</summary><div class="raw-links">${evidenceButtons(c, {phase: sample.phase, role: sample.role, stepLabel: selected[0]}, ['jsonl','smaps','pagemap','stderr'])}</div></details>` : ''}
    ${state.phase === steps.length - 1 || !sample ? lessonPractice('lesson-cow', '再跑一次，比较父子 PSS', observation, settings, `选好比例后点按钮，将在${runTargetLabel()}实跑 1 组新的 COW 父子进程（约数秒）；如果一直停在这一步，跑完会自动切到新记录并与本次父子 PSS 对照`) : ''}
    ${sample ? `<div class="seq-navigation">${stepControls(state.phase, steps.length, '<a class="btn-link primary" href="/labs/extensions">返回拓展实验</a>')}</div>` : ''}</section></section>`;
}

export { renderTHP, renderBaseline };
