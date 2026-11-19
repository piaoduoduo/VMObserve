import { $, state, api, esc, url, table, evidenceButtons, friendlyDistro, friendlyTime, labels, loadOriginalPs } from './ui.js';

const groups = ['实验环境与工具', '系统调用与容器', '内存管理', '进程与线程', '同步与互斥', '文件系统', '设备与 I/O'];
// In the order of the current 27-page course guide. Page ranges refer to its PDF.
const labs = [
  ['1.1', '使用 openEuler', '1–3', '在普通用户的终端运行 id、uname -r 和 cat /etc/os-release，再创建一个文件，用 ls -l 看它的所有者和权限。', '哪一项告诉你发行版，哪一项告诉你当前使用的内核？'],
  ['1.2', '用 GCC 编译程序', '3–4', '把 hello.c 依次预处理、编译、汇编、链接，比较 hello.o 和最终程序的 file 输出，再运行程序。', '目标文件和可执行文件都是 ELF，为什么只有后者可以直接运行？'],
  ['1.3', '用 Git 提交与应用补丁', '4–6', '在练习分支提交一处改动，用 format-patch 导出，再从相同的起点应用补丁。', '比较原提交、git apply 和 git am 得到的文件树。你用什么判断内容相同？'],
  ['2.1', '用 strace 跟踪系统调用', '6–7', '跟踪 /bin/echo hello，找到装入程序、打开动态库、向标准输出写入这三步。', '哪一行把 hello 写到屏幕？指出它的文件描述符和返回值。'],
  ['2.2', '观察异常与信号', '7–8', '分别运行课程里的除零和无效指针程序，再用 strace 对照它们的终止信号。', '比较两段程序的实际信号。哪些来自算术异常，哪些来自无效地址？'],
  ['2.3', '在 iSulad 容器中运行程序', '8–9', '构建课程镜像，运行 hello，在容器内外查同一进程的 PID、命名空间和内核版本。', '哪些值在容器内外相同？用两行输出解释隔离发生在哪里。'],
  ['3.1', '程序地址、装入与链接', '9–10', '找到代码、全局变量、堆和栈的地址，再比较动态链接与静态链接程序的映射。', '选一个地址，用 maps 找到它所在的区间和权限。'],
  ['3.2', '连续三次 malloc', '10–11', '在同一进程依次申请 1 KiB、256 KiB、1 MiB。每次暂停后对照指针、映射和系统调用，再看释放后的变化。', '找出三块内存所在的地址范围。如果两块落在同一段映射里，驻留量应该怎样相加？'],
  ['3.3', '按需调页与栈增长', '11–12', '先申请 512 MiB，再分批触碰页面。另用递归程序改变栈限制，比较正常返回和溢出时的退出状态。', '第一次访问后程序能继续执行，栈越界后却会终止。各找一条证据解释。'],
  ['4.1', '创建、替换与回收进程', '12–13', '跟着 fork、exec、wait 读父子进程事件，再比较 exec 成功与执行文件找不到的情况。', '哪个 PID 执行了新程序？父进程怎样获知子进程的退出结果？'],
  ['4.2', 'pthread 与共享变量', '13–14', '记录两个线程的 PID、TID、栈与共享变量地址，比较无锁计数和互斥锁保护的结果。', '给出一个共享的地址和一对不同的地址，解释它们各属于哪里。'],
  ['4.3', '用户级线程切换', '14–15', '跟踪用户线程的创建、主动让出与退出，再观察一次阻塞调用如何影响调度。', '执行上下文在变，内核看到的 TID 是否也变了？'],
  ['4.4', '管道与线程通信', '15–16', '观察管道读写、关闭端点、共享账户和条件等待。分别记录数据由谁发出、由谁读取。', '读到 EOF 和暂时没有数据有什么区别？用端点状态解释。'],
  ['5.1', '生产者与消费者', '16–17', '用 empty 和 full 两个信号量交接一个槽位，让生产者依次放入 32 个数，消费者逐个核对。课内可再删去一处等待作对照。', '仅保护同一时刻只能有一个线程进临界区，为什么还不能避免覆盖未读数据？'],
  ['5.2', '死锁与加锁顺序', '17–18', '先让两个线程各持一把锁，同时试取对方的锁并记录返回值。再让它们按同一顺序阻塞加锁，数一数有几个线程完成。', '画出第一轮的两条等待关系。改成同序加锁后，哪条关系无法形成？'],
  ['5.3', '用原子标志发布数据', '18–19', '写端先写数据再用 release 发布标志，读端用 acquire 看到标志后读取数据。与课程 naive.c 中的普通共享标志对照阅读。', '为什么只看到一次正确输出，还无法判断普通共享变量的写法正确？'],
  ['6.1', '读写文件与文件偏移', '19–20', '对同一文件顺序写、定位覆盖、用追加模式写。随后用 dup 和两次独立 open 对照文件偏移。', '从复制的描述符读一字节，原描述符和重新打开的描述符各停在哪里？'],
  ['6.2', '权限、inode 与链接', '20–21', '给一个文件建立硬链接和符号链接，对照 inode 与权限；删除原路径，再分别读取。', '哪条路径还能读到原内容？用 inode 和链接目标解释。'],
  ['6.3', '挂载、VFS 与伪文件系统', '21–22', '从 mountinfo 找出根目录、/proc、/sys 和共享内存的文件系统类型，再分别读一个内核属性。', '同样用 read，为什么读取 /proc 中的内核版本无需磁盘上存在一份版本文件？'],
  ['7.1', '读写字符设备', '22–23', '查看四个字符设备的主次设备号，分别请求读 8 字节，并向 /dev/null 写 4 字节。', 'zero、null 和随机设备各返回了多少？区分“读到零字节”和“读到值为零的字节”。'],
  ['7.2', 'FIFO、非阻塞与 select', '23–24', '创建 FIFO，分别在没有写端、写端存在但无数据、写入 A、写端关闭时读取。对照写入前后的 select 就绪数。', '为什么同是空管道，有时 read 返回 0，有时报告 EAGAIN？'],
  ['7.3', '块设备与网络接口', '24–25', '用 lsblk 读设备与挂载点，从 sysfs 读网络接口与回环接口的收发计数。', '选一个磁盘分区和一个网卡，分别指出你从哪里读到了它们的状态。'],
  ['7.4', '加载与卸载内核模块', '25–26', '按学生包 lab7/lab7_4 读模块的初始化、退出函数和 Makefile。有配套内核开发包时，在课程虚拟机编译模块，对照加载前后与卸载后的模块列表和内核日志。', '哪条日志对应初始化，哪条对应退出？请记录运行内核与编译目标。'],
  ['7.5', '用 eBPF 观察 openat', '26–27', '按指导书准备 eBPF 工具链，把程序挂到 openat 跟踪点，再让指定进程打开一个已知文件，保存事件输出。', '用进程号和文件路径把一次 openat 事件对应到你的操作。']
];

const byId = Object.fromEntries(labs.map(row => [row[0], row]));
const extensions = [
  { topic: 'baseline', code: 'COW', label: '写时复制', href: '/#topic=baseline', actionText: '进入 8 步对照',
    desc: '同一批物理页在 fork 后由父子进程共享。对照子进程改写前后的快照，看哪些页另拷了一份、为什么 PSS 才反映实际占用。' },
  { topic: 'thp', code: 'THP', label: '透明大页', href: '/#topic=thp', actionText: '进入 4 步对照',
    desc: '在相同位置只写 1 个字节，一组关闭透明大页，一组请求使用。对照两组的 RSS 与 AnonHugePages（透明大页占用的内存），看页面大小怎样影响占用。' }
];
const replayTasks = {
  '3.1': [['打开 7 类程序地址分布图', 'layout', 'layout'], ['动态链接映射', 'group3', 'link-dynamic'], ['静态链接映射', 'group3', 'link-static']],
  '3.2': [['回放三次申请', 'sequence', 'sequence']],
  '3.3': [['512 MiB 分批触碰', 'group3', 'demand512'], ['栈增长与溢出', 'group3', 'stack'], ['按需分配逐步对照', 'course', 'course']],
  '4.1': [['打开父子进程事件回放', 'group4', 'g4-fork']],
  '4.2': [['打开线程与共享变量回放', 'group4', 'g4-pthread']],
  '4.3': [['打开用户级线程调度回放', 'group4', 'g4-uthread']],
  '4.4': [['打开管道读写端回放', 'group4', 'g4-pipe'], ['打开共享账户与条件等待', 'group4', 'g4-bank']]
};

export function directory(active) {
  const rail = $('.course-rail');
  rail.insertAdjacentHTML('afterbegin', `<a class="rail-brand" href="/">
      <svg aria-hidden="true" viewBox="0 0 32 32"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="11" height="11" rx="2"/><rect x="18" y="3" width="11" height="11" rx="2"/><rect x="3" y="18" width="11" height="11" rx="2"/><rect x="18" y="18" width="11" height="11" rx="2"/></g></svg>
      <div>
        <strong>VMObserve</strong>
        <span>重点任务可视化实验台</span>
      </div>
    </a>

    <button class="mobile-menu" id="toggle-directory" aria-controls="rail-navigation" aria-expanded="false">实验台目录</button>
    <nav class="rail-nav" id="rail-navigation" aria-labelledby="rail-directory-title">
      <div class="rail-directory-head">
        <h2 id="rail-directory-title">实验台目录</h2>
        <select id="mobile-directory" aria-labelledby="rail-directory-title"></select>
      </div>
      <a class="rail-link rail-home" data-nav="home" href="/">实验台首页</a>
      <div class="rail-group">
        <a class="rail-group-title" data-lab="focus" href="/labs/focus">重点任务目录</a>
        <div id="course-directory"></div>
      </div>
      <div class="rail-group">
        <a class="rail-group-title" data-lab="extensions" href="/labs/extensions">拓展实验</a>
        <div id="extension-directory"></div>
      </div>
      <a class="rail-link" data-topic="evidence" href="/#topic=evidence">原始证据</a>
      <details class="rail-more full-directory rail-isolated">
        <summary>完整课程目录</summary>
        <div id="full-directory"></div>
      </details>
    </nav>`);
  const menu = $('#toggle-directory');
  const setMenu = open => {
    menu.setAttribute('aria-expanded', String(open));
    rail.classList.toggle('menu-open', open);
  };
  menu.onclick = () => setMenu(menu.getAttribute('aria-expanded') === 'false');
  $('#rail-navigation').addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  const select = $('#mobile-directory');
  select.innerHTML = '<option value="">实验台首页</option>';
  const focusIds = ['3.2', '3.3'];
  const replayPaths = {'3.2': '/labs/3.2?replay=sequence', '3.3': '/labs/3.3?replay=demand512'};
  $('#course-directory').innerHTML = focusIds.map(id =>
    `<a class="rail-link" href="${replayPaths[id]}" data-lab="${id}"><em>${id}</em>${byId[id][1]}</a>`).join('');
  select.insertAdjacentHTML('beforeend', `<optgroup label="重点任务"><option value="focus">重点任务目录</option>${focusIds.map(id =>
    `<option value="${id}">${id} ${byId[id][1]}</option>`).join('')}</optgroup>`);
  $('#extension-directory').innerHTML = extensions.map(item =>
    `<a class="rail-link" href="${esc(item.href)}" data-topic="${item.topic}"><em>${item.code}</em>${item.label}</a>`).join('');
  select.insertAdjacentHTML('beforeend', `<optgroup label="拓展实验"><option value="extensions">拓展实验目录</option>${extensions.map(item =>
    `<option value="${item.topic}">${item.code} ${item.label}</option>`).join('')}</optgroup>`);
  $('#full-directory').replaceChildren();
  groups.forEach((name, i) => {
    const chapter = labs.filter(([id]) => Number(id[0]) === i + 1);
    $('#full-directory').insertAdjacentHTML('beforeend', `<details class="chapter-menu">
      <summary>第 ${i + 1} 组 · ${esc(name)}</summary>
      ${chapter.map(([id, title]) => `<a class="rail-link" data-lab="${id}" href="/labs/${id}"><em>${id}</em>${esc(title)}</a>`).join('')}
    </details>`);
    const items = chapter.filter(([id]) => !focusIds.includes(id));
    select.insertAdjacentHTML('beforeend', `<optgroup label="${name}">${items.map(([id, title]) =>
      `<option value="${id}">${id} ${title}</option>`).join('')}</optgroup>`);
  });
  select.insertAdjacentHTML('beforeend', '<option value="evidence">原始证据</option><option value="lesson">3.3 思考与笔记</option>');
  select.onchange = () => {
    setMenu(false);
    if (select.value === 'evidence') { location.assign('/#topic=evidence'); return; }
    if (select.value === 'lesson') { location.assign('/lesson'); return; }
    if (select.value) location.assign(replayPaths[select.value] || extensions.find(item => item.topic === select.value)?.href || '/labs/' + select.value);
    else location.assign('/');
  };
  markLab(active);
}

export function markLab(id, topic) {
  document.querySelectorAll('.rail-nav [aria-current]').forEach(a => a.removeAttribute('aria-current'));
  let link = null;
  if (id === 'home') {
    link = document.querySelector('[data-nav="home"]');
  } else if (id) {
    link = [...document.querySelectorAll('[data-lab]')].find(a => a.dataset.lab === id);
  } else if (topic) {
    link = [...document.querySelectorAll('[data-topic]')].find(a => a.dataset.topic === topic);
  }
  if (link) {
    link.setAttribute('aria-current', 'page');
    let chapter = link.closest('details');
    while (chapter) {
      chapter.open = true;
      chapter = chapter.parentElement.closest('details');
    }
  }
  $('#mobile-directory').value = id && id !== 'home' ? id : topic === 'evidence' ? topic : extensions.find(item => item.topic === topic)?.topic || '';
}

const group3Keys = ['link-dynamic', 'link-static', 'sequence', 'demand512', 'stack'];
export function viewCases(items, topic, suiteOf) {
  return items.filter(item => {
    const suite = suiteOf(item);
    if (topic === 'group3') return group3Keys.includes(suite);
    if (topic === 'group4') return suite.startsWith('g4-');
    if (topic === 'systems') return suite === 'sync' || suite === 'io';
    return suite === topic;
  });
}

export function currentLab(topic, report, index) {
  const c = viewCases(report.cases, topic, x => x.suite)[index];
  if (!c) return null;
  if (topic === 'systems') return c.parameters.lab;
  for (const [id, entries] of Object.entries(replayTasks)) {
    if (entries.some(([, tab, suite]) => tab === topic && c.suite === suite)) return id;
  }
  return c.suite === 'sequence' ? '3.2' : null;
}

export function newestReplay(id, topic, suite, preferredId) {
  const runs = (state.runs || []).filter(r => r.data_origin === 'real_execution' && !r.environment_issue &&
    r.status === 'completed' && r.case_keys.some(([s, lab]) => s === suite && (topic !== 'systems' || lab === id)));
  runs.sort((a, b) => b.run_id.localeCompare(a.run_id) || Number(a.group === 'example') - Number(b.group === 'example'));
  const run = runs.find(r => r.id === preferredId) || runs[0];
  if (!run) return null;
  const index = viewCases(run.case_keys, topic, x => x[0]).findIndex(([s, lab]) => s === suite && (topic !== 'systems' || lab === id));
  return { run, href: '/#' + new URLSearchParams({ run: run.id, topic, case: index }) };
}

const displayValue = value => Array.isArray(value) ? value.join(' · ') : String(value);

export function renderSystems() {
  const cases = viewCases(state.report.cases, 'systems', c => c.suite);
  if (!cases.length) { $('#content').textContent = '这份记录没有同步、文件或设备实验。'; return; }
  state.selected = Math.min(state.selected, cases.length - 1);
  const c = cases[state.selected], id = c.parameters.lab;
  $('#content').innerHTML = `<div class="course-intro"><small class="question-kicker">实验 ${esc(id)} · 历史回放</small>
    <h2>${esc(byId[id]?.[1] || id)}</h2><p>${esc(byId[id]?.[3])}</p>
    <a class="nav-link" href="/labs/${esc(id)}">← 返回课程任务与复验入口</a></div>
    <div class="observation">
      <label class="selector">选择实验<select id="case-select">${cases.map((item, i) =>
         `<option value="${i}" ${i === state.selected ? 'selected' : ''}>${esc(item.parameters.lab)} ${esc(byId[item.parameters.lab]?.[1])} · 第 ${item.parameters.repeat} 次</option>`).join('')}</select></label>
      <p class="muted">${c.validation.status === 'passed' ? '本次观测核对通过' : esc(c.error?.message || c.validation.status)}</p>
      ${table(['做了什么', '实际读到的结果'], (c.data?.samples || []).map(s => [s.phase, displayValue(s.observed)]))}
      <div class="raw-links">${evidenceButtons(c)}</div>
    </div>`;
}

export function renderHome() {
  document.body.classList.add('course-reading');
  document.title = '重点任务可视化实验台 · VMObserve';
  markLab('home');

  $('#content').innerHTML = `<article class="workbench-overview">
      <header class="focus-intro"><small class="question-kicker">华中科技大学 · 操作系统课程实践</small>
        <h1>重点任务可视化实验台</h1>
        <p>调用 <code>malloc</code> 申请一块内存、再往里写数据时，Linux 在后台到底做了什么？这里把真实运行抓下来的记录按步骤拆开，带你看清每一步的来龙去脉。</p>
      </header>
      <a class="btn-link primary" href="/labs/3.2?replay=sequence">开始 3.2 · 连续三次 malloc →</a>
      <section class="overview-guide"><h2>怎么看懂一次实验</h2>
        <dl><div><dt>看程序做了什么</dt><dd>从实验台目录选一个实验，点顶上的步骤按钮，停在某一次申请、写入或释放后。</dd></div>
        <div><dt>看 Linux 做了什么</dt><dd>对照这一步前后的变化：虚拟内存映射有没有新增或合并、真正占用的物理内存（RSS）涨了多少、又触发了几次缺页。</dd></div>
        <div><dt>拿原始记录核对</dt><dd>想找实据写进实验报告，直接点旁边的记录按钮，就能定位到对应的 <code>/proc/self/smaps</code> 快照行，或 <code>strace</code> 抓到的系统调用。</dd></div></dl>
      </section>
      <p class="overview-foot">这里优先做透最容易混淆的虚拟内存实验；如果想按章节复习进程、同步或文件与设备，打开「完整课程目录」即可。页面里的数字全来自真实的系统运行记录，随时可以反复回放，也可以在环境就绪后重新采集并导出报告。</p>
    </article>`;
}

export function renderTaskDirectory(id) {
  const focus = id === 'focus';
  const title = focus ? '重点任务目录' : '拓展实验';
  document.body.classList.add('course-reading');
  document.title = title + ' · VMObserve';
  markLab(id);
  const focusTasks = [
    {
      label: '实验 3.2 · 连续三次 malloc',
      desc: '连续调用 <code>malloc</code> 申请 <code>1 KiB</code>、<code>256 KiB</code> 和 <code>1 MiB</code>，对照三个返回指针与内核记录，看清为什么三块只占两段映射。',
      href: '/labs/3.2?replay=sequence',
      actionText: '进入 6 步回放'
    },
    {
      label: '实验 3.3 · 按需调页与栈增长',
      desc: '先申请 <code>512 MiB</code> 暂不写入，再分批触碰内存页——对比虚拟映射大小、已驻留物理内存（RSS）与缺页次数各自何时增长，另看栈溢出如何触发 <code>SIGSEGV</code>。',
      href: '/labs/3.3?replay=demand512',
      actionText: '进入 6 步回放'
    }
  ];
  $('#content').innerHTML = `
    <header class="focus-intro">
      <small class="question-kicker">华中科技大学 · 操作系统实验</small>
      <h1>${title}</h1>
      <p>${focus ? '跟着真实运行的 C 程序，看清内存从调用 <code>malloc</code> 申请到第一次写入时，Linux 到底做了什么。' : '继续看 Linux 怎样管理物理页：两个进程什么时候共享同一份内存？同样的写法换成大页后占用差多少？'}</p>
    </header>
    <section class="focus-rows" aria-label="${title}">
      ${(focus ? focusTasks : extensions).map(item => `
        <article class="focus-row">
          <div class="focus-row-head">${item.code ? item.code + ' · ' : ''}${item.label}</div>
          <p class="focus-row-desc">${item.desc}</p>
          <a class="focus-row-action" aria-label="${esc(item.actionText || '进入回放')} · ${esc(item.label)}" href="${esc(item.href)}">${esc(item.actionText || '进入回放')}</a>
        </article>
      `).join('')}
    </section>`;
}

export async function showLab(id, preferredId) {
  document.body.classList.add('course-reading');
  const row = byId[id];
  if (!row) { $('#content').innerHTML = '<h1>没有这个实验编号</h1><a href="/">回到实验台首页</a>'; return; }
  const [, title, pages, task, question] = row;
  document.title = id + ' ' + title + ' · VMObserve';
  const basic = Number(id[0]) < 3;
  const systems = Number(id[0]) >= 5 && !['7.4', '7.5'].includes(id);
  const options = systems ? [['打开完整交互记录与原始文件', 'systems', id.startsWith('5.') ? 'sync' : 'io']] : replayTasks[id] || [];
  const replays = options.map(([label, topic, suite]) => ({ label, ...newestReplay(id, topic, suite, preferredId) })).filter(x => x.run);
  const pos = labs.indexOf(row);
  const neighbour = (n, label) => n ? `<a class="nav-link" href="/labs/${n[0]}">${label} · ${n[0]} ${n[1]}</a>` : '';
  const runMode = systems ? 'lab-' + id : id.startsWith('4.') ? 'group4' : ({ '3.1': 'group3', '3.2': 'sequence', '3.3': 'group3' })[id];

  const focus = id === '3.2' || id === '3.3';
  const replayButtons = replays.map((x, idx) =>
    `<a class="btn-link${idx === 0 ? ' primary' : ''}" href="${esc(x.href)}${id === '3.2' ? '&amp;step=0' : ''}">${esc(x.label)} →</a>`
  );

  $('#content').innerHTML = `<div class="course-intro">
    <div class="lab-breadcrumb"><a href="/">实验台首页</a><span>/</span><span>实验${'一二三四五六七'[Number(id[0]) - 1]}</span><span>/</span><strong>${id}</strong></div>
    <small class="question-kicker">实验 ${id} · 指导书第 ${pages} 页</small>
    <h1>${title}</h1>
    <p>${task}</p>
  </div>
  <section class="observation lab-observation">
    <h2>${basic ? '历史实测摘录' : focus && replays.length ? '从这里开始' : replays.length ? '实验观测与交互回放' : '实验任务'}</h2>
    <div id="lab-evidence"><p class="muted">${replays.length ? `正在读取 ${esc(friendlyDistro(replays[0].run.distribution))} 的实验回放信息…` : '正在载入本项实验记录…'}</p></div>
    <div class="lab-actions" id="stack">${replayButtons.join('')}</div>
    ${id === '3.3' && location.hash === '#stack' ? `<p class="phase-note">当前定位到「栈增长与溢出」对照：请点击上方<strong>栈增长与溢出</strong>按钮查看不同栈限额下的正常返回与 <code>SIGSEGV</code>（段错误）终止。</p>` : ''}
    ${id === '3.3' ? `<details class="secondary-fold" id="original-demand"><summary>对照指导书 3.3：原版 512 MiB 程序的五次 ps 记录</summary><div id="lab-original-ps"><p class="muted">正在载入五次 ps 原始输出…</p></div></details>` : ''}
    <div class="lab-actions">
      ${runMode ? `<button id="collect-lab" class="ghost-action" data-mode="${runMode}" data-group4="${id.startsWith('4.') ? id : 'all'}">采集${runMode === 'group3' ? '第 3 组' : '本项'}新数据</button>` : ''}
    </div>
    <p id="lab-job" role="status"></p>
  </section>
  <div class="explanation-box"><span class="explain-tag">写报告时想一想</span><p>${question}</p>${id === '3.3' ? '<p class="detail-copy"><a class="nav-link" href="/lesson">去记录预测与导出思考题笔记 →</a></p>' : ''}</div>
  <nav class="lab-neighbours" aria-label="相邻实验">${id !== '3.2' ? neighbour(labs[pos - 1], '上一项') : ''}${id !== '3.3' ? neighbour(labs[pos + 1], '下一项') : ''}</nav>`;
  if (id === '3.3') {
    if (location.hash === '#original-demand') $('#original-demand').open = true;
    loadOriginalPs($('#lab-original-ps'));
  }

  const panel = $('#lab-evidence');
  if (basic) {
    const data = await api('/api/course-basics'), capture = data.records[id];
    panel.innerHTML = `<p class="muted">${esc(data.environment)} · 运行编号 ${esc(capture.run)}</p>${table(['记录项', '实际输出'], capture.rows)}
      <details class="secondary-fold"><summary>摘录来源</summary><p class="detail-copy">本地核查目录 <code>output/verification/code-review-20261118/</code></p>
      <pre>${esc(capture.source)}\nSHA-256 ${esc(capture.source_sha256)}</pre></details>`;
  } else if (focus && replays.length) {
    const { run } = replays[0];
    const prompt = id === '3.2' ? '先猜一猜：三次申请会出现几段映射？' : '先猜一猜：只申请 512 MiB，还没写入时，已驻留物理内存（RSS）会增加多少？';
    panel.innerHTML = `<p>${prompt}</p><small class="muted">${esc(friendlyDistro(run.distribution))} · ${esc(friendlyTime(run.run_id))} · 历史实测回放</small>`;
  } else if (replays.length && !systems) {
    const { run } = replays[0];
    panel.innerHTML = `<p class="muted">已准备好真实回放：${esc(friendlyDistro(run.distribution))} · ${esc(friendlyTime(run.run_id))} · ${run.count} 组观测。点击下方按钮进入交互视图。</p>`;
  } else if (systems && replays.length) {
    const { run } = replays[0];
    const report = await api(url('/api/report', { id: run.id }));
    const c = report.cases.find(x => x.parameters?.lab === id);
    panel.innerHTML = `<p class="muted">${esc(friendlyDistro(run.distribution))} · ${esc(friendlyTime(run.run_id))} · 历史实测</p>` +
      (c?.data && c.validation.status === 'passed' ? table(['操作', '实测结果'], c.data.samples.map(s => [s.phase, displayValue(s.observed)])) :
        `<p>${esc(c?.error?.message || '本次观测未通过核对，请查看完整记录。')}</p>`);
  } else if (!replays.length) {
    panel.textContent = runMode ? '这里还没有本项回放，可以在当前实验环境采集一份。' :
      '本项尚无实测记录。按上面的步骤在课程虚拟机操作，保留命令输出和对应的内核事件。';
  }

  const collect = $('#collect-lab');
  if (collect) collect.onclick = async () => {
    collect.disabled = true;
    const status = $('#lab-job');
    try {
      const started = await api('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-VMObserve-Token': state.config.token },
        body: JSON.stringify({ mode: runMode, group4_task: collect.dataset.group4 })
      });
      status.textContent = '正在采集，完成后会显示新记录。';
      let job = started;
      while (job.id === started.id && job.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        job = await api('/api/job');
      }
      if (job.id === started.id && job.status === 'completed' && job.new_run_ids?.length) {
        state.runs = await api('/api/runs');
        await showLab(id, job.new_run_ids[0]);
        $('#lab-job').textContent = '新记录已保存 · ' + job.new_run_ids[0].split('--').pop();
      } else status.textContent = job.error?.message || labels[job.status] || '请在历史记录中查看采集结果。';
    } catch (e) { status.textContent = e.message; }
    finally { collect.disabled = false; }
  };
}
