import { $, state, labels, esc, kib, table, diagnosisHTML, findingFor, evidenceButtons } from './ui.js';

function renderLayout() {
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验 3.1 · 虚拟地址与映射</small>
    <h2>程序里的地址都在哪里？</h2>
    <p>对照《第七章 主存管理》课件第 9、12、43–49 页，先想一想：程序的函数代码和栈上的局部变量能放在同一块可写内存里吗？只读常量应该是什么权限？</p>
    <div class="sequence-controls">
      <button id="run-layout" class="primary">重新采集地址空间实验</button>
      <span class="picker-hint">会运行 3 次独立进程并保存各自的地址、装载段和 smaps</span>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => c.suite === 'layout');
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有“程序地址”实验，请点顶部“切换记录”选一条“程序地址”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], d = c.data;
  const short = name => name ? name.split('/').at(-1) : '匿名映射';
  const selector = `<label class="selector"><span>换一次实验：</span><select id="case-select">${cases.map((item, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>第 ${item.parameters.repeat} 次实验 · ${esc(labels[item.status] || item.status)}</option>`).join('')}</select></label>`;

  const addressStack = d ? `<div class="addr-stack-card">
    <span class="section-label">虚拟地址空间分布（由高地址到低地址）</span>
    <div class="addr-stack">
      ${[...d.samples].sort((a, b) => BigInt('0x' + b.address) > BigInt('0x' + a.address) ? 1 : -1).map(s => {
        const perm = s.permissions.slice(0, 3);
        const permClass = perm.includes('x') ? 'perm-x' : perm.includes('w') ? 'perm-w' : 'perm-r';
        return `<div class="addr-slot">
          <span class="perm-badge ${permClass}">${esc(s.permissions)}</span>
          <div class="addr-slot-main">
            <strong>${esc(s.symbol_label)}</strong>
            <small>${esc(short(s.pathname))}${s.elf_object ? ` · ${esc(short(s.elf_object))} #${s.elf_segment_index}` : ''}</small>
          </div>
          <code>0x${esc(s.address)}</code>
        </div>`;
      }).join('')}
    </div>
  </div>` : '';

  const points = d
    ? table(['程序对象', '虚拟地址', '权限', '所在映射', '对应 ELF 段'], d.samples.map(s => [s.symbol_label, '0x' + s.address, s.permissions, short(s.pathname), s.elf_object ? short(s.elf_object) + ' · #' + s.elf_segment_index : '堆 / 栈（运行时分配）']))
    : '<p class="empty">本次采集没有拿到完整结果，点下方按钮可查看原始记录。</p>';
  const segments = d
    ? table(['程序 / 库 · 段号', '装载基址', 'ELF 段虚拟地址', '运行起点', 'ELF 权限', '跨映射数'], d.segments.map(s => [short(s.object) + ' · #' + s.index, '0x' + s.load_bias, '0x' + s.vaddr, '0x' + s.start, s.flags, s.mappings.length]))
    : '';
  const repeats = cases.filter(item => item.data).map(item => [`第 ${item.parameters.repeat} 次`, ...['function', 'stack'].map(symbol => '0x' + item.data.samples.find(s => s.symbol === symbol).address)]);
  const findings = findingFor([c.id], ['address_mapping', 'layout_permissions', 'incomplete_evidence']);

  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">
    ${selector}
    <p class="muted">当前进程 PID ${esc(d?.condition.pid ?? '未知')} · ${c.validation.status === 'passed' ? '权限检查通过' : '权限与常见默认值不同'}</p>
    ${addressStack}
    <details class="secondary-fold"><summary>展开 7 类对象的完整对照表</summary>
      ${points}
      <div class="explanation-box"><span class="explain-tag">怎么看权限和地址</span><p>权限里 r=可读、w=可写、x=可执行，p 表示私有映射（写时复制）。表格展示的是虚拟地址；映射区间和权限告诉你能在哪里读写；有多少页已驻留，要看 RSS。</p></div>
    </details>
    <details class="secondary-fold"><summary>进一步看：程序和动态库是怎么装进地址空间的？</summary>
      <p class="detail-copy">装入后的段起点 = 装载基址 + ELF 段虚拟地址。一个 ELF 装载段（PT_LOAD）有时会横跨多条映射，装载器还可能收紧部分页面的写权限。</p>
      ${segments}
      ${d ? `<details><summary>展开各段相交的映射原文</summary><pre>${esc(d.segments.map(s => short(s.object) + ' #' + s.index + '\n' + s.mappings.join('\n')).join('\n\n'))}</pre></details>` : ''}
    </details>
    <details class="secondary-fold"><summary>${repeats.length > 1 ? `对比 ${repeats.length} 次实验的地址` : "查看这次实验的函数与栈地址"}</summary>
      ${table(['实验轮次', '函数地址', '栈变量地址'], repeats)}
      <p class="detail-copy">${repeats.length > 1 ? "逐行比较：函数和栈的地址有哪些变化？结合编译方式和地址随机化解释。" : "当前只有一份完整的地址记录。重新采集后，可比较不同进程的地址。"}</p>
    </details>
    <p class="course-question">想一想：知道了某个变量的虚拟地址和所属映射，能直接算出它占用的物理页框号吗？</p>
    ${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c)}</div>` : ''}
  </div>${diagnosisHTML(findings)}</div>`;
}

const courseSteps = [
  { title: '申请之前', code: '尚未调用 malloc', question: '程序即将拿到的地址，和内存条上的物理位置是一回事吗？', theory: 'C 程序拿到的是虚拟地址。操作系统通过页表把虚拟页映射到物理页；这一步先把“申请前”的映射存下来做基准对照。' },
  { title: '申请完成，尚未写入', code: 'memory = malloc(size)', question: '申请了这么大空间，物理内存占用（RSS）会立刻涨这么多吗？', theory: 'malloc 返回了可用的虚拟地址，但操作系统此时大多只登记了映射范围。小块申请时，分配器写管理信息会先触碰第 1 页，所以有时能看到 4 KiB 的初始驻留。' },
  { title: '写入前四分之一', code: '每隔一页写 1 字节，累计写到 1/4', question: '往刚申请的内存里第一次写数据，RSS 和缺页数会怎么变？', theory: '首次写入尚未建立物理页映射的虚拟页时，会触发一次缺页异常，内核趁此时分配物理页框并建好映射。如果是 1 KiB 小块，因为所在页之前已经驻留，这里的缺页可以是 0。' },
  { title: '写到一半', code: '继续按页写入，累计写到 1/2', question: '接着往后面的新页写，RSS 和缺页是不是同步增长？', theory: '对照上一步看：这里“本步次缺页”记录这一步新发生的缺页增量，“相关映射 RSS”记录采样时的总物理驻留。' },
  { title: '写完全部页位置', code: '按页写入剩余所有位置', question: '为什么测到的“相关映射 RSS”有时比申请的字节数还大？', theory: '因为 malloc 块可能和其他管理信息或对象共处同一段 VMA，RSS 统计的是整段映射的物理占用；而即使每页只写 1 字节，内核也是整页整页分配物理内存。' },
  { title: '释放之后', code: 'free(memory)', question: '调用 free 之后，原来那段映射一定会立刻从 smaps 里消失吗？', theory: 'free 只是把内存交还给用户态分配器。大块（mmap 分配）通常会立刻 munmap 归还内核；小块（brk 堆区）往往被分配器留在进程里给下次复用。记住释放后的指针千万不要再读写。' }
];

function renderCourse() {
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验 3.2 / 3.3 · 按需分配</small>
    <h2>申请了内存，就已经用上物理页了吗？</h2>
    <p>改编自课内 <code>lab3_2/malloc.c</code> 与 <code>lab3_3/demand.c</code>（对应第七章第 57–60 页请求调页）：用 1 KiB、256 KiB、1 MiB 和 16 MiB 单块对比，一步步看清什么时候才分配物理内存。</p>
    <div class="sequence-controls">
      <button id="run-course" class="primary">重新采集按需分配</button>
      <a class="nav-link" href="/lesson">去“动手改代码”亲手写一遍 →</a>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => c.suite === 'course').sort((a, b) => b.parameters.requested_kib - a.parameters.requested_kib || a.parameters.repeat - b.parameters.repeat);
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有按需分配实验，请点顶部“切换记录”选一条“按需分配”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  state.phase = Math.min(Math.max(0, state.phase), courseSteps.length - 1);
  const c = cases[state.selected], step = courseSteps[state.phase];
  const sample = c.data?.samples[state.phase];
  const relevantRule = state.phase <= 1 ? 'malloc_mapping' : state.phase === 5 ? 'malloc_free' : 'malloc_demand';
  const findings = findingFor([c.id], [relevantRule, 'incomplete_evidence', 'course_task_incomplete']);
  const selector = `<label class="selector"><span>选择内存大小与实验轮次：</span><select id="case-select">${cases.map((item, index) => `<option value="${index}" ${index === state.selected ? 'selected' : ''}>${kib(item.parameters.requested_kib)} · 第 ${item.parameters.repeat} 次实验</option>`).join('')}</select></label>`;

  const reqKib = c.parameters.requested_kib;
  const fillPct = sample ? Math.min(100, Math.round((sample.rss_kib / Math.max(1, reqKib)) * 100)) : 0;
  const stepTabs = courseSteps.map((st, i) => `<button data-course-step="${i}" ${i === state.phase ? 'aria-current="step"' : ''}><span>${i + 1}</span>${esc(st.title)}</button>`).join('');

  const metrics = sample ? `<div class="step-metrics-grid">
    <div><small>申请大小</small><strong>${kib(reqKib)}</strong></div>
    <div><small>已写位置 / 总位置</small><strong>${sample.written_positions} / ${c.data.condition.positions}</strong></div>
    <div><small>物理驻留 RSS</small><strong class="kpi-accent">${kib(sample.rss_kib)}</strong></div>
    <div><small>本步次缺页</small><strong>${sample.action_minor} 次</strong></div>
    <div><small>原地址映射</small><strong>${sample.mapping_present ? '存在' : '已消失'}</strong></div>
    <div><small>返回地址</small><strong><code>${sample.address === '0' ? '尚未申请' : `0x${esc(sample.address)}`}</code></strong></div>
  </div>
  <div class="residency-meter">
    <div class="residency-head"><span>当前物理页驻留比例（相对申请大小）</span><strong>${kib(sample.rss_kib)} / ${kib(reqKib)}（${fillPct}%）</strong></div>
    <div class="vma-meter-bar large"><span style="width:${fillPct}%"></span></div>
  </div>` : '<p class="empty">本实验数据不完整，请点下方按钮查看原始日志。</p>';

  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">
    ${selector}
    <div class="stepper-bar">
      <nav class="step-strip">${stepTabs}</nav>
      <div class="step-arrows">
        <button data-course-step="${state.phase - 1}" ${state.phase === 0 ? 'disabled' : ''}>← 上一步</button>
        <button class="primary" data-course-step="${state.phase + 1}" ${state.phase === 5 ? 'disabled' : ''}>下一步 →</button>
      </div>
    </div>
    <div class="step-evidence">
      <div class="step-evidence-head">
        <span class="step-badge">第 ${state.phase + 1} / 6 步</span>
        <h3>${esc(step.title)}</h3>
      </div>
      <p><code>${esc(step.code)}</code></p>
      <p class="course-question">${esc(step.question)}</p>
      ${metrics}
      <div class="explanation-box"><span class="explain-tag">原理解释</span><p>${esc(step.theory)}</p></div>
    </div>
    <details class="secondary-fold"><summary>展开六个阶段汇总表（当前高亮第 ${state.phase + 1} 步）</summary>${c.data ? table(['阶段', '已写位置', '物理驻留 RSS', '本步次缺页'], c.data.samples.map((s, i) => [courseSteps[i].title, s.written_positions, kib(s.rss_kib), s.action_minor]), state.phase) : ''}</details>
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c, { phase: sample?.phase, stepLabel: step.title })}</div>` : ''}
  </div>${diagnosisHTML(findings)}</div>`;
}

function renderGroup3() {
  const suites = ['link-dynamic', 'link-static', 'sequence', 'demand512', 'stack'];
  const names = { 'link-dynamic': '3.1 动态链接', 'link-static': '3.1 静态链接', sequence: '3.2 连续 malloc', demand512: '3.3 按需调页 512 MiB', stack: '3.3 栈增长 / 溢出' };
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验第 3 组 · 链接、调页与栈</small>
    <h2>从程序装入到栈溢出</h2>
    <p>对比同一段代码在静态/动态链接下的映射差异；在同进程里连续申请三块内存；按原课例分批写入 512 MiB；以及观察递归深度超过栈限制时的段错误（SIGSEGV）。</p>
    <div class="sequence-controls">
      <button id="run-group3" class="primary">重新采集第 3 组实验</button>
      <span class="picker-hint">每项重复 3 次，共 24 组数据</span>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => suites.includes(c.suite));
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有第 3 组实验，请点顶部“切换记录”选一条“链接与栈”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], d = c.data;
  const selector = `<label class="selector"><span>选择要看的实验：</span><select id="case-select">${cases.map((x, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${names[x.suite]} ${x.parameters.mode || ''} ${x.parameters.limit_kib ? x.parameters.limit_kib + ' KiB' : ''} · 第 ${x.parameters.repeat} 次</option>`).join('')}</select></label>`;
  let detail = '';
  if (d?.symbols) detail = table(['对象', '虚拟地址', '权限', '所在映射'], d.symbols.map(x => [x.name, '0x' + x.address, x.mapping.permissions, x.mapping.header])) + `<p class="detail-copy">动态链接器（解释器）：${d.interpreter ? '有' : '无（静态链接）'} · 依赖共享库：${esc(d.needed.join(', ') || '无')}</p><details class="secondary-fold"><summary>展开 ELF 段与运行映射详情</summary><pre>${esc(JSON.stringify(d.segments, null, 2))}</pre></details>`;
  if (d?.actions) detail = table(['动作', '这一步捕获的系统调用'], d.actions.map(x => [x.action, x.syscalls.join('\n') || '无新增系统调用'])) + `<details class="secondary-fold"><summary>展开各阶段三块地址与映射详情</summary><pre>${esc(JSON.stringify(d.samples.map(s => ({ phase: s.phase, program_break: s.program_break, blocks: s.blocks })), null, 2))}</pre></details>`;
  if (d?.outcome) detail = `<div class="explanation-box"><span class="explain-tag">栈增长结果</span><p>本次栈空间上限设为 ${d.condition.limit_kib} KiB；子进程最终终止信号为 ${d.outcome.signal}${d.outcome.signal === 11 ? '（SIGSEGV 段错误，说明栈溢出触发了越界保护）' : '（正常返回退出）'}，退出码 ${d.outcome.exit_code}，最后一次采到的递归深度是 ${d.samples.at(-1).count}。</p></div>`;
  const countLabel = c.suite === 'sequence' ? '已分配块数' : c.suite === 'stack' ? '递归深度' : c.suite === 'demand512' ? '已写入位置数' : '动作计数';
  const samples = d ? table(['阶段', countLabel, '映射大小', '物理驻留 RSS', '本步次缺页', '累计次缺页'], d.samples.map(s => [s.phase, s.count, kib(c.suite === 'sequence' ? s.related_size_kib : s.size_kib), kib(c.suite === 'sequence' ? s.related_rss_kib : s.rss_kib), s.action_minor, s.total_minor])) : '';

  $('#content').innerHTML = intro + `<div class="experiment"><div class="observation">
    ${selector}
    <p class="muted">检查状态：${c.validation.status === 'passed' ? '全部核对通过' : esc(c.validation.status)}</p>
    ${samples}${detail}
    <p class="detail-copy">上表的 RSS 统计相关映射。要核对指导书第 12 页的整进程统计，打开<a href="/lesson#original-demand">原版 512 MiB 实验的五次 ps 输出</a>。</p>
    ${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c)}</div>` : ''}
  </div>${diagnosisHTML(findingFor([c.id], ['group3', 'incomplete_evidence']))}</div>`;
}

function renderGroup4() {
  const names = { 'g4-fork': '4.1 fork / exec / wait', 'g4-pthread': '4.2 pthread 多线程', 'g4-uthread': '4.3 用户级线程', 'g4-pipe': '4.4 匿名管道', 'g4-bank': '4.4 共享账户同步' };
  const modes = { normal: 'exec 成功', 'exec-failure': 'exec 失败对照', unsafe: '故意无锁（观察并发冲突）', mutex: '互斥锁保护', 'round-robin': '协作轮转', blocking: '阻塞调用影响', basic: '传递字符串', eof: '关闭全部写端', eagain: '空管道保留写端', epipe: '忽略 SIGPIPE', sigpipe: '默认 SIGPIPE 终止', comparison: '无锁与互斥对照', condition: '条件变量等待存款', transfer: '按账户顺序加锁防死锁' };
  const events = { begin: '开始', before_exec: 'exec 前', after_exec: 'exec 后', parent_after_fork: '父进程 fork 返回', exec_error: 'exec 失败', summary: '结果', worker_start: '线程启动', worker_end: '线程结束', created: '分配用户栈', dispatch: '调度切换', step: '运行一步', finished: '结束返回', block_begin: '阻塞开始', block_end: '阻塞结束', sent: '发送', received: '接收', empty_with_writer: '有写端的空读', before_write: '无读端的写入', write_result: '写入结果', deposit_worker: '存款线程', counter_result: '计数结果', waiting: '等待余额', deposited: '存入并唤醒', withdrawn: '取款成功', transferred: '转账成功' };
  const intro = `<div class="course-intro">
    <small class="question-kicker">实验第 4 组 · 进程与线程</small>
    <h2>进程与线程怎样隔离和协作？</h2>
    <p>先猜一猜：<code>fork</code> 之后父子进程打印出一样的变量地址，代表它们真的共享同一份物理内存吗？<code>pthread</code> 线程之间，全局变量和局部变量栈各自属于谁？</p>
    <div class="sequence-controls">
      <label>运行范围：<select id="group4-task">${[['all', '第 4 组全部'], ['4.1', '4.1 进程创建与替换'], ['4.2', '4.2 pthread 线程'], ['4.3', '4.3 用户级线程'], ['4.4', '4.4 管道与同步']].map(([v, t]) => `<option value="${v}" ${state.group4Task === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <button id="run-group4" class="primary">运行所选实验</button>
    </div>
  </div>`;
  const cases = state.report.cases.filter(c => c.suite.startsWith('g4-'));
  if (!cases.length) {
    $('#content').innerHTML = intro + '<p class="empty">当前记录里没有第 4 组实验，请点顶部“切换记录”选一条“进程与线程”记录或点击上方按钮采集。</p>';
    return;
  }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], d = c.data;
  const selector = `<label class="selector"><span>选择实验项目：</span><select id="case-select">${cases.map((item, i) => `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${names[item.suite]} · ${modes[item.parameters.mode]} · 第 ${item.parameters.repeat} 次</option>`).join('')}</select></label>`;

  let headers = ['事件', 'PID', '内核 TID', '线程编号', '值 / 余额', '期望值'];
  let values = r => [events[r.event] || r.event, r.pid, r.tid, r.worker, r.value ?? r.balance, r.expected];
  if (c.suite === 'g4-fork') {
    headers = ['事件', 'PID', 'PPID', '子进程 PID', '私有变量值', '退出码 / errno'];
    values = r => [events[r.event] || r.event, r.pid, r.ppid, r.child_pid, r.value, r.exit_code ?? r.errno];
  } else if (c.suite === 'g4-uthread') {
    headers = ['事件', '内核 TID', '用户线程', '步骤', '栈地址', '相对时间 (ms)'];
    values = r => [events[r.event] || r.event, r.tid, r.worker, r.step, r.stack_address ?? r.stack_base, ((r.time_ns - d.condition.time_ns) / 1e6).toFixed(2)];
  } else if (c.suite === 'g4-pipe') {
    headers = ['事件', 'PID', '读 / 写字节', 'errno', '信号', '传递文本'];
    values = r => [events[r.event] || r.event, r.pid, r.read_bytes ?? r.write_bytes, r.errno, r.signal, r.message];
  } else if (c.suite === 'g4-bank' && c.parameters.mode === 'transfer') {
    headers = ['事件', '线程', '来源 → 目标', '金额', '加锁顺序', '转后双方余额'];
    values = r => [events[r.event] || r.event, r.worker, r.from == null ? '' : r.from + '→' + r.to, r.amount, r.first_lock == null ? '' : r.first_lock + '→' + r.second_lock, r.from_balance == null ? r.value : r.from_balance + ' / ' + r.to_balance];
  }

  let addresses = '';
  if (c.suite === 'g4-pthread' && d) {
    addresses = table(['工作线程', '内核 TID', '全局变量地址（共享）', '共享堆地址', '各自栈地址（独立）'], d.samples.filter(s => s.event === 'worker_start').map(s => [s.worker, s.tid, s.address, s.heap_address, s.stack_address]));
  }
  const unsafe = c.parameters.mode === 'unsafe' || c.parameters.mode === 'comparison';

  $('#content').innerHTML = intro + `<div class="experiment process-events"><div class="observation">
    ${selector}
    <p class="muted">${c.validation.status === 'passed' ? '数据检查通过' : esc(c.validation.status)}${unsafe ? ' · 本组刻意未加锁，用来对照观察数据竞争算错的结果' : ''}</p>
    ${d ? table(headers, d.samples.map(values)) : ''}${addresses}
    ${d ? `<details class="secondary-fold"><summary>展开内核进程状态与汇总 JSON</summary><pre>${esc(JSON.stringify({ status: d.kernel_status, result: d.summary }, null, 2))}</pre></details>` : ''}
    ${c.error ? `<pre>${esc(JSON.stringify(c.error, null, 2))}</pre>` : ''}
    ${c.artifacts ? `<div class="raw-links">${evidenceButtons(c)}</div>` : ''}
    <div class="explanation-box"><span class="explain-tag">串联前后知识</span><p>fork 后父子各自改写私有变量互不干扰，这验证了父子进程的私有数据相互独立；要观察何时复制页面，再看“写时复制”的 PSS 对照；pthread 共享全局和堆地址、只保留各自独立的栈，可以切到“程序地址”页对照看。</p></div>
  </div>${diagnosisHTML(findingFor([c.id], ['group4', 'incomplete_evidence']))}</div>`;
}

export { renderLayout, renderGroup3, renderGroup4, renderCourse };
