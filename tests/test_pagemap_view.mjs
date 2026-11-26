import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatHex,
  parseHexBigInt,
  normalizePagemap,
  checkHugePageContiguity,
  inspectDemandPagemap,
  compareCowPagemap,
  compareThpPagemap,
  renderDemandPagemapPanel,
  renderCowPagemapPanel,
  renderThpPagemapPanel,
  pagemapReportSummary
} from '../work/vmobserve/web/pagemap-view.js';
import { learningReport } from '../work/vmobserve/web/learning-report.js';
import { humanizeFinding } from '../work/vmobserve/web/ui.js';

function makeEntry(pageIndex, { present = true, pfn = null, expectedWritten = null, label = null, swapped = false } = {}) {
  const baseVaddr = 0x7f8a10000000n + BigInt(pageIndex) * 4096n;
  const pfnBig = present && pfn ? BigInt('0x' + pfn.replace(/^0x/i, '')) : 0n;
  const raw = (present ? (1n << 63n) : 0n) | (swapped ? (1n << 62n) : 0n) | (pfnBig & ((1n << 55n) - 1n));
  return {
    page_index: pageIndex,
    vaddr: baseVaddr.toString(16),
    label: label || `第 ${pageIndex} 页`,
    expected_written: expectedWritten,
    raw_hex: raw.toString(16).padStart(16, '0'),
    present,
    swapped,
    soft_dirty: false,
    file_shared: false,
    pfn: present ? pfn : null
  };
}

test('an unaligned malloc allocation uses actual virtual 2 MiB boundaries', () => {
  const entries = [0, 1, 2].map((i) => {
    const entry = makeEntry(i, {pfn: ['9fff', 'a000', 'a001'][i]});
    entry.vaddr = (0x201ff000n + BigInt(i) * 4096n).toString(16);
    return entry;
  });
  const blocks = checkHugePageContiguity(entries, 'visible');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].blockIndex, 1);
  assert.equal(blocks[0].sampled, 2);
  assert.equal(blocks[0].basePfn, 'a000');
});

test('legacy samples without pagemap degrade cleanly without inventing readings', () => {
  const legacySample = { phase: 'write_quarter', rss_kib: 131072, huge_kib: 0 };
  assert.equal(normalizePagemap(legacySample), null);
  assert.equal(inspectDemandPagemap(legacySample), null);
  assert.equal(compareCowPagemap(legacySample, null), null);
  assert.equal(compareThpPagemap(legacySample, legacySample), null);
  assert.equal(pagemapReportSummary(legacySample), null);

  const demandHtml = renderDemandPagemapPanel(legacySample);
  assert.match(demandHtml, /data-pagemap-state="absent"/);
  assert.match(demandHtml, /旧版探针/);
  assert.doesNotMatch(demandHtml, /class="pagemap-panel"/);
  assert.doesNotMatch(demandHtml, /P = 1/);
});

test('pfn masking enforces null PFNs and never presents masked zero as real PFN', () => {
  const maskedSample = {
    phase: 'write_quarter',
    pagemap: {
      source: '/proc/self/pagemap',
      status: 'available',
      pfn_access: 'visible', // 即使后端误标 visible，只要出现 pfn=0 就强制降级为 masked
      page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '0', expectedWritten: true }),
        makeEntry(32768, { present: false, pfn: null, expectedWritten: false })
      ]
    }
  };
  const pm = normalizePagemap(maskedSample);
  assert.equal(pm.pfn_access, 'masked');
  assert.equal(pm.entries[0].present, true);
  assert.equal(pm.entries[0].pfn, null);
  assert.equal(pm.entries[1].present, false);

  const html = renderDemandPagemapPanel(maskedSample);
  assert.match(html, /PFN 已被内核屏蔽/);
  assert.match(html, /P = 1/);
  assert.match(html, /P = 0/);
  assert.doesNotMatch(html, /PFN 0x0\b/);
});

test('3.3 demand paging detects Present 0->1 flip and 2 MiB contiguous alignment with BigInt PFNs', () => {
  // 选取超出 JS Number.MAX_SAFE_INTEGER 附近的 55 位高端 PFN 对齐块（0x4000000000000 是 512 整数倍）
  const basePfn = 0x4000000000200n; // 0x200 = 512，严格 2 MiB 对齐
  assert.equal(basePfn % 512n, 0n);

  const quarterSample = {
    phase: 'write_quarter',
    pagemap: {
      source: '/proc/2026/pagemap',
      status: 'available',
      pfn_access: 'visible',
      page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: basePfn.toString(16), expectedWritten: true, label: 'A 段首' }),
        makeEntry(1, { present: true, pfn: (basePfn + 1n).toString(16), expectedWritten: true, label: 'A 段第 2 页' }),
        makeEntry(511, { present: true, pfn: (basePfn + 511n).toString(16), expectedWritten: true, label: '第 1 块末页' }),
        makeEntry(32768, { present: false, pfn: null, expectedWritten: false, label: 'B 段首' })
      ]
    }
  };

  const info = inspectDemandPagemap(quarterSample);
  assert.equal(info.present_count, 3);
  assert.equal(info.not_present_count, 1);
  assert.equal(info.written_present, 3);
  assert.equal(info.unwritten_absent, 1);
  assert.equal(info.huge_blocks.length, 1);
  assert.equal(info.huge_blocks[0].status, 'contiguous_2mib_verified');
  assert.equal(info.huge_blocks[0].basePfn, basePfn.toString(16));
  assert.match(info.verdict, /已写的 3 个抽样页都是 Present = 1/);

  const html = renderDemandPagemapPanel(quarterSample);
  assert.match(html, /抽样 PFN 符合 2 MiB 对齐关系/);
  assert.match(html, /CAP_SYS_ADMIN/);
  assert.equal(parseHexBigInt('0x' + basePfn.toString(16)), basePfn);
  assert.equal(formatHex(basePfn.toString(16)), '0x' + basePfn.toString(16));
});

test('COW pagemap confirms shared zero page, fork shared PFNs, and selective COW splits', () => {
  // 1) read_all 阶段：全部指向同一个共享零页 PFN
  const readAll = {
    phase: 'read_all',
    role: 'parent',
    pagemap: {
      status: 'available',
      pfn_access: 'visible',
      page_bytes: 4096,
      entries: [0, 1, 2, 3].map(i => makeEntry(i, { present: true, pfn: '1a2b3c' }))
    }
  };
  const zeroCheck = compareCowPagemap(readAll, null);
  assert.equal(zeroCheck.mode, 'single');
  assert.equal(zeroCheck.all_same_pfn, true);
  assert.equal(zeroCheck.shared_zero_pfn, '1a2b3c');
  assert.match(zeroCheck.verdict, /实锤共享零页/);

  // 2) child_write 阶段（1/4 比例，改写第 0、4 页，其余 1,2,3 保持共享）
  const parentSample = {
    phase: 'child_write',
    role: 'parent',
    pagemap: {
      source: '/proc/100/pagemap',
      status: 'available',
      pfn_access: 'visible',
      page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '200100', expectedWritten: true }),
        makeEntry(1, { present: true, pfn: '200101', expectedWritten: false }),
        makeEntry(4, { present: true, pfn: '200104', expectedWritten: true }),
        makeEntry(5, { present: true, pfn: '200105', expectedWritten: false })
      ]
    }
  };
  const childSample = {
    phase: 'child_write',
    role: 'child',
    pagemap: {
      source: '/proc/101/pagemap',
      status: 'available',
      pfn_access: 'visible',
      page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '300900', expectedWritten: true }),
        makeEntry(1, { present: true, pfn: '200101', expectedWritten: false }),
        makeEntry(4, { present: true, pfn: '300904', expectedWritten: true }),
        makeEntry(5, { present: true, pfn: '200105', expectedWritten: false })
      ]
    }
  };

  // 无论当前视角是 parent 还是 child，都应准确配对并识别 2 裂 + 2 共享
  const cmp = compareCowPagemap(childSample, parentSample, { fraction: '1/4', written_pages: 1024 });
  assert.equal(cmp.mode, 'pair');
  assert.equal(cmp.split_count, 2);
  assert.equal(cmp.shared_count, 2);
  assert.equal(cmp.expected_match, true);
  assert.match(cmp.verdict, /写时复制物理页分裂实锤/);

  const html = renderCowPagemapPanel(childSample, parentSample, { fraction: '1/4', written_pages: 1024 });
  assert.match(html, /≠ PFN 已分裂/);
  assert.match(html, /＝ 共享同 PFN/);
  assert.match(html, /\/proc\/100\/pagemap/);
  assert.match(html, /\/proc\/101\/pagemap/);
});

test('THP sparse comparison highlights collateral Present=1 neighbors and 2 MiB alignment', () => {
  const offSample = {
    phase: 'after_write',
    pagemap: {
      status: 'available',
      pfn_access: 'visible',
      page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '101234', expectedWritten: true, label: '第 0 块首' }),
        makeEntry(1, { present: false, pfn: null, expectedWritten: false, label: '第 0 块次页' }),
        makeEntry(511, { present: false, pfn: null, expectedWritten: false, label: '第 0 块末页' })
      ]
    }
  };
  const onSample = {
    phase: 'after_write',
    huge_kib: 32768,
    pagemap: {
      status: 'available',
      pfn_access: 'visible',
      page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '200000', expectedWritten: true, label: '第 0 块首' }),
        makeEntry(1, { present: true, pfn: '200001', expectedWritten: false, label: '第 0 块次页' }),
        makeEntry(511, { present: true, pfn: '2001ff', expectedWritten: false, label: '第 0 块末页' })
      ]
    }
  };

  const compared = compareThpPagemap(offSample, onSample, ['关闭大页', '请求大页']);
  assert.equal(compared.status, 'available');
  assert.equal(compared.collateral_count, 2);
  assert.equal(compared.on_contiguous_count, 1);
  assert.equal(checkHugePageContiguity(offSample.pagemap.entries, 'visible')[0].status, 'base_4k_mixed');
  assert.match(compared.verdict, /2 个未写的邻页/);
  assert.match(compared.verdict, /32768 KiB 匿名大页/);

  const html = renderThpPagemapPanel([offSample, onSample], ['关闭大页', '请求大页']);
  assert.match(html, /未写 · 随大页驻留/);
  assert.match(html, /抽样 PFN 符合 2 MiB 对齐关系/);
});

test('unmapped demand pair reports unmapped state cleanly and learning report appends summary only when present', () => {
  const unmapped = {
    phase: 'before_alloc',
    pagemap: { status: 'unmapped', pfn_access: 'not_applicable', page_bytes: 4096, entries: [] }
  };
  const html = renderDemandPagemapPanel(unmapped, { pairSamples: [unmapped, unmapped], pairLabels: ['禁用大页建议', '使用大页建议'] });
  assert.match(html, /data-pagemap-state="unmapped"/);
  assert.match(html, /无目标映射/);

  // 学习报告：含 pagemap 时输出摘要行，不含时保持原样
  const withPm = learningReport([{
    evidence: {
      topic: 'group3', step_index: 2, run_id: 'r1', report_sha256: 'abc',
      integrity: { status: 'verified' }, data_origin: 'real_execution',
      cases: [{
        case_id: 'demand512-thp-on-1', suite: 'demand512', validation: { status: 'passed' },
        samples: [{
          phase: 'write_quarter', mapping_present: true, count: 32768, rss_kib: 131072, huge_kib: 131072, action_minor: 64,
          pagemap: {
            status: 'available', pfn_access: 'visible', page_bytes: 4096,
            entries: [
              makeEntry(0, { present: true, pfn: '200000' }),
              makeEntry(1, { present: true, pfn: '200001' })
            ]
          }
        }]
      }]
    },
    prediction: 'p', observation: 'o', explanation: 'e'
  }]);
  assert.match(withPm, /页表项观测 \(pagemap\)/);
  assert.match(withPm, /2\/2 哨兵页 Present=1 · PFN 可见 · 抽样 PFN 符合 2 MiB 对齐关系/);
});


test('COW expectedMatch requires expected_written annotations and distinguishes missing entries from Present=0', () => {
  const parentSample = {
    phase: 'child_write',
    role: 'parent',
    pagemap: {
      source: '/proc/100/pagemap', status: 'available', pfn_access: 'visible', page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '200100' }),
        makeEntry(1, { present: true, pfn: '200101' })
      ]
    }
  };
  const childSample = {
    phase: 'child_write',
    role: 'child',
    pagemap: {
      source: '/proc/101/pagemap', status: 'available', pfn_access: 'visible', page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '300900' })
      ]
    }
  };
  const cmp = compareCowPagemap(childSample, parentSample, { fraction: '1/4', written_pages: 1024 });
  assert.equal(cmp.expected_match, false);
  assert.equal(cmp.partial_count, 1);
  assert.doesNotMatch(cmp.verdict, /物理页分裂实锤/);

  const html = renderCowPagemapPanel(childSample, parentSample, { fraction: '1/4', written_pages: 1024 });
  assert.match(html, /单侧缺失/);
  assert.match(html, /<td>缺失<\/td>/);
  assert.doesNotMatch(html, /<td>Present=0<\/td>/);
});

test('COW single-process non-read_all stage does not falsely claim shared zero page', () => {
  const unexpected = {
    phase: 'write_all',
    role: 'parent',
    rss_kib: 16384,
    pagemap: {
      status: 'available', pfn_access: 'visible', page_bytes: 4096,
      entries: [0, 1].map(i => makeEntry(i, { present: true, pfn: '1a2b3c' }))
    }
  };
  const res = compareCowPagemap(unexpected, null);
  assert.equal(res.all_same_pfn, true);
  assert.equal(res.shared_zero_confirmed, false);
  assert.equal(res.shared_zero_pfn, null);
  assert.doesNotMatch(res.verdict, /只读匿名页/);
});

test('THP comparison distinguishes missing entries, mixed PFN visibility, and 4K vs 2MiB contiguity contrast', () => {
  const offSample = {
    phase: 'write_quarter',
    pagemap: {
      status: 'available', pfn_access: 'visible', page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '101234', expectedWritten: true }),
        makeEntry(1, { present: true, pfn: '109999', expectedWritten: true })
      ]
    }
  };
  const onSample = {
    phase: 'write_quarter',
    pagemap: {
      status: 'available', pfn_access: 'visible', page_bytes: 4096,
      entries: [
        makeEntry(0, { present: true, pfn: '200000', expectedWritten: true }),
        makeEntry(1, { present: true, pfn: '200001', expectedWritten: true }),
        makeEntry(511, { present: true, pfn: '2001ff', expectedWritten: true })
      ]
    }
  };
  const html = renderThpPagemapPanel([offSample, onSample], ['禁用大页建议', '使用大页建议']);
  assert.match(html, /双组 2 MiB 物理连续性对照/);
  assert.match(html, /<td>单侧缺失<\/td>/);

  // 一侧 masked、一侧 visible 时，整体徽标不得宣称双方全部 PFN 可见
  const offMasked = {
    phase: 'write_quarter',
    pagemap: {
      status: 'available', pfn_access: 'masked', page_bytes: 4096,
      entries: [makeEntry(0, { present: true, pfn: null, expectedWritten: true })]
    }
  };
  const mixedHtml = renderThpPagemapPanel([offMasked, onSample], ['禁用大页建议', '使用大页建议']);
  assert.match(mixedHtml, /PFN 已被内核屏蔽/);
  assert.doesNotMatch(mixedHtml, /CAP_SYS_ADMIN/);
});

test('humanizeFinding never rewrites insufficient_evidence pagemap findings into confirmed claims', () => {
  const maskedCow = humanizeFinding({
    rule: 'cow_pfn_split',
    confidence: 'insufficient_evidence',
    title: '父子页帧关系待确认',
    explanation: '内核屏蔽了页帧号。可以核对 Present、PSS 和父子各自读回的值。'
  });
  assert.equal(maskedCow.title, '父子页帧关系待确认');
  assert.doesNotMatch(maskedCow.title, /实锤|已分裂/);

  const mallocDemand = humanizeFinding({
    rule: 'demand_pte_present',
    confidence: 'insufficient_evidence',
    title: '抽样页未完整呈现按写入顺序驻留',
    explanation: '第一次程序写入之前已有抽样页驻留。'
  });
  assert.equal(mallocDemand.title, '抽样页未完整呈现按写入顺序驻留');
  assert.doesNotMatch(mallocDemand.title, /实锤/);

  const unconfirmedZero = humanizeFinding({
    rule: 'anonymous_zero_page',
    confidence: 'insufficient_evidence',
    title: '只读阶段未确认共同零页',
    explanation: '本次页表和读回结果未同时满足全部抽样页驻留、共用同一页帧且读值为零。'
  });
  assert.equal(unconfirmedZero.title, '只读阶段未确认共同零页');
  assert.doesNotMatch(unconfirmedZero.title, /多半是|证实/);

  const confirmedCow = humanizeFinding({
    rule: 'cow_pfn_split',
    confidence: 'confirmed',
    title: '子进程改写的抽样页换了物理页帧',
    explanation: 'fork 后 8 个抽样页逐一相同。'
  });
  assert.match(confirmedCow.title, /实锤/);
});
