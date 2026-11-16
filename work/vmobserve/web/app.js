const $ = (selector) => document.querySelector(selector);
const sequencePhases = {
  before_alloc: '申请前', alloc_1KiB: '申请 1 KiB', alloc_256KiB: '申请 256 KiB',
  alloc_1MiB: '申请 1 MiB', freed: '释放全部'
};

function renderSequence() {
  const intro = `<div class="course-intro sequence-toolbar">
    <p>同一进程连续申请 1 KiB、256 KiB 和 1 MiB，最后释放全部。</p>
    <button id="run-sequence" class="primary">运行连续分配</button>
    <p class="sequence-prompt">先预测：每次 malloc 都会触发系统调用吗？释放后的原地址还有映射吗？</p></div>`;
  const cases = state.report?.cases.filter(c => c.suite === 'sequence') ?? [];
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">这条记录没有连续分配实验。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const current = cases[state.selected], data = current.data;
  const links = [['jsonl', '动作数据'], ['smaps', '完整 smaps'], ['syscalls', '完整 strace']]
    .filter(([kind]) => current.artifacts?.[kind])
    .map(([kind, label]) => `<button data-raw="${esc(current.id)}" data-kind="${kind}">${label}</button>`).join('');
  const selector = `<label class="selector">实验轮次<select id="case-select">${cases.map((entry, index) =>
    `<option value="${index}" ${index === state.selected ? 'selected' : ''}>第 ${esc(entry.parameters.repeat)} 次 · ${esc(labels[entry.status] || entry.status)}</option>`).join('')}
    </select></label>`;
  if (!data?.samples?.length) {
    $('#content').innerHTML = intro + `<section class="observation">${selector}
      <p>${esc(current.error?.message || '本案例没有可回放的采样。')}</p><div class="raw-links">${links}</div></section>`;
    return;
  }

  const actionFor = phase => data.actions.find(action => action.phase === phase);
  const samples = data.samples;
  state.phase = Math.min(state.phase, samples.length - 1);
  const sample = samples[state.phase];
  const action = actionFor(sample.phase);
  const title = step => sequencePhases[step.phase] || step.phase;
  const sourceLabels = {new_brk_range: '返回块落在本次 brk 新增范围', new_mmap_range: '返回块落在本次 mmap 返回范围',
    no_memory_syscall: '该动作窗口没有记录到内存管理调用', unresolved: '现有调用无法确认返回块来源'};
  const timeline = samples.map((step, index) => {
    const calls = [...new Set((actionFor(step.phase)?.events ?? []).map(event => event.text.split('(')[0]))];
    return `<button data-sequence-step="${index}" ${index === state.phase ? 'aria-current="step"' : ''}>
      <span class="step-number">${String(index + 1).padStart(2, '0')}</span>
      <strong>${esc(title(step))}</strong><span class="step-call">${esc(calls.join(' · ') || '—')}</span></button>`;
  }).join('');
  const blocks = data.condition.sizes.map((size, index) => {
    const block = sample.blocks[index];
    const active = block?.alive;
    const released = block && !block.alive;
    const status = active ? '已分配' : released ? '已释放' : '尚未申请';
    const mapName = block?.mapping?.pathname || (block?.mapping ? '匿名映射' : '');
    return `<li class="${active ? 'live' : released ? 'released' : ''}"><strong>${kib(size / 1024)}</strong>
      <span>${status}${mapName ? ' · ' + esc(mapName) : ''}</span></li>`;
  }).join('');
  const calls = action?.events?.length
    ? `<pre>${esc(action.events.map(event => 'L' + event.line + '  ' + event.text).join('\n'))}</pre>`
    : `<p class="detail-copy">${sample.phase === 'before_alloc' ? '此时尚未执行分配动作。' : '当前窗口内没有观测到内存管理调用。'}</p>`;
  const blockMappings = table(['块', '保留的地址', '动作后映射'], sample.blocks.map(block => [
    kib(block.requested_bytes / 1024), block.address ? '0x' + block.address : '—',
    block.mapping?.header || '—'
  ]));
  $('#content').innerHTML = intro + `<nav class="timeline" aria-label="分配与释放阶段">${timeline}</nav>
    <div class="experiment sequence-body"><section class="observation">
      ${selector}<div class="sequence-heading"><h2>${esc(title(sample))}</h2><span class="muted mono">PID ${esc(data.condition.pid)} · ${state.phase + 1} / ${samples.length}</span></div>
      <dl class="sequence-data"><div><dt>存活块数</dt><dd>${esc(sample.count)} / 3</dd></div>
        <div><dt>Program break</dt><dd class="mono">0x${esc(sample.program_break)}</dd></div>
        <div><dt>去重后相关映射</dt><dd>${esc(sample.related_vma_count)} 个</dd></div>
        <div><dt>相关映射 RSS</dt><dd>${kib(sample.related_rss_kib)}</dd></div></dl>
      <h4>块状态</h4><ul class="block-grid">${blocks}</ul>
      <div class="course-navigation">
        <button data-sequence-step="${state.phase - 1}" ${state.phase === 0 ? 'disabled' : ''}>上一步</button>
        <button data-sequence-step="${state.phase + 1}" ${state.phase === samples.length - 1 ? 'disabled' : ''}>下一步</button></div>
      <details><summary>本阶段的完整映射</summary>${blockMappings}</details>
    </section><aside class="sequence-evidence" aria-label="当前阶段证据">
      <section><h3>动作窗口内的系统调用</h3>${calls}
        ${action?.allocation_source ? `<p class="detail-copy">${esc(sourceLabels[action.allocation_source])}</p>` : ''}</section>
      <section><h3>原始记录</h3><div class="raw-links">${links}</div>
       <details><summary>统计口径和跟踪工具</summary>
         <p>RSS 按相交的完整映射去重。释放后使用保存的地址查询映射。</p>
         <pre>${esc(state.report.trace_tool?.version || '这条记录未单独采集工具版本。')}</pre></details></section>
    </aside></div>`;
}

function renderLayout() {
  const intro = `<div class="course-intro"><h2>课内 3.1 · 程序里的地址在哪里？</h2><p>先看第七章 9、12、43–49 页，区分虚拟地址、页和地址转换，再对照程序与动态库的映射。</p><p class="course-question">先预测：程序函数与栈局部变量能放在同一个可写区域吗？只读常量应该有什么权限？</p><button id="run-layout" class="primary">运行地址空间实验</button><p class="detail-copy">新建三个独立进程，保存各自地址、装载段和完整 smaps。下方显示已选历史记录。</p></div>`;
  const cases = state.report.cases.filter(c=>c.suite==='layout');
  if (!cases.length) { $('#content').innerHTML = intro + '<p class="empty">这轮历史没有地址空间实验。点击上方按钮可采集新记录。</p>'; return; }
  state.selected = Math.min(state.selected,cases.length-1);
  const c = cases[state.selected], d = c.data;
  const short = name => name ? name.split('/').at(-1) : '匿名映射';
  const selector = `<label class="selector">实验：<select id="case-select">${cases.map((item,i)=>`<option value="${i}" ${i===state.selected?'selected':''}>独立进程 · 第 ${item.parameters.repeat} 次 · ${esc(labels[item.status]||item.status)}</option>`).join('')}</select></label>`;
  const points = d ? table(['程序对象','虚拟地址','实际权限','所在映射','ELF 装载段'],d.samples.map(s=>[s.symbol_label,'0x'+s.address,s.permissions,short(s.pathname),s.elf_object?short(s.elf_object)+' · #'+s.elf_segment_index:'堆 / 栈，无对应 PT_LOAD'])) : '<p class="empty">本次采集或校验未完成，请查看原始记录与错误。</p>';
  const segments = d ? table(['对象 / 段','装载基址','ELF 段虚拟地址','运行起点','ELF 权限','相交映射数'],d.segments.map(s=>[short(s.object)+' · #'+s.index,'0x'+s.load_bias,'0x'+s.vaddr,'0x'+s.start,s.flags,s.mappings.length])) : '';
  const repeats = cases.filter(item=>item.data).map(item=>[item.parameters.repeat,...['function','stack'].map(symbol=>'0x'+item.data.samples.find(s=>s.symbol===symbol).address)]);
  const findings = findingFor([c.id],['address_mapping','layout_permissions','incomplete_evidence']);
  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">${selector}<p class="muted">历史回放 · 检查 ${esc(c.validation.status)} · PID ${esc(d?.condition.pid)}</p><details><summary>展开真实对应关系（先做预测）</summary>${points}<p>r / w / x 分别表示读、写、执行权限；p 表示私有映射，不表示这些页已经全部驻留。这里展示虚拟地址。</p></details><details><summary>进一步：程序和动态库怎样装入地址空间？</summary><p>装载后的段起点 = 装载基址 + ELF 段虚拟地址。PT_LOAD 是装载段，一个段可能跨多条映射；装载器还可能收紧部分页面的权限。</p>${segments}${d?`<details><summary>逐段查看相交映射原文</summary><pre>${esc(d.segments.map(s=>short(s.object)+' #'+s.index+'\n'+s.mappings.join('\n')).join('\n\n'))}</pre></details>`:''}</details><details><summary>比较三次独立运行的地址</summary>${table(['重复','函数地址','栈变量地址'],repeats)}<p>观察地址是否变化，再比较对象归属和权限是否稳定。这里只比较本轮进程。</p></details><p class="course-question">现在用自己的话解释：知道变量的虚拟地址和所属映射，是否就知道它的物理页框？</p>${c.error?`<pre>${esc(JSON.stringify(c.error,null,2))}</pre>`:''}${c.artifacts?`<div class="raw-links"><button data-raw="${esc(c.id)}" data-kind="smaps">查看原始映射与 smaps</button><button data-raw="${esc(c.id)}" data-kind="jsonl">查看地址与装载段记录</button></div>`:''}</div>${diagnosisHTML(findings)}</div>`;
}
const state = {runs:[], id:null, report:null, tab:'layout', selected:0, phase:0, timer:null, job:null, pendingJobId:null, config:null, cowFraction:'all', group4Task:'all'};
const labels={completed:'完成',completed_with_deviations:'完成 · 有偏差',failed:'失败',timeout:'超时',cancelled:'中断',unsupported:'环境不支持',running:'记录未结束',not_run:'未运行'};
const confidence={confirmed:'已确认（受控观测）',probable:'可能原因',insufficient_evidence:'证据不足'};
const phases={untouched:'创建映射，尚未访问',read_all:'逐页只读',write_quarter:'每四页写一页',write_all:'写入每个基础页',fork_shared:'fork 后暂停，尚未改写',child_write_quarter:'子进程改写四分之一',after_write:'按步长写入后'};
const esc=(v)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kib=(n)=>n==null?'—':n>=1024&&n%1024===0?`${n/1024} MiB`:`${n} KiB`;
const url=(route,params)=>route+'?'+new URLSearchParams(params);
async function api(route,options){const res=await fetch(route,options);const value=await res.json();if(!res.ok)throw new Error(value.error||`HTTP ${res.status}`);return value;}
function error(message){$('#error').hidden=!message;$('#error').textContent=message||'';}
function stop(){clearInterval(state.timer);state.timer=null;}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function topicInRun(tab, suites) {
  if (tab === 'group3') return suites.some(suite => ['link-dynamic','link-static','sequence','demand512','stack'].includes(suite));
  if (tab === 'group4') return suites.some(suite => suite.startsWith('g4-'));
  if (tab === 'linkage') return suites.includes('link-dynamic') || suites.includes('link-static');
  return suites.includes(tab);
}

function history() {
  const filter = $('#environment').value;
  const records = state.runs.filter(run => filter === 'all' || filter === run.group);
  $('#runs').innerHTML = records.map(run => {
    const date = run.run_id.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
    const clock = date ? `${date[1]}-${date[2]}-${date[3]} · ${date[4]}:${date[5]} UTC` : run.run_id;
    const name = run.group === 'sample' ? '内置样例' : run.distribution;
    return `<button class="run-row" data-run="${esc(run.id)}" aria-current="${run.id === state.id}">
      <strong>${esc(name)}</strong><span>${esc(labels[run.status] || run.status)}</span>
      <span class="run-date">${esc(clock)} · ${esc(run.count)} 项</span></button>`;
  }).join('') || '<p class="empty">该环境暂无记录</p>';
}

async function refresh() {
  state.runs = await api('/api/runs');
  history();
  if (state.id) return;
  const preferred = state.runs.find(run => run.group !== 'sample' && run.status === 'completed' && run.suites?.includes('layout'))
    || state.runs[0];
  if (preferred) {
    if (!preferred.suites?.includes('layout')) state.tab = preferred.suites?.includes('sequence') ? 'sequence' : 'evidence';
    await select(preferred.id);
  } else {
    $('#content').innerHTML = '<p class="empty">尚无实验记录。</p>';
  }
}

async function select(id) {
  stop();
  state.id = id;
  state.report = null;
  state.selected = 0;
  state.phase = 0;
  error('');
  history();
  renderHeading();
  $('#mode').textContent = '校验中';
  delete $('#mode').dataset.integrity;
  $('#metadata').textContent = '';
  $('#content').innerHTML = '<p class="empty">正在校验证据与源码哈希…</p>';
  try {
    const report = await api(url('/api/report', {id}));
    if (state.id !== id) return;
    state.report = report;
    render();
  } catch (e) {
    if (state.id !== id) return;
    $('#mode').textContent = '回放失败';
    $('#content').innerHTML = '<p class="empty">无法读取这条记录。</p>';
    error(e.message);
  }
}

function renderHeading() {
  document.querySelectorAll('[data-tab]').forEach(button => {
    if (button.dataset.tab === state.tab) {
      button.setAttribute('aria-current', 'page');
      $('#topic-title').textContent = button.textContent;
    } else button.removeAttribute('aria-current');
  });
  $('#export').disabled = !state.report;
}

function render() {
  renderHeading();
  const r = state.report;
  if (!r) return;
  const env = r.environment;
  const provenance = r.original_schema ? '历史样例' : r.data_origin === 'real_execution' ? '实测回放' : '合成数据';
  const status = r.integrity.status === 'failed' ? '校验失败' : labels[r.status] || r.status;
  $('#mode').textContent = `${provenance} · ${status}`;
  $('#mode').dataset.integrity = r.integrity.status;
  $('#metadata').textContent = [env.distribution?.PRETTY_NAME || env.system, env.kernel, r.run_id].filter(Boolean).join(' · ');
  $('#integrity').textContent = `证据校验：${r.integrity.status}。 ${r.integrity.note}`;
  $('#manifest').textContent = JSON.stringify({source_sha256:r.sources, integrity_errors:r.integrity.errors, related_run:r.related_run}, null, 2);
  if (r.integrity.status === 'failed') error('这条记录有证据校验失败，请查看逐项状态。');
  const views = {layout: renderLayout, sequence: renderSequence, group3: renderGroup3, group4: renderGroup4,
    linkage: renderGroup3, stack: renderGroup3, course: renderCourse, thp: renderTHP, baseline: renderBaseline};
  (views[state.tab] || renderEvidence)();
  bindContent();
  jobUI();
}

function diagnosisHTML(findings,recheck=false){return `<aside class="diagnostic"><h2>诊断与复验</h2>${findings.length?findings.map(f=>`<p class="confidence ${esc(f.confidence)}">${esc(confidence[f.confidence])}</p><h3>${esc(f.title)}</h3><p>${esc(f.explanation)}</p>${f.next_steps?`<ol>${f.next_steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>`:''}<details><summary>查看判断依据</summary><pre>${esc(JSON.stringify(f.evidence,null,2))}</pre></details>`).join(''):'<p class="confidence insufficient_evidence">证据不足</p><p>没有满足规则前提的完整证据，暂不确定原因。</p>'}${recheck?'<button id="recheck">重新运行开/关对照</button>':''}<div class="boundary"><h3>证据边界</h3>${findings.length?findings.map(f=>`<p>${esc(f.limitations)}</p>`).join(''):'<p>缺页计数属于整个进程；没有逐页物理跟踪。</p>'}</div></aside>`;}
function chart(rows){const max=Math.max(1,...rows.map(r=>r[1]||0));return `<div class="chart" role="img" aria-label="目标区域 RSS 对照"><p class="chart-caption">RSS / 目标区域</p>${rows.map(([name,value,kind])=>`<div class="bar-row"><span>${esc(name)}</span><div class="track"><div class="bar ${kind||''}" style="width:${Math.max(0,(value||0)/max*100)}%"></div></div><span class="bar-value">${kib(value)}</span></div>`).join('')}</div>`;}
function findingFor(cases,rules){return state.report.diagnosis.findings.filter(f=>rules.includes(f.rule)&&f.evidence.some(e=>e&&cases.includes(e.case_id)));}
function renderTHP(){const cases=state.report.cases.filter(c=>c.suite==='thp' && !['allow','disable'].includes(c.parameters.process_thp));if(!cases.length){$('#content').innerHTML=policyHTML()+'<p class="empty">本轮没有区域建议开/关实验。运行完整实验可采集该主题。</p>';return;}const groups=[...new Set(cases.map(c=>`${c.parameters.pattern}:${c.parameters.repeat}`))];state.selected=Math.min(state.selected,groups.length-1);const [pattern,repeat]=groups[state.selected].split(':');const pair=cases.filter(c=>c.parameters.pattern===pattern&&c.parameters.repeat===Number(repeat));const off=pair.find(c=>c.parameters.thp==='off'),on=pair.find(c=>c.parameters.thp==='on');const a=off?.data?.samples.at(-1),b=on?.data?.samples.at(-1);const condition=off?.data?.condition||on?.data?.condition;const valid=state.report.diagnosis.comparisons.find(c=>c.off===off?.id&&c.on===on?.id&&c.control_valid);let findings=findingFor(pair.map(c=>c.id),valid?[`thp_${pattern}_control`]:['thp_not_observed','observed_thp','incomplete_evidence','expectation_deviation']);const title=valid&&pattern==='sparse'&&b.rss_kib>a.rss_kib?`相同的${condition.writes}次写入，不同的驻留成本`:'透明大页：请求与实际驻留';$('#content').innerHTML=policyHTML()+`<div class="experiment"><div class="observation"><h2>${esc(title)}</h2><label class="selector">实验：<select id="case-select">${groups.map((g,i)=>`<option value="${i}" ${i===state.selected?'selected':''}>${g.split(':')[0]==='sparse'?'稀疏写':'逐基础页写'} · 第${g.split(':')[1]}次</option>`).join('')}</select></label>${a||b?chart([['关闭透明大页',a?.rss_kib,'off'],['请求透明大页',b?.rss_kib,'on']]):'<p class="empty">没有完整观测，查看执行错误或原始输出。</p>'}${table(['条件','RSS','AnonHugePages','次缺页'],[['关闭',kib(a?.rss_kib),kib(a?.huge_kib),a?.action_minor??'—'],['请求',kib(b?.rss_kib),kib(b?.huge_kib),b?.action_minor??'—']])}<p class="detail-copy">${condition?`每 ${kib(condition.stride_bytes/1024)} 写 1 字节，区域 ${kib(condition.region_bytes/1024)}。`:'本轮采集不完整。'}</p>${valid&&pattern==='sparse'&&b.rss_kib>a.rss_kib?`<p><strong>${valid.rss_ratio} 倍是驻留差异，不是性能提升。</strong></p>`:''}<button id="view-raw">查看原始证据</button><div id="raw-links" class="raw-links" hidden>${pair.filter(c=>c.artifacts).map(c=>`<button data-raw="${esc(c.id)}" data-kind="smaps">${c.parameters.thp==='off'?'关闭':'请求'} · smaps</button><button data-raw="${esc(c.id)}" data-kind="jsonl">JSONL</button>`).join('')}</div></div>${diagnosisHTML(findings,true)}</div>`;}
function cowControls(){
  const options=[['all','五组对照：0、1/8、1/4、1/2、全部'],['0','不改写'],['1/8','改写 1/8'],['1/4','改写 1/4'],['1/2','改写 1/2'],['1','全部改写']];
  return `<div class="cow-controls"><label for="cow-fraction">下一次真实运行：子进程写入比例</label><select id="cow-fraction">${options.map(([v,t])=>`<option value="${v}" ${v===state.cowFraction?'selected':''}>${t}</option>`).join('')}</select><button id="run-cow">运行 COW 对照</button><p class="detail-copy">16 / 64 MiB，各重复 3 次。生成新记录；下方仍为已选历史观测。</p></div>`;
}
function phaseLabel(sample,c){
  if(sample.phase==='child_write')return c.data.cow.written_pages===0?'子进程保持未改写':`子进程改写 ${c.data.cow.fraction}（${c.data.cow.written_pages} 页）`;
  return phases[sample.phase]||sample.phase;
}
function renderBaseline(){
  const cases=state.report.cases.filter(c=>c.suite==='baseline');
  if(!cases.length){$('#content').innerHTML=cowControls()+'<p class="empty">本轮没有基础实验，可运行新的 COW 对照。</p>';return;}
  state.selected=Math.min(state.selected,cases.length-1);
  const c=cases[state.selected],samples=c.data?.samples||[];
  state.phase=Math.min(state.phase,Math.max(0,samples.length-1));
  const sample=samples[state.phase];
  const findings=findingFor([c.id],['anonymous_zero_page','cow_accounting','incomplete_evidence','expectation_deviation']);
  const comparisons=(state.report.diagnosis.cow_observations||[]).filter(x=>x.mib===c.parameters.mib&&x.repeat===c.parameters.repeat);
  const summary=comparisons.length?`<h3>写入量与父子 PSS 合计</h3><p class="detail-copy">同轮 ${c.parameters.mib} MiB · 第 ${c.parameters.repeat} 次。预计值基于本实验的受控条件。</p>${table(['改写比例','页数','预计合计','实测合计','校验'],comparisons.map(x=>[x.fraction,`${x.written_pages}/${x.total_pages}`,kib(x.expected_pss_kib),kib(x.observed_pss_kib),x.confirmed?'已确认观测':'未确认']))}`:'';
  $('#content').innerHTML=cowControls()+`<div class="experiment"><div class="observation"><h2>沿着程序动作，回放内存变化</h2><label class="selector">实验：<select id="case-select">${cases.map((c,i)=>`<option value="${i}" ${i===state.selected?'selected':''}>${c.parameters.mib} MiB · 改写 ${esc(c.data?.cow?.fraction||c.parameters.cow_fraction||'1/4')} · 第${c.parameters.repeat}次</option>`).join('')}</select></label>${summary}${sample?`<div class="playback"><button id="play">${state.timer?'暂停回放':'播放历史步骤'}</button><input id="phase" aria-label="历史采样步骤" type="range" min="0" max="${samples.length-1}" value="${state.phase}"></div><p><strong>${state.phase+1}/${samples.length} · ${esc(phaseLabel(sample,c))} · ${sample.role==='parent'?'父进程':'子进程'}</strong></p>${chart([['RSS',sample.rss_kib,'off'],['PSS',sample.pss_kib,'on']])}${table(['动作阶段','角色','RSS','PSS','次缺页'],samples.map(s=>[phaseLabel(s,c),s.role==='parent'?'父':'子',kib(s.rss_kib),kib(s.pss_kib),s.action_minor]))}<p class="detail-copy">播放仅改变显示步骤，不会重新运行实验。父子 RSS 含重复计入的共享页，不能直接相加作为物理占用。未采集逐物理页复制事件。</p>`:'<p class="empty">采集不完整，没有可播放的观测。</p>'}${c.artifacts?`<div class="raw-links"><button data-raw="${esc(c.id)}" data-kind="smaps">查看原始 smaps</button><button data-raw="${esc(c.id)}" data-kind="jsonl">查看 JSONL</button></div>`:''}</div>${diagnosisHTML(findings)}</div>`;
}

const courseSteps = [
  {title:'申请之前', code:'尚未调用 malloc', question:'程序将拿到的地址，与内存条上的位置有什么关系？', theory:'C 程序使用虚拟地址。操作系统通过页表把虚拟页映射到物理页。此步保存申请前的映射，供后面比较。'},
  {title:'申请完成，尚未写入', code:'memory = malloc(size)', question:'申请了这块空间，实际驻留内存就会增加同样多吗？', theory:'malloc 返回可供程序使用的地址。分配器可能使用已有空间，也可能向操作系统取得新空间。分配器管理信息本身会访问内存，因此申请后可能已经有少量驻留。'},
  {title:'写入前四分之一', code:'每隔一个基础页写 1 字节，累计访问前 1/4', question:'这次写入会增加多少驻留？会发生缺页吗？', theory:'首次写到尚未建立可写物理映射的页时，可能触发缺页异常，由内核建立映射后继续执行。小块申请可能已在驻留页内，实际缺页可以为零。'},
  {title:'写到一半', code:'继续按基础页步长写入，累计访问前 1/2', question:'继续访问新页后，驻留和缺页数怎样变化？', theory:'把本步与上一步比较。缺页列记录本次动作的增量，RSS 记录采样时的驻留量。基础页尺寸、已有驻留和大页状态都会影响结果。'},
  {title:'写完全部页位置', code:'继续按基础页步长写入，累计访问全部位置', question:'为什么测出的映射大小可能比申请大小更大？', theory:'malloc 块可能位于更大的内存映射中，与分配器管理信息或其他对象共用映射。此处的 RSS 统计整个相关映射，申请大小单独列出。每页只写一个字节，物理分配以页为单位。'},
  {title:'释放之后', code:'free(memory)', question:'释放后，原地址所在的映射一定立即消失吗？', theory:'free 把块交还分配器。分配器可能保留空间，也可能将映射归还内核。此步通过系统记录检查原地址范围的映射状态，已释放的指针不能再用于读写。'}
];
function renderCourse() {
  const intro = `<div class="course-intro"><h2>课程实验 · 从申请到释放</h2><p>结合虚拟地址、页表和缺页处理，逐步阅读一次 malloc 实验。</p><button id="run-course" class="primary">运行课程实验</button> <a href="/lesson">进入动手任务：先预测，再写代码</a><details><summary>与原课例的关系</summary><p>依据《应用层实验文档》PDF 第 10–12 页及 lab3_2/malloc.c 的 1 KiB、256 KiB、1 MiB 尺寸，以及 lab3_3/demand.c 的分段写入动作。增加 16 MiB 对照，每种尺寸在独立进程中重复三次。原课例依次申请多个块，本工具采用单块独立实验，便于比较。对应《第七章 主存管理》57–60 页的请求调页机制。</p></details></div>`;
  const cases = state.report.cases.filter(c=>c.suite==='course').sort((a,b)=>b.parameters.requested_kib-a.parameters.requested_kib || a.parameters.repeat-b.parameters.repeat);
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前历史没有课程实验。点击上方按钮采集新记录。</p>';
    return;
  }
  state.selected = Math.min(state.selected,cases.length-1);
  state.phase = Math.min(state.phase,courseSteps.length-1);
  const c = cases[state.selected], step = courseSteps[state.phase];
  const sample = c.data?.samples[state.phase];
  const relevantRule = state.phase <= 1 ? 'malloc_mapping' : state.phase === 5 ? 'malloc_free' : 'malloc_demand';
  const findings = findingFor([c.id],[relevantRule,'incomplete_evidence','course_task_incomplete']);
  const selector = `<label class="selector">申请大小与重复次数<select id="case-select">${cases.map((item,index)=>`<option value="${index}" ${index===state.selected?'selected':''}>${kib(item.parameters.requested_kib)} · 第 ${item.parameters.repeat} 次</option>`).join('')}</select></label>`;
  const metrics = sample ? table(['本步观测','实际记录'],[
    ['申请大小',kib(c.parameters.requested_kib)],
    ['已写位置 / 总位置',`${sample.written_positions} / ${c.data.condition.positions}`],
    ['相关映射 RSS',kib(sample.rss_kib)],
    ['其中大页驻留',kib(sample.huge_kib)],
    ['本步次缺页 / 主缺页',`${sample.action_minor} / ${sample.action_major}`],
    ['原地址范围的映射',sample.mapping_present?'存在':'未发现'],
    ['返回地址',sample.address==='0'?'尚未申请':`0x${sample.address}`]
  ]) : '<p class="empty">本案例采集不完整，查看原始证据或执行日志。</p>';
  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">${selector}<p class="muted">历史回放 · ${c.parameters.course_code==='student'?'学生代码':'参考实现'} · 检查 ${esc(c.validation?.status)} · 第 ${state.phase+1} / 6 步</p><h3>${step.title}</h3><p><code>${step.code}</code></p><p class="course-question">${step.question}</p>${metrics}<p class="detail-copy">RSS 是相关整个映射的驻留量。映射可能包含其他对象。申请前和释放后按保存的地址范围查找。</p><details class="course-theory"><summary>展开课内原理</summary><p>${step.theory}</p></details><div class="course-navigation"><button data-course-step="${state.phase-1}" ${state.phase===0?'disabled':''}>上一步</button><button data-course-step="${state.phase+1}" ${state.phase===5?'disabled':''}>下一步</button></div><details><summary>查看本轮全部阶段</summary>${c.data?table(['阶段','RSS','本步次缺页'],c.data.samples.map((s,i)=>[courseSteps[i].title,kib(s.rss_kib),s.action_minor])):''}</details>${c.artifacts?`<div class="raw-links"><button data-raw="${esc(c.id)}" data-kind="smaps">查看原始 smaps</button><button data-raw="${esc(c.id)}" data-kind="jsonl">查看动作记录</button></div>`:''}</div>${diagnosisHTML(findings)}</div>`;
}

function renderEvidence(){const r=state.report;$('#content').innerHTML=`<h2>证据与环境</h2><p>诊断根据原始 JSONL 与 smaps 重新计算，旧报告保持原样。旧格式缺少原始文件哈希时明确标注为部分校验。</p><dl class="info"><dt>数据来源 / 当前模式</dt><dd>${esc(r.data_origin)} / ${esc(r.view_mode)}</dd><dt>执行状态 / 完整性</dt><dd>${esc(r.status)} / ${esc(r.integrity.status)}</dd><dt>系统与内核</dt><dd>${esc(r.environment.os_release)} / ${esc(r.environment.kernel)}</dd><dt>全局 THP 策略</dt><dd>${esc(r.environment.thp_enabled||'旧格式未统一采集；请查看原始子报告')}</dd></dl><details><summary>完整环境记录</summary><pre>${esc(JSON.stringify(r.environment,null,2))}</pre></details><h3>逐项执行与原始记录</h3>${r.cases.map(c=>`<div class="evidence-row"><span>${esc(c.id)} · ${esc(labels[c.status]||c.status)} · ${esc(c.validation?.status)}</span>${c.artifacts?`<button data-raw="${esc(c.id)}" data-kind="jsonl">JSONL</button><button data-raw="${esc(c.id)}" data-kind="smaps">smaps</button>`:''}</div>${c.error?`<pre>${esc(JSON.stringify(c.error,null,2))}</pre>`:''}`).join('')}`;}
function bindContent(){bindSequenceSteps();$('#run-group4')?.addEventListener('click',()=>run('group4'));$('#group4-task')?.addEventListener('change',e=>{state.group4Task=e.target.value;});$('#run-sequence')?.addEventListener('click',()=>run('sequence'));$('#run-group3')?.addEventListener('click',()=>run('group3'));$('#run-layout')?.addEventListener('click',()=>run('layout'));$('#run-policy')?.addEventListener('click',()=>run('policy'));$('#policy-recheck')?.addEventListener('click',()=>run('policy-recheck'));$('#run-course')?.addEventListener('click',()=>run('course'));document.querySelectorAll('[data-course-step]').forEach(b=>b.addEventListener('click',()=>{state.phase=Number(b.dataset.courseStep);render();}));$('#cow-fraction')?.addEventListener('change',e=>{state.cowFraction=e.target.value;});$('#run-cow')?.addEventListener('click',()=>run('cow'));$('#case-select')?.addEventListener('change',e=>{stop();state.selected=Number(e.target.value);state.phase=0;render();});$('#view-raw')?.addEventListener('click',()=>{$('#raw-links').hidden=!$('#raw-links').hidden;});$('#recheck')?.addEventListener('click',()=>run('recheck'));$('#phase')?.addEventListener('input',e=>{stop();state.phase=Number(e.target.value);render();});$('#play')?.addEventListener('click',()=>{if(state.timer){stop();render();return;}state.timer=setInterval(()=>{const c=state.report.cases.filter(c=>c.suite==='baseline')[state.selected];state.phase=(state.phase+1)%c.data.samples.length;render();},1400);render();});document.querySelectorAll('[data-raw]').forEach(button=>button.addEventListener('click',()=>raw(button.dataset.raw,button.dataset.kind)));}
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#raw-dialog').showModal();}
async function raw(caseId,kind){try{const res=await fetch(url('/api/evidence',{id:state.id,case:caseId,kind}));const text=await res.text();if(!res.ok)throw new Error(text);dialog(`${caseId} · ${kind}`,`<pre>${esc(text)}</pre>`);}catch(e){error(e.message);}}
async function run(mode){stop();error('');try{state.job=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-VMObserve-Token':state.config.token},body:JSON.stringify({mode,id:state.id,group4_task:state.group4Task,cow_fraction:state.cowFraction,pattern:mode.includes('policy')?'sparse':state.tab==='thp'?[...new Set(state.report?.cases.filter(c=>c.suite==='thp' && !['allow','disable'].includes(c.parameters.process_thp)).map(c=>`${c.parameters.pattern}:${c.parameters.repeat}`))][state.selected]?.split(':')[0]||'sparse':'sparse'})});state.pendingJobId=state.job.id;jobUI();}catch(e){error(e.message);}}
function jobUI(){const job=state.job;const disabled=job?.status==='running'||!state.config?.live_available;$('#run').disabled=disabled;$('#run-course-all').hidden=!state.config?.live_available;$('#run-course-all').disabled=disabled;for(const id of ['recheck','run-cow','cow-fraction','run-course','run-policy','policy-recheck','run-layout','run-group3','run-sequence','run-group4','group4-task'])if($('#'+id))$('#'+id).disabled=disabled;$('#job').hidden=!job;if(!job)return;$('#job').innerHTML=job.status==='running'?`真实执行中 · ${esc(job.target)}${job.cow_fraction?` · COW 比例 ${esc(job.cow_fraction)}`:''} · 本页下方仍是已选历史记录，完成后会刷新。`:`最近任务 ${esc(job.id)}：${esc(labels[job.status]||job.status)}${job.new_run_ids?.includes(state.id)?' · 当前显示该任务结果':' · 当前显示其他历史记录'}<details><summary>执行日志</summary><pre>${esc(job.log||job.error?.message||'')}</pre></details>`;}
$('#runs').addEventListener('click',e=>{const button=e.target.closest('[data-run]');if(button)select(button.dataset.run);});$('#environment').addEventListener('change',history);document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  stop();
  state.tab = button.dataset.tab;
  state.selected = 0;
  state.phase = 0;
  const current = state.report?.cases.map(item => item.suite) || [];
  const matches = state.runs.filter(run => topicInRun(state.tab, run.suites || []));
  const preferred = matches.find(run => run.status === 'completed') || matches[0];
  if (state.tab !== 'evidence' && !topicInRun(state.tab, current) && preferred && preferred.id !== state.id) select(preferred.id);
  else render();
}));
if (matchMedia('(max-width: 700px)').matches) $('#history').open = false;$('#run').addEventListener('click',()=>run('complete'));$('#run-course-all').addEventListener('click',()=>run('course-all'));$('#close-dialog').addEventListener('click',()=>$('#raw-dialog').close());$('#export').addEventListener('click',()=>{if(!state.report)return;dialog('导出历史回放报告',`<p>保留真实运行来源、校验状态与证据边界；导出不会重新执行实验。</p><div class="export-links">${['html','json','csv'].map(format=>`<a download href="${url('/api/export',{id:state.id,format})}">${format.toUpperCase()} 报告</a>`).join('')}</div>`);});
try{state.config=await api('/api/config');$('#run').title=`目标：${state.config.executor}`;await refresh();await pollJob();setTimeout(pollJobLoop,1500);}catch(e){error(e.message);}

function policyHTML(){
  const cases=state.report.cases.filter(c=>c.suite==='thp' && ['allow','disable'].includes(c.parameters.process_thp));
  const findings=findingFor(cases.map(c=>c.id),['thp_process_disabled','thp_process_control','thp_not_observed','incomplete_evidence']);
  const paired=state.report.diagnosis.policy_comparisons||[];
  const canRecheck=state.report.integrity.status==='verified' && state.report.cases.some(c=>c.suite==='thp') && !state.report.original_schema;
  return `<section class="course-intro"><h2>诊断练习：为什么请求大页，仍没有大页？</h2><p>人为设置一个可解释的反例：两组都请求大页，只改变当前进程是否允许使用。全局系统策略保持不变。每组稀疏写，重复三次。</p><button id="run-policy">运行进程策略对照</button> ${canRecheck?'<button id="policy-recheck">关联当前记录再复验</button>':''}<p class="detail-copy">新运行会保存独立证据。下表是所选历史，不会把它冒充这次运行的结果。</p>${cases.length?table(['访问 / 重复','进程策略','内核 THP_enabled','大页驻留','建议调用','检查'],cases.map(c=>{const d=c.data,ct=d?.condition;return [c.parameters.pattern+' / '+c.parameters.repeat,c.parameters.process_thp==='allow'?'允许':'禁止',ct?.status_thp_enabled??'未采集',kib(d?.samples.at(-1)?.huge_kib),ct?.madvise_result===0?'成功':'未确认',c.validation?.status||'未完成'];})): '<p>本轮尚无进程策略对照，先写下预测，再运行。</p>'}${paired.map(c=>`<p>${c.pattern==='sparse'?'稀疏写':'逐页写'} · 第 ${c.repeat} 次：${c.control_valid?'配对条件满足，观测支持本次策略干预的影响':'尚不足以确认干预效果；允许组也可能没有获得大页'}。</p>`).join('')}<div class="raw-links">${cases.filter(c=>c.artifacts).map(c=>`<button data-raw="${esc(c.id)}" data-kind="smaps">${esc(c.id)} · 原始状态</button>`).join('')}</div>${findings.length?`<details><summary>展开诊断、证据与限制</summary>${diagnosisHTML(findings)}</details>`:''}</section>`;
}

function bindSequenceSteps() {
  const timeline = $('.timeline');
  timeline?.addEventListener('keydown', event => {
    const buttons = [...timeline.querySelectorAll('button')];
    const index = buttons.indexOf(event.target);
    const indexFor = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1};
    if (index < 0 || !Object.hasOwn(indexFor, event.key)) return;
    event.preventDefault();
    buttons[indexFor[event.key]]?.click();
  });
  document.querySelectorAll('[data-sequence-step]').forEach(button => button.addEventListener('click', () => {
    state.phase = Number(button.dataset.sequenceStep);
    render();
    const current = $('.timeline [aria-current="step"]');
    current?.focus({preventScroll: true});
    current?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }));
}

async function pollJob() {
  const job = await api('/api/job');
  state.job = job;
  jobUI();
  if (!job) return;
  if (job.status === 'running') state.pendingJobId = job.id;
  else if (job.id === state.pendingJobId) {
    state.pendingJobId = null;
    await refresh();
    if (job.new_run_ids?.length) {
      const record = state.runs.find(run => run.id === job.new_run_ids[0]);
      if (record && !topicInRun(state.tab, record.suites || []) && state.tab !== 'evidence') {
        const tabFor = {'course-all': 'group3', group3: 'group3', group4: 'group4', sequence: 'sequence',
          layout: 'layout', cow: 'baseline', course: 'course', policy: 'thp', recheck: 'thp', 'policy-recheck': 'thp'};
        state.tab = tabFor[job.mode] || 'evidence';
      }
      await select(job.new_run_ids[0]);
    }
  }
}

async function pollJobLoop() {
  try { await pollJob(); }
  catch (e) { error('本地服务连接中断：' + e.message); }
  finally { setTimeout(pollJobLoop, 1500); }
}

function group3Comparison(cases, repeat) {
  const group = cases.filter(item => item.parameters.repeat === repeat);
  if (state.tab === 'linkage') {
    const rows = group.map(item => {
      const d = item.data;
      const malloc = d?.symbols.find(symbol => symbol.name === 'libc_malloc');
      const owner = malloc?.mapping.pathname?.split('/').at(-1);
      return [item.suite === 'link-dynamic' ? '动态链接' : '静态链接',
        d?.interpreter ? d.interpreter_path || '有' : d ? '无' : '—',
        d?.needed.join('、') || '—', d?.condition.binary_bytes ? d.condition.binary_bytes.toLocaleString('zh-CN') + ' B' : '—',
        owner || '—'];
    });
    return `<section class="observation group-comparison"><h3>第 ${esc(repeat)} 轮链接对照</h3>
      ${table(['构建方式','ELF 解释器','动态依赖','主程序大小','malloc 所在对象'], rows)}</section>`;
  }
  if (state.tab === 'stack') {
    const rows = group.map(item => {
      const samples = item.data?.samples;
      const outcome = item.data?.outcome;
      return [item.parameters.limit_kib + ' KiB', samples?.at(-1)?.count,
        samples?.length ? kib(samples[0].size_kib) + ' → ' + kib(samples.at(-1).size_kib) : '—',
        outcome?.signal ? '信号 ' + outcome.signal : outcome ? '退出码 ' + outcome.exit_code : '—'];
    });
    return `<section class="observation group-comparison"><h3>第 ${esc(repeat)} 轮栈对照</h3>
      ${table(['软限制','最后采样深度','初始 → 末次映射大小','子进程结果'], rows)}</section>`;
  }
  return '';
}

function renderGroup3() {
  const names={'link-dynamic':'3.1 动态链接','link-static':'3.1 静态链接','sequence':'3.2 连续 malloc','demand512':'3.3 按需调页512 MiB','stack':'3.3 栈增长 / 溢出'};
  const intro='<div class="course-intro"><h2>第3组 · 从程序装入到栈溢出</h2><p>同一组源码比较静态与动态链接；在同一进程依次分配1 KiB、256 KiB、1 MiB；按原课例访问512 MiB；比较正常递归与512 / 2048 KiB栈限制。</p><button id="run-group3" class="primary">运行第3组完整实验</button><p>每项重复3次，共24个案例。下方为已选历史记录；运行后会生成新证据。开始前先预测：申请成功、首次访问和越界终止会分别发生什么？</p></div>';
  const cases = state.report.cases.filter(c => topicInRun(state.tab, [c.suite]));
  if(!cases.length){$('#content').innerHTML=intro+'<p class="empty">本轮历史没有第3组新增案例。</p>';return;}
  state.selected=Math.min(state.selected,cases.length-1);
  const c=cases[state.selected],d=c.data;
  const selector=`<label class="selector">案例：<select id="case-select">${cases.map((x,i)=>`<option value="${i}" ${i===state.selected?'selected':''}>${names[x.suite]} ${x.parameters.mode||''} ${x.parameters.limit_kib?x.parameters.limit_kib+' KiB':''} · 第${x.parameters.repeat}次 · ${x.validation.status}</option>`).join('')}</select></label>`;
  let detail='';
  if(d?.symbols) detail=table(['对象','地址','权限','映射'],d.symbols.map(x=>[x.name,'0x'+x.address,x.mapping.permissions,x.mapping.header]))+`<p>解释器：${d.interpreter?'有':'无'}；依赖：${esc(d.needed.join(', ')||'无')}</p><details><summary>ELF段与运行映射</summary><pre>${esc(JSON.stringify(d.segments,null,2))}</pre></details>`;
  if(d?.actions) detail=table(['动作','该动作内观测到的内存管理调用'],d.actions.map(x=>[x.action,x.syscalls.join('\n')||'无']))+`<details><summary>各阶段三块地址对应的映射</summary><pre>${esc(JSON.stringify(d.samples.map(s=>({phase:s.phase,program_break:s.program_break,blocks:s.blocks})),null,2))}</pre></details>`;
  if(d?.outcome) detail=`<p>限制 ${d.condition.limit_kib} KiB；终止信号 ${d.outcome.signal}（11为SIGSEGV）；退出码 ${d.outcome.exit_code}；最后采样深度 ${d.samples.at(-1).count}。</p><p>栈限制只作用于本次子进程，父进程负责保存退出证据。</p>`;
  const countLabel=c.suite==='sequence'?'已分配块数':c.suite==='stack'?'递归深度':c.suite==='demand512'?'已写入位置数':'动作计数';
  const samples=d?table(['阶段',countLabel,'区域大小','区域RSS','本步次缺页','累计次缺页'],d.samples.map(s=>[s.phase,s.count,kib(s.size_kib),kib(s.rss_kib),s.action_minor,s.total_minor])):'';
  const links=c.artifacts?Object.keys(c.artifacts).filter(k=>!k.endsWith('_stderr')).map(k=>`<button data-raw="${esc(c.id)}" data-kind="${esc(k)}">${esc(k)}</button>`).join(''):'';
  $('#content').innerHTML=intro+group3Comparison(cases,c.parameters.repeat)+`<div class="experiment"><div class="observation">${selector}<p>历史回放 · ${esc(c.validation.status)}</p>${samples}${detail}<p class="detail-copy">RSS为地址所在整个映射；缺页计数受采样、分配器和大页影响。原课例的暂停点在这里保存为自动快照。</p>${c.error?`<pre>${esc(JSON.stringify(c.error,null,2))}</pre>`:''}<div class="raw-links">${links}</div></div>${diagnosisHTML(findingFor([c.id],['group3','incomplete_evidence']))}</div>`;
}


function renderGroup4() {
  const names={'g4-fork':'4.1 fork / exec / wait','g4-pthread':'4.2 pthread','g4-uthread':'4.3 用户级线程','g4-pipe':'4.4 管道','g4-bank':'4.4 共享账户'};
  const modes={normal:'exec成功','exec-failure':'exec失败对照',unsafe:'故意无锁',mutex:'互斥保护','round-robin':'协作轮转',blocking:'阻塞影响',basic:'传递字符串',eof:'关闭全部写端',eagain:'空管道保留写端',epipe:'忽略SIGPIPE',sigpipe:'默认SIGPIPE',comparison:'无锁/互斥账户',condition:'等待存款',transfer:'顺序加锁转账'};
  const events={begin:'开始',before_exec:'exec前',after_exec:'exec后',parent_after_fork:'父进程fork返回',exec_error:'exec失败',summary:'结果',worker_start:'线程启动',worker_end:'线程结束',created:'分配用户栈',dispatch:'调度',step:'运行一步',finished:'结束返回',block_begin:'阻塞开始',block_end:'阻塞结束',sent:'发送',received:'接收',empty_with_writer:'有写端的空读',before_write:'无读端的写入',write_result:'写入结果',deposit_worker:'存款线程',counter_result:'计数结果',waiting:'等待余额',deposited:'存入并通知',withdrawn:'取款成功',transferred:'转账成功'};
  const intro=`<div class="course-intro"><h2>第4组 · 进程与线程怎样协作？</h2><p>先完成当前课堂范围。可单独运行4.1、4.2、4.3或4.4；每种配置重复3次，全部共42个案例。</p><label>本次运行范围：<select id="group4-task">${[['all','第4组全部'],['4.1','4.1 进程创建与程序替换'],['4.2','4.2 pthread线程'],['4.3','4.3 用户级线程'],['4.4','4.4 进程/线程通信']].map(([v,t])=>`<option value="${v}" ${state.group4Task===v?'selected':''}>${t}</option>`).join('')}</select></label> <button id="run-group4" class="primary">运行所选实验</button><p class="course-question">先预测：fork后地址相同就表示共享变量吗？pthread的全局变量和栈分别属于谁？</p><p class="detail-copy">下方是已选历史记录。新运行会保存源码、编译命令、进程观察和事件，完成后自动切换。</p></div>`;
  const cases=state.report.cases.filter(c=>c.suite.startsWith('g4-'));
  if(!cases.length){$('#content').innerHTML=intro+'<p class="empty">本轮历史没有第4组记录，可按当前进度选择范围并运行。</p>';return;}
  state.selected=Math.min(state.selected,cases.length-1);const c=cases[state.selected],d=c.data;
  const selector=`<label class="selector">回放案例：<select id="case-select">${cases.map((item,i)=>`<option value="${i}" ${i===state.selected?'selected':''}>${names[item.suite]} · ${modes[item.parameters.mode]} · 第${item.parameters.repeat}次</option>`).join('')}</select></label>`;
  let headers=['事件','PID','内核TID','线程编号','值 / 余额','期望值'];
  let values=r=>[events[r.event]||r.event,r.pid,r.tid,r.worker,r.value??r.balance,r.expected];
  if(c.suite==='g4-fork'){headers=['事件','PID','PPID','子进程PID','私有值','退出码 / errno'];values=r=>[events[r.event]||r.event,r.pid,r.ppid,r.child_pid,r.value,r.exit_code??r.errno];}
  if(c.suite==='g4-uthread'){headers=['事件','内核TID','用户线程','步骤','栈地址','相对时间ms'];values=r=>[events[r.event]||r.event,r.tid,r.worker,r.step,r.stack_address??r.stack_base,((r.time_ns-d.condition.time_ns)/1e6).toFixed(2)];}
  if(c.suite==='g4-pipe'){headers=['事件','PID','读/写字节','errno','信号','字符串'];values=r=>[events[r.event]||r.event,r.pid,r.read_bytes??r.write_bytes,r.errno,r.signal,r.message];}
  if(c.suite==='g4-bank'&&c.parameters.mode==='transfer'){headers=['事件','线程','来源→目标','金额','加锁顺序','来源/目标余额'];values=r=>[events[r.event]||r.event,r.worker,r.from==null?'':r.from+'→'+r.to,r.amount,r.first_lock==null?'':r.first_lock+'→'+r.second_lock,r.from_balance==null?r.value:r.from_balance+' / '+r.to_balance];}
  let addresses='';
  if(c.suite==='g4-pthread'&&d){addresses=table(['工作线程','内核TID','全局变量地址','共享堆地址','各自栈地址'],d.samples.filter(s=>s.event==='worker_start').map(s=>[s.worker,s.tid,s.address,s.heap_address,s.stack_address]));}
  const unsafe=c.parameters.mode==='unsafe'||c.parameters.mode==='comparison';
  const evidence=c.artifacts?Object.entries(c.artifacts).map(([kind])=>`<button data-raw="${esc(c.id)}" data-kind="${esc(kind)}">${kind==='kernel'?'查看ps与内核观察':'查看原始事件'}</button>`).join(''):'';
  $('#content').innerHTML=intro+`<div class="experiment"><div class="observation">${selector}<p>历史回放 · ${c.validation.status==='passed'?'采集与检查通过':esc(c.validation.status)}${unsafe?'；无锁结果作为故障观察保留':''}</p>${d?table(headers,d.samples.map(values)):''}${addresses}${d?`<details><summary>内核观察与本轮结果</summary><pre>${esc(JSON.stringify({status:d.kernel_status,result:d.summary},null,2))}</pre></details>`:''}${c.error?`<pre>${esc(JSON.stringify(c.error,null,2))}</pre>`:''}<div class="raw-links">${evidence}</div><p>课程联动：fork的私有值对应COW前置知识，pthread共享地址与用户线程独立栈对应第3组地址空间。</p></div>${diagnosisHTML(findingFor([c.id],['group4','incomplete_evidence']))}</div>`;
}
