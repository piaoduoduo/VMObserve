import { api, esc, table, url } from './ui.js';
import { compareCowPagemap, formatHex, normalizePagemap } from './pagemap-view.js';

function demandPreview(record) {
  const pageAt = phase => {
    const sample = record.data.samples.find(s => s.phase === phase);
    return normalizePagemap(sample)?.entries.find(e => e.page_index === 1);
  };
  const allocated = pageAt('allocated'), written = pageAt('write_quarter');
  if (!allocated?.vaddr || written?.vaddr !== allocated.vaddr) return null;
  return `<p>页号 1 的驻留位 <strong>Present ${Number(allocated.present)} → ${Number(written.present)}</strong></p>
    <p>刚申请 512 MiB，再写前四分之一。两次读的是同一虚拟地址 <code>${esc(formatHex(allocated.vaddr))}</code>。</p>`;
}

function cowPreview(record, report) {
  const pair = phase => {
    const samples = record.data.samples.filter(s => s.phase === phase);
    return compareCowPagemap(samples.find(s => s.role === 'parent'), samples.find(s => s.role === 'child'),
      record.data.cow, {caseRecord: record, findings: report.diagnosis?.findings});
  };
  const before = pair('fork_shared'), after = pair('child_write');
  if (before?.mode !== 'pair' || after?.mode !== 'pair' || before.pfn_access !== 'visible'
      || after.pfn_access !== 'visible' || after.diagnosis_blocked) return null;
  const relations = {shared_same_pfn: '仍共享', split_diff_pfn: '已分开'};
  const rows = after.rows.map(row =>
    [row.page_index, formatHex(row.parent?.pfn), formatHex(row.child?.pfn), relations[row.relation] || '未配对']);
  return `<p>刚 fork 时，抽查的 ${before.rows.length} 页有 ${before.shared_count} 页共享。
    子进程每 4 页写 1 页后，<strong>${after.split_count} 页分开，${after.shared_count} 页仍共享</strong>。</p>
    ${table(['页号', '父 PFN', '子 PFN', '改写后'], rows)}`;
}

const examples = [
  {run: '20261126T124107.942264Z', caseId: 'demand512-1', topic: 'group3', step: 2,
    title: '第一次写入', link: '查看写入前后的页表', render: demandPreview},
  {run: '20261126T123621.058829Z', caseId: 'baseline-16MiB-1', topic: 'baseline', step: 7,
    title: '父子进程的写时复制', link: '查看父子进程同步采样', render: cowPreview}
];

export function showFeaturedPagemap(section) {
  section.innerHTML = `<h2>openEuler 实测 · 看一页内存怎么变</h2>
    <p class="muted">回放两次真实采集。Present 表示页当前是否驻留，PFN 是物理页帧号。</p>
    <div class="featured-pagemap-grid">${examples.map(item => {
      const hash = new URLSearchParams({run: 'example--' + item.run, topic: item.topic, step: item.step});
      return `<section><h3>${item.title}</h3><div data-reading>正在读取页表…</div>
        <a href="/#${esc(hash)}">${item.link} →</a></section>`;
    }).join('')}</div>`;
  section.querySelectorAll('[data-reading]').forEach(async (target, i) => {
    const item = examples[i];
    try {
      const report = await api(url('/api/report', {id: 'example--' + item.run}));
      const record = report.cases.find(c => c.id === item.caseId);
      if (report.run_id === item.run && report.data_origin === 'real_execution' &&
          report.integrity.status === 'verified' && record?.validation.status === 'passed') {
        const html = item.render(record, report);
        if (html) { target.innerHTML = html; return; }
      }
    } catch { /* The replay link also gives access to the original record. */ }
    target.textContent = '这份记录的页表读数未能核实，可打开回放查看。';
  });
}
