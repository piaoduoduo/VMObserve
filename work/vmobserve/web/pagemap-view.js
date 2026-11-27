import { esc, table } from './ui.js';

/**
 * 规范化十六进制地址或页帧号，统一添加 0x 前缀；空值返回占位符。
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatHex(value) {
  if (value == null || value === '') return '—';
  const clean = String(value).trim().replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]+$/.test(clean) ? '0x' + clean : String(value);
}

/**
 * 以 BigInt 安全解析 55/64 位十六进制数值（避免超过 Number.MAX_SAFE_INTEGER 丢精度）。
 * @param {string|null|undefined} value
 * @returns {bigint|null}
 */
export function parseHexBigInt(value) {
  if (value == null || value === '') return null;
  const clean = String(value).trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  return BigInt('0x' + clean);
}

/**
 * 缩短展示长十六进制 PFN（保留完整值放 title 悬浮），用于紧凑卡片格子。
 * @param {string|null|undefined} pfn
 * @returns {string}
 */
function compactPfn(pfn) {
  const full = formatHex(pfn);
  if (full === '—' || full.length <= 10) return full;
  return '0x…' + full.slice(-6);
}

/**
 * 规范化并校验单条 sample.pagemap 数据；旧记录无此字段时返回 null。
 * 严守防造假边界：pfn_access !== 'visible' 或 present !== true 时，绝不接受任何有效 PFN。
 * @param {object|null|undefined} sample
 * @returns {object|null}
 */
export function normalizePagemap(sample) {
  const pm = sample?.pagemap;
  if (!pm || typeof pm !== 'object') return null;
  const status = pm.status || 'available';
  const rawEntries = Array.isArray(pm.entries) ? pm.entries : [];
  const pfnAccess = pm.pfn_access || 'not_applicable';
  const entries = rawEntries
    .filter(item => item && Number.isInteger(item.page_index) && item.page_index >= 0)
    .map(item => {
      const present = Boolean(item.present);
      const pfnBig = present && pfnAccess === 'visible' ? parseHexBigInt(item.pfn) : null;
      const validPfn = pfnBig !== null && pfnBig > 0n ? pfnBig.toString(16) : null;
      return {
        page_index: item.page_index,
        vaddr: item.vaddr ? String(item.vaddr).trim().replace(/^0x/i, '').toLowerCase() : null,
        label: item.label || `第 ${item.page_index} 页`,
        expected_written: typeof item.expected_written === 'boolean' ? item.expected_written : null,
        raw_hex: item.raw_hex ? String(item.raw_hex).trim().replace(/^0x/i, '').toLowerCase() : null,
        present,
        swapped: Boolean(item.swapped),
        soft_dirty: typeof item.soft_dirty === 'boolean' ? item.soft_dirty : null,
        file_shared: typeof item.file_shared === 'boolean' ? item.file_shared : null,
        pfn: validPfn
      };
    });

  const presentCount = entries.filter(e => e.present).length;
  const swappedCount = entries.filter(e => e.swapped).length;
  const visiblePfnCount = entries.filter(e => e.present && e.pfn !== null).length;
  // 若声称 visible 但存在已驻留页拿不到非零 PFN，降级为 masked 避免误导
  const effectiveAccess = status !== 'available'
    ? 'not_applicable'
    : presentCount === 0
      ? (pfnAccess === 'masked' ? 'masked' : 'not_applicable')
      : (pfnAccess === 'visible' && visiblePfnCount === presentCount ? 'visible' : 'masked');

  return {
    source: pm.source || '/proc/self/pagemap',
    status,
    pfn_access: effectiveAccess,
    reason: pm.reason || (effectiveAccess === 'masked' ? 'requires_cap_sys_admin' : null),
    page_bytes: Number.isFinite(pm.page_bytes) && pm.page_bytes > 0 ? pm.page_bytes : 4096,
    region_start: pm.region_start ? String(pm.region_start).trim().replace(/^0x/i, '').toLowerCase() : null,
    region_pages: Number.isFinite(pm.region_pages) ? pm.region_pages : null,
    sampled_count: entries.length,
    present_count: presentCount,
    swapped_count: swappedCount,
    entries: effectiveAccess === 'visible' ? entries : entries.map(e => ({ ...e, pfn: null }))
  };
}

/**
 * 检查同一 2 MiB 块内多个抽样页的驻留与 PFN 连续对齐性，用于与 smaps AnonHugePages 互证。
 * @param {Array<object>} entries
 * @param {string} pfnAccess
 * @param {number} pageBytes
 * @param {number} hugeBytes
 * @returns {Array<object>}
 */
export function checkHugePageContiguity(entries, pfnAccess, pageBytes = 4096, hugeBytes = 2097152) {
  if (!entries.length || !pageBytes || !hugeBytes || hugeBytes % pageBytes !== 0) return [];
  const pagesPerHuge = hugeBytes / pageBytes;
  const pagesPerHugeBig = BigInt(pagesPerHuge);
  // malloc can start partway through a 2 MiB interval. Use the real virtual page boundaries.
  const address = parseHexBigInt(entries[0].vaddr);
  if (address === null) return [];
  const firstPage = address / BigInt(pageBytes) - BigInt(entries[0].page_index);
  const regionOffset = Number(firstPage % pagesPerHugeBig);
  const offsetOf = item => (regionOffset + item.page_index) % pagesPerHuge;
  const groups = new Map();
  for (const entry of entries) {
    const blockIndex = Math.floor((regionOffset + entry.page_index) / pagesPerHuge);
    if (!groups.has(blockIndex)) groups.set(blockIndex, []);
    groups.get(blockIndex).push(entry);
  }
  const results = [];
  for (const [blockIndex, list] of groups.entries()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.page_index - b.page_index);
    const presentItems = sorted.filter(item => item.present);
    if (presentItems.length === 0) {
      results.push({ blockIndex, status: 'all_absent', sampled: sorted.length, present: 0, basePfn: null });
      continue;
    }
    if (presentItems.length < sorted.length) {
      results.push({ blockIndex, status: 'base_4k_mixed', sampled: sorted.length, present: presentItems.length, basePfn: null });
      continue;
    }
    if (pfnAccess !== 'visible') {
      results.push({ blockIndex, status: 'present_only_pfn_masked', sampled: sorted.length, present: presentItems.length, basePfn: null });
      continue;
    }
    const first = sorted[0];
    const firstPfn = parseHexBigInt(first.pfn);
    const firstOffset = BigInt(offsetOf(first));
    if (firstPfn === null || firstPfn < firstOffset) {
      results.push({ blockIndex, status: 'non_contiguous_4k', sampled: sorted.length, present: presentItems.length, basePfn: null });
      continue;
    }
    const basePfn = firstPfn - firstOffset;
    const aligned = basePfn % pagesPerHugeBig === 0n;
    const contiguous = sorted.every(item => {
      const pfn = parseHexBigInt(item.pfn);
      return pfn !== null && pfn === basePfn + BigInt(offsetOf(item));
    });
    results.push({
      blockIndex,
      status: aligned && contiguous ? 'contiguous_2mib_verified' : 'non_contiguous_4k',
      sampled: sorted.length,
      present: presentItems.length,
      basePfn: basePfn.toString(16)
    });
  }
  return results;
}

/**
 * 根据当前案例的校验状态和后端 diagnosis.findings 判断教学页是否允许给出“确认/实锤”结论。
 * 保证教学页永远不会在案例校验失败或后端诊断为证据不足时给出相反结论。
 * @param {object|null|undefined} context { caseRecord?, peerCaseRecord?, findings? }
 * @param {Array<string>} rules 需核对的后端诊断规则名列表
 * @returns {{hasContext: boolean, caseInvalid: boolean, caseBlocked: boolean, blocked: boolean, confirmed: boolean|null, finding: object|null}}
 */
export function resolveDiagnosisGuard(context, rules = []) {
  if (!context || typeof context !== 'object') {
    return { hasContext: false, caseInvalid: false, caseBlocked: false, blocked: false, confirmed: null, finding: null };
  }
  const records = [context.caseRecord, context.peerCaseRecord].filter(Boolean);
  const caseIds = new Set(records.map(item => item.id).filter(Boolean));
  const caseInvalid = records.some(item =>
    (item.status && item.status !== 'completed') ||
    item.integrity === 'failed' ||
    ['failed', 'insufficient_evidence'].includes(item.validation?.status)
  );
  const findings = Array.isArray(context.findings) ? context.findings : [];
  const matchesCase = finding => {
    if (!caseIds.size) return true;
    const ev = Array.isArray(finding?.evidence) ? finding.evidence : [];
    return ev.some(item => item && caseIds.has(item.case_id));
  };
  const incomplete = findings.find(f => f?.rule === 'incomplete_evidence' && matchesCase(f)) || null;
  const matched = rules.length
    ? (findings.find(f => rules.includes(f?.rule) && matchesCase(f)) || null)
    : null;

  if (caseInvalid || incomplete) {
    return { hasContext: true, caseInvalid, caseBlocked: true, blocked: true, confirmed: false, finding: incomplete || matched };
  }
  if (matched) {
    const isConfirmed = matched.confidence === 'confirmed';
    return { hasContext: true, caseInvalid: false, caseBlocked: false, blocked: !isConfirmed, confirmed: isConfirmed, finding: matched };
  }
  return { hasContext: records.length > 0 || findings.length > 0, caseInvalid: false, caseBlocked: false, blocked: false, confirmed: null, finding: null };
}

/**
 * 分析 3.3 按需调页单次采样的页表项状态。
 * @param {object|null|undefined} sample
 * @param {object|null|undefined} context 可选 { caseRecord, findings }
 * @returns {object|null}
 */
export function inspectDemandPagemap(sample, context = null) {
  const pm = normalizePagemap(sample);
  if (!pm) return null;
  const written = pm.entries.filter(e => e.expected_written === true);
  const unwritten = pm.entries.filter(e => e.expected_written === false);
  const writtenPresent = written.filter(e => e.present).length;
  const unwrittenAbsent = unwritten.filter(e => !e.present).length;
  const hugeBlocks = checkHugePageContiguity(pm.entries, pm.pfn_access, pm.page_bytes);
  const guard = resolveDiagnosisGuard(context, ['demand_pte_present']);

  let verdict = '';
  if (guard.caseBlocked && pm.status === 'available') {
    verdict = guard.finding?.explanation
      ? `本案例校验未通过或证据不足（${guard.finding.title}）：${guard.finding.explanation} 以下仅展示原始页表读数。`
      : '本案例校验未通过或证据不足，以下仅展示原始页表读数，不作为按需建表确认依据。';
  } else if (pm.status === 'unmapped') {
    verdict = '当前阶段目标映射尚未建立或已经释放，不读取页表项。';
  } else if (pm.status !== 'available') {
    verdict = `未能读取 ${pm.source}（${pm.reason || pm.status}），本步维持仅凭 smaps 观测。`;
  } else if (pm.sampled_count === 0) {
    verdict = '本步未记录页表抽样条目。';
  } else if (pm.swapped_count) {
    verdict = `本步有 ${pm.present_count} 个抽样页驻留，${pm.swapped_count} 个已换出。换出的页没有可比较的驻留页帧号。`;
  } else if (pm.present_count === 0) {
    verdict = `抽样的 ${pm.sampled_count} 个哨兵虚拟页 Present 位全部为 0——Linux 只登记了虚拟区间，尚未分配物理页帧。`;
  } else if (!guard.blocked && written.length && unwritten.length && writtenPresent === written.length && unwrittenAbsent === unwritten.length) {
    verdict = `这一步，已写的 ${written.length} 个抽样页都是 Present = 1，未写的 ${unwritten.length} 个都是 Present = 0。`;
  } else if (pm.present_count === pm.sampled_count) {
    verdict = `抽样的 ${pm.sampled_count} 个哨兵页 Present 位已全部为 1（均已建立物理页表映射）。`;
  } else {
    verdict = `本步 ${pm.sampled_count} 个哨兵页中已有 ${pm.present_count} 页 Present = 1，其余 ${pm.sampled_count - pm.present_count} 页尚未建立物理映射。`;
  }

  // 案例本身通过校验、仅因整轮（如原版 malloc 首尾页/大页覆盖）未按纯按需确认时，保留本步客观读数并附注整轮边界
  if (!guard.caseBlocked && guard.blocked && pm.status === 'available' && pm.sampled_count > 0 && guard.finding) {
    const note = guard.finding.explanation
      ? `${guard.finding.title}（${guard.finding.explanation}）`
      : guard.finding.title;
    verdict += ` 注：整轮未按纯按需确认——${note}`;
  }

  return {
    ...pm,
    not_present_count: pm.sampled_count - pm.present_count,
    written_total: written.length,
    written_present: writtenPresent,
    unwritten_total: unwritten.length,
    unwritten_absent: unwrittenAbsent,
    huge_blocks: hugeBlocks,
    case_blocked: guard.caseBlocked,
    diagnosis_blocked: guard.blocked,
    verdict
  };
}

/**
 * 分析 COW 写时复制的单进程阶段（零页/逐页写入）或父子双进程阶段（PFN 共享与分裂）。
 * @param {object|null|undefined} sample 当前视角采样
 * @param {object|null|undefined} peerSample 对侧进程采样（仅 fork_shared / child_write 存在）
 * @param {object|null|undefined} cowInfo 案例级 data.cow 元数据
 * @param {object|null|undefined} context 可选 { caseRecord, findings }
 * @returns {object|null}
 */
export function compareCowPagemap(sample, peerSample = null, cowInfo = null, context = null) {
  const current = normalizePagemap(sample);
  const peer = normalizePagemap(peerSample);
  if (!current && !peer) return null;

  // 单进程阶段（untouched / read_all / write_quarter / write_all）
  if (!peer || !sample || !peerSample || sample.role === peerSample.role) {
    const pm = current || peer;
    if (!pm) return null;
    const presentPfns = pm.entries.filter(e => e.present && e.pfn).map(e => e.pfn);
    const uniquePfns = [...new Set(presentPfns)];
    const allSamePfn = pm.pfn_access === 'visible' && presentPfns.length >= 2 && uniquePfns.length === 1;
    const guard = resolveDiagnosisGuard(context, sample?.phase === 'read_all' ? ['anonymous_zero_page'] : []);
    const initialReadSum = context?.caseRecord?.data?.value_check?.initial_read_sum;
    const readSumOk = initialReadSum == null || initialReadSum === 0;
    const privateDirtyOk = sample?.private_dirty_kib == null || sample.private_dirty_kib === 0;
    const isReadAllZero = !guard.blocked && readSumOk && privateDirtyOk &&
      allSamePfn && pm.present_count === pm.sampled_count &&
      sample?.phase === 'read_all' && (sample.rss_kib == null || sample.rss_kib === 0);
    let verdict = '';
    if (pm.status !== 'available') {
      verdict = `本步未能读取页表项（${pm.reason || pm.status}）。`;
    } else if (guard.caseBlocked) {
      const diagDetail = guard.finding?.explanation ? `${guard.finding.title}：${guard.finding.explanation}` : '当前案例校验未通过或后端诊断为证据不足。';
      verdict = `未确认该阶段结论（${diagDetail}）。以下仅展示原始页表读数（${pm.present_count}/${pm.sampled_count} 页 Present = 1${allSamePfn ? `，抽样 PFN 均为 ${formatHex(uniquePfns[0])}` : pm.pfn_access === 'masked' ? '，PFN 已被内核屏蔽' : ''}）。`;
    } else if (pm.present_count === 0) {
      verdict = `抽样的 ${pm.sampled_count} 页 Present 全部为 0，物理页尚未分配。`;
    } else if (pm.pfn_access === 'masked') {
      verdict = `抽样的 ${pm.sampled_count} 页中 ${pm.present_count} 页 Present = 1；当前非特权采集下内核屏蔽了 PFN，需在 openEuler 虚拟机或 root 环境下核对具体物理页帧号。`;
      if (sample?.phase === 'read_all' && guard.finding?.confidence === 'probable') {
        verdict += '（结合只读阶段 0 KiB RSS 与次缺页，现象与共享零页机制相符，但尚缺直接 PFN 证据。）';
      }
    } else if (guard.blocked) {
      const diagDetail = guard.finding?.explanation ? `${guard.finding.title}：${guard.finding.explanation}` : '后端诊断未确认该阶段结论。';
      verdict = `未确认该阶段结论（${diagDetail}）。以下仅展示原始页表读数（${pm.present_count}/${pm.sampled_count} 页 Present = 1${allSamePfn ? `，抽样 PFN 均为 ${formatHex(uniquePfns[0])}` : ''}）。`;
    } else if (isReadAllZero) {
      verdict = `实锤共享零页：${presentPfns.length} 个抽样虚拟页 Present = 1 且全部指向同一个物理页帧 ${formatHex(uniquePfns[0])}，内核未为只读匿名页分配独立物理内存。`;
    } else if (sample?.phase === 'read_all' && allSamePfn && (!readSumOk || !privateDirtyOk)) {
      verdict = `抽样的 ${presentPfns.length} 个已驻留页虽指向同一物理页帧 ${formatHex(uniquePfns[0])}，但只读字节和或驻留计账与零页条件不符，未确认共享零页。`;
    } else if (allSamePfn) {
      verdict = `抽样的 ${presentPfns.length} 个已驻留页全部指向同一个物理页帧 ${formatHex(uniquePfns[0])}。`;
    } else if (pm.pfn_access === 'visible') {
      verdict = `抽样的 ${pm.present_count} 个已驻留页映射到 ${uniquePfns.length} 个物理页帧${uniquePfns.length < pm.present_count ? '（部分未写页仍共指同一物理帧，已写页已分配独立页帧）' : '（各自拥有独立物理页帧）'}。`;
    } else {
      verdict = `抽样的 ${pm.sampled_count} 页中 ${pm.present_count} 页 Present = 1；当前未能读取物理页帧号。`;
    }
    return {
      mode: 'single',
      ...pm,
      unique_pfn_count: uniquePfns.length,
      all_same_pfn: allSamePfn,
      shared_zero_confirmed: isReadAllZero,
      shared_zero_pfn: isReadAllZero ? uniquePfns[0] : null,
      diagnosis_blocked: guard.blocked,
      verdict
    };
  }

  // 双进程同步阶段：明确区分 parent 与 child
  const parentSample = sample.role === 'parent' ? sample : peerSample;
  const childSample = sample.role === 'child' ? sample : peerSample;
  const parentPm = normalizePagemap(parentSample);
  const childPm = normalizePagemap(childSample);
  if (!parentPm || !childPm) {
    return {
      mode: 'pair',
      status: 'partial',
      pfn_access: 'not_applicable',
      rows: [],
      shared_count: 0,
      split_count: 0,
      masked_count: 0,
      not_present_count: 0,
      partial_count: 0,
      verdict: '仅一侧进程包含页表项采样，暂无法配对父子 PFN。'
    };
  }

  const pMap = new Map(parentPm.entries.map(e => [e.page_index, e]));
  const cMap = new Map(childPm.entries.map(e => [e.page_index, e]));
  const indices = [...new Set([...pMap.keys(), ...cMap.keys()])].sort((a, b) => a - b);
  const pairAccess = pairedPfnAccess([parentPm, childPm]);

  const rows = indices.map(idx => {
    const pe = pMap.get(idx) || null;
    const ce = cMap.get(idx) || null;
    const expectedWritten = ce?.expected_written ?? pe?.expected_written ?? null;
    let relation = 'partial';
    if (pe && ce) {
      if (!pe.present || !ce.present) {
        relation = 'not_present';
      } else if (pairAccess !== 'visible' || !pe.pfn || !ce.pfn) {
        relation = 'pfn_masked';
      } else if (pe.pfn === ce.pfn) {
        relation = 'shared_same_pfn';
      } else {
        relation = 'split_diff_pfn';
      }
    }
    return {
      page_index: idx,
      label: ce?.label || pe?.label || `第 ${idx} 页`,
      vaddr: ce?.vaddr || pe?.vaddr || null,
      expected_written: expectedWritten,
      parent: pe,
      child: ce,
      relation
    };
  });

  const sharedCount = rows.filter(r => r.relation === 'shared_same_pfn').length;
  const splitCount = rows.filter(r => r.relation === 'split_diff_pfn').length;
  const maskedCount = rows.filter(r => r.relation === 'pfn_masked').length;
  const notPresentCount = rows.filter(r => r.relation === 'not_present').length;
  const partialCount = rows.filter(r => r.relation === 'partial').length;

  // 按相同页号逐一比较父子 Present 驻留位（普通用户看不到 PFN 时仍可严谨比对 Present）
  const parentOnlyPresentPages = rows
    .filter(r => r.parent?.present === true && r.child?.present === false)
    .map(r => r.page_index);
  const childOnlyPresentPages = rows
    .filter(r => r.parent?.present === false && r.child?.present === true)
    .map(r => r.page_index);
  const partialPages = rows
    .filter(r => !r.parent || !r.child)
    .map(r => r.page_index);
  const presentAllEqual = rows.length > 0 &&
    parentOnlyPresentPages.length === 0 &&
    childOnlyPresentPages.length === 0 &&
    partialPages.length === 0;

  const formatPresentComparison = () => {
    if (presentAllEqual) {
      return `父子抽样的 ${rows.length} 个虚拟页 Present 位均已核对（驻留一致，父子均为 ${parentPm.present_count}/${parentPm.sampled_count} 页驻留）`;
    }
    const diffs = [];
    if (parentOnlyPresentPages.length) diffs.push(`第 ${parentOnlyPresentPages.join('、')} 页只有父进程驻留`);
    if (childOnlyPresentPages.length) diffs.push(`第 ${childOnlyPresentPages.join('、')} 页只有子进程驻留`);
    if (partialPages.length) diffs.push(`第 ${partialPages.join('、')} 页仅单侧有采样`);
    return `父进程 ${parentPm.present_count}/${parentPm.sampled_count} 页驻留，子进程 ${childPm.present_count}/${childPm.sampled_count} 页驻留${diffs.length ? '，' + diffs.join('，') : ''}`;
  };

  const writtenRows = rows.filter(r => r.expected_written === true);
  const unwrittenRows = rows.filter(r => r.expected_written === false);
  const expectedMatch = pairAccess === 'visible' && rows.length > 0 &&
    writtenRows.length + unwrittenRows.length === rows.length &&
    writtenRows.every(r => r.relation === 'split_diff_pfn') &&
    unwrittenRows.every(r => r.relation === 'shared_same_pfn');

  const guard = resolveDiagnosisGuard(context, ['cow_pfn_split', 'cow_pfn_shared_control']);
  const rawPairSummary = pairAccess === 'visible'
    ? `${splitCount} 页 PFN 不同，${sharedCount} 页 PFN 相同${presentAllEqual ? '' : `（${formatPresentComparison()}）`}`
    : pairAccess === 'masked'
      ? `${formatPresentComparison()}，且 PFN 已被内核屏蔽`
      : formatPresentComparison();
  let verdict = '';
  if (parentPm.status !== 'available' || childPm.status !== 'available') {
    verdict = '父子进程中至少一侧未能成功读取 /proc/<pid>/pagemap，本步暂以 PSS 对照为准。';
  } else if (guard.caseBlocked) {
    const diagDetail = guard.finding?.explanation ? `${guard.finding.title}：${guard.finding.explanation}` : '当前案例校验未通过或后端诊断为证据不足。';
    verdict = `未确认父子页帧结论（${diagDetail}）。下方仅展示原始抽样读数：${rawPairSummary}。`;
  } else if (pairAccess === 'masked') {
    verdict = presentAllEqual
      ? `${formatPresentComparison()}，但内核已屏蔽非特权 PFN（需 CAP_SYS_ADMIN / openEuler 虚拟机采集以直接比对父子物理页帧号）。`
      : `${formatPresentComparison()}。当前非特权采集下内核屏蔽了 PFN，仅能按页核对 Present 驻留位（需 CAP_SYS_ADMIN / openEuler 虚拟机采集以直接比对父子物理页帧号）。`;
  } else if (guard.blocked) {
    const diagDetail = guard.finding?.explanation ? `${guard.finding.title}：${guard.finding.explanation}` : '当前案例后端诊断未确认父子页帧关系。';
    verdict = `未确认父子页帧结论（${diagDetail}）。下方仅展示原始抽样读数：${rawPairSummary}。`;
  } else if (!presentAllEqual) {
    verdict = rawPairSummary + '。';
  } else if (parentSample.phase === 'fork_shared') {
    verdict = splitCount === 0 && sharedCount === rows.length && rows.length > 0
      ? `物理页帧实锤：fork 后父子 ${sharedCount}/${rows.length} 个抽样页的 PFN 完全一致——虽然各有独立页表，底层仍指向同一批物理页框。`
      : `fork 后抽样比对：${sharedCount} 页同 PFN 共享，${splitCount} 页 PFN 不同。`;
  } else if (cowInfo?.written_pages === 0) {
    verdict = splitCount === 0 && sharedCount === rows.length && rows.length > 0
      ? `零改写对照实锤：子进程未写入任何页，父子 ${sharedCount}/${rows.length} 个抽样页 PFN 仍 100% 相同，未发生物理页复制。`
      : `零改写对照：${sharedCount} 页共享同 PFN，${splitCount} 页 PFN 不同。`;
  } else if (expectedMatch && splitCount > 0 && sharedCount > 0) {
    verdict = `写时复制物理页分裂实锤：子进程改写的 ${splitCount} 个抽样页 PFN 全部与父进程分叉（已独立复制新物理页），未改写的 ${sharedCount} 个抽样页 PFN 仍与父进程完全一致（继续共享）。`;
  } else if (expectedMatch && splitCount === rows.length && rows.length > 0) {
    verdict = `全量改写实锤：全部 ${splitCount}/${rows.length} 个抽样页的父子 PFN 均已分叉，每页都获得了独立物理页框。`;
  } else {
    verdict = `父子同址抽样核对：${splitCount} 页 PFN 已分叉（复制），${sharedCount} 页 PFN 仍相同（共享）。`;
  }

  return {
    mode: 'pair',
    status: parentPm.status === 'available' && childPm.status === 'available' ? 'available' : 'error',
    pfn_access: pairAccess,
    parent_source: parentPm.source,
    child_source: childPm.source,
    rows,
    shared_count: sharedCount,
    split_count: splitCount,
    masked_count: maskedCount,
    not_present_count: notPresentCount,
    partial_count: partialCount,
    parent_present_count: parentPm.present_count,
    child_present_count: childPm.present_count,
    present_all_equal: presentAllEqual,
    parent_only_present_pages: parentOnlyPresentPages,
    child_only_present_pages: childOnlyPresentPages,
    expected_match: !guard.blocked && expectedMatch,
    diagnosis_blocked: guard.blocked,
    verdict
  };
}

/**
 * 格式化单侧页表采样状态：严格区分“未采到”（读取失败/无样本）与“0/N 页驻留”（实测为零）。
 * @param {object|null} pm
 * @param {string} label
 * @returns {string}
 */
function formatSideCapture(pm, label) {
  if (!pm) return `${label}未采到`;
  if (pm.status === 'unmapped') return `${label}无目标映射`;
  if (pm.status !== 'available' || pm.sampled_count === 0) {
    return `${label}未采到${pm.reason ? `（${pm.reason}）` : ''}`;
  }
  return `${label} ${pm.present_count}/${pm.sampled_count} 页驻留`;
}

function pairedPfnAccess(sides) {
  const observed = sides.filter(pm => pm?.status === 'available' && pm.present_count > 0);
  if (observed.some(pm => pm.pfn_access === 'masked')) return 'masked';
  return observed.some(pm => pm.pfn_access === 'visible') ? 'visible' : 'not_applicable';
}

/**
 * 并排对比 THP 关闭大页与请求大页两组在跨 2 MiB 边界哨兵页上的页表状态。
 * @param {object|null|undefined} offSample 关闭/禁止组采样
 * @param {object|null|undefined} onSample 开启/允许组采样
 * @param {Array<string>} labels 两侧组别标签
 * @param {object|null|undefined} context 可选 { caseRecord, peerCaseRecord, findings }
 * @returns {object|null}
 */
export function compareThpPagemap(offSample, onSample, labels = ['关闭大页', '请求大页'], context = null) {
  const offPm = normalizePagemap(offSample);
  const onPm = normalizePagemap(onSample);
  if (!offPm && !onPm) return null;

  const offAvailable = Boolean(offPm && offPm.status === 'available' && offPm.sampled_count > 0);
  const onAvailable = Boolean(onPm && onPm.status === 'available' && onPm.sampled_count > 0);
  const guard = resolveDiagnosisGuard(context);
  const allowHugeAttribution = !guard.caseBlocked && offAvailable && onAvailable;

  const offMap = new Map((offAvailable ? offPm.entries : []).map(e => [e.page_index, e]));
  const onMap = new Map((onAvailable ? onPm.entries : []).map(e => [e.page_index, e]));
  const indices = [...new Set([...offMap.keys(), ...onMap.keys()])].sort((a, b) => a - b);

  const rows = indices.map(idx => {
    const offEntry = offMap.get(idx) || null;
    const onEntry = onMap.get(idx) || null;
    const expectedWritten = onEntry?.expected_written ?? offEntry?.expected_written ?? null;
    const collateralHugeResident = offAvailable && onAvailable &&
      expectedWritten === false && Boolean(onEntry?.present) && offEntry?.present === false;
    return {
      page_index: idx,
      label: onEntry?.label || offEntry?.label || `第 ${idx} 页`,
      expected_written: expectedWritten,
      off: offEntry,
      on: onEntry,
      collateral_huge_resident: collateralHugeResident
    };
  });

  const offBlocks = offAvailable ? checkHugePageContiguity(offPm.entries, offPm.pfn_access, offPm.page_bytes) : [];
  const onBlocks = onAvailable ? checkHugePageContiguity(onPm.entries, onPm.pfn_access, onPm.page_bytes) : [];
  const onContiguousCount = onBlocks.filter(b => b.status === 'contiguous_2mib_verified').length;
  const collateralCount = rows.filter(r => r.collateral_huge_resident).length;

  let overallStatus = 'unavailable';
  if (offAvailable && onAvailable) overallStatus = 'available';
  else if (offAvailable || onAvailable) overallStatus = 'partial';
  else if (offPm?.status === 'unmapped' && onPm?.status === 'unmapped') overallStatus = 'unmapped';

  let verdict = '';
  if (overallStatus === 'unmapped') {
    verdict = '当前阶段两组目标映射尚未建立或已经释放，不读取页表项。';
  } else if (!offAvailable && !onAvailable) {
    verdict = `${formatSideCapture(offPm, labels[0])}，${formatSideCapture(onPm, labels[1])}。这一步没有可比较的页表读数，可以查看 smaps 原文。`;
  } else if (offAvailable !== onAvailable) {
    const invalidHint = guard.caseBlocked ? '本组对照的证据不完整。' : '';
    verdict = `${formatSideCapture(offPm, labels[0])}，${formatSideCapture(onPm, labels[1])}。${invalidHint}下方列出了采到的那一组，供逐页查看。`;
  } else if (guard.caseBlocked) {
    verdict = '至少一侧案例校验未通过或证据不完整，下方仅并排展示原始抽样页表读数，不作为大页驻留或对照确认依据。';
  } else if (collateralCount > 0) {
    verdict = `有 ${collateralCount} 个未写的邻页，在「${labels[0]}」组 Present = 0，在「${labels[1]}」组 Present = 1。`;
    if (onSample.huge_kib > 0) verdict += `后者的 smaps 同时记录了 ${onSample.huge_kib} KiB 匿名大页。`;
  } else if (onContiguousCount > 0) {
    verdict = `「${labels[1]}」组在 ${onContiguousCount} 个 2 MiB 区间里，抽到的页帧号都与各页的偏移吻合。`;
    if (onSample.huge_kib > 0) verdict += `该映射的 AnonHugePages 为 ${onSample.huge_kib} KiB。`;
  } else {
    verdict = `${formatSideCapture(offPm, labels[0])}，${formatSideCapture(onPm, labels[1])}。`;
  }

  return {
    status: overallStatus,
    labels,
    off: offPm,
    on: onPm,
    off_available: offAvailable,
    on_available: onAvailable,
    rows,
    off_blocks: offBlocks,
    on_blocks: onBlocks,
    on_contiguous_count: onContiguousCount,
    collateral_count: collateralCount,
    allow_huge_attribution: allowHugeAttribution,
    diagnosis_blocked: guard.caseBlocked,
    verdict
  };
}

/**
 * 渲染权限与数据源徽标。
 */
function accessBadge(status, pfnAccess) {
  if (status === 'unmapped') return '<span class="pte-badge is-muted">无目标映射</span>';
  if (status === 'partial') return '<span class="pte-badge is-warn">单侧 pagemap 未采到</span>';
  if (status !== 'available') return '<span class="pte-badge is-warn">pagemap 不可读</span>';
  if (pfnAccess === 'visible') return '<span class="pte-badge is-ok">Present + PFN 可见（CAP_SYS_ADMIN）</span>';
  if (pfnAccess === 'masked') return '<span class="pte-badge is-info">状态位可读 · PFN 已被内核屏蔽</span>';
  return '<span class="pte-badge is-muted">Present 位已核对（尚无驻留页）</span>';
}

/**
 * 渲染 2 MiB 连续性校验摘要徽标。
 */
function hugeContiguityNote(blocks) {
  if (!blocks?.length) return '';
  const verified = blocks.filter(b => b.status === 'contiguous_2mib_verified');
  const mixed = blocks.filter(b => b.status === 'base_4k_mixed');
  const nonContig = blocks.filter(b => b.status === 'non_contiguous_4k');
  const masked = blocks.filter(b => b.status === 'present_only_pfn_masked');
  if (verified.length) {
    const sampleBlock = verified[0];
    return `<p class="pte-contiguity is-huge"><strong>抽样 PFN 符合 2 MiB 对齐关系</strong>。区间 ${sampleBlock.blockIndex} 中抽到 ${sampleBlock.sampled} 页，页帧号均等于对齐基址 <code>${esc(formatHex(sampleBlock.basePfn))}</code> 加页内序号。</p>`;
  }
  if (nonContig.length) {
    return '<p class="pte-contiguity">同一区间抽到的页帧号未全部符合 2 MiB 对齐和偏移关系。</p>';
  }
  if (mixed.length) {
    return '<p class="pte-contiguity">同一 2 MiB 区间内，有的抽样页已驻留，有的还未驻留。</p>';
  }
  if (masked.length) {
    return `<p class="pte-contiguity">2 MiB 块内抽样页均已驻留（Present = 1）；因非特权下 PFN 被屏蔽，物理连续性需结合 smaps 的 AnonHugePages 或在特权环境核对。</p>`;
  }
  return '';
}

/**
 * 组合紧凑的页标签，避免当 label 默认为“第 N 页”时出现“#0 第 0 页”重复。
 */
function pageTitle(pageIndex, label) {
  const fallback = `第 ${pageIndex} 页`;
  return !label || label === fallback ? fallback : `#${pageIndex} ${label}`;
}

/**
 * 渲染标准 64 位页表项原始位段明细表（按需折叠，供学生与评委验算 bit 63 / bit 62 / bit 55 / bit 0..54）。
 */
function rawEntriesTable(entries, pfnAccess) {
  if (!entries?.length) return '';
  return `<details class="secondary-fold pte-raw-fold"><summary>展开 64 位页表项位段明细（${entries.length} 个抽样页）</summary>
    ${table(
      ['抽样页', '虚拟地址', '写状态', '位段 (P/Sw/SD)', 'PFN (bit 0..54)', '原始 64 位项'],
      entries.map(e => [
        pageTitle(e.page_index, e.label),
        formatHex(e.vaddr),
        e.expected_written === null ? '—' : (e.expected_written ? '已写' : '未写'),
        `P=${e.present ? '1' : '0'} · Sw=${e.swapped ? '1' : '0'} · SD=${e.soft_dirty === null ? '—' : (e.soft_dirty ? '1' : '0')}`,
        !e.present ? '—' : (pfnAccess === 'visible' && e.pfn ? formatHex(e.pfn) : '已屏蔽（需 root）'),
        formatHex(e.raw_hex)
      ])
    )}
    <p class="detail-copy">位段含义：<code>P</code> = Present (bit 63)、<code>Sw</code> = Swapped (bit 62)、<code>SD</code> = Soft-Dirty (bit 55)。读取 <code>/proc/&lt;pid&gt;/pagemap</code> 不访问目标虚拟内存本身，不会人为触发缺页异常。</p>
  </details>`;
}

/**
 * 历史旧记录（不含 pagemap）的极简克制降级提示，避免误导或破坏页面。
 */
function legacyPagemapNote(hint) {
  return `<p class="pagemap-legacy-note" data-pagemap-state="absent">页表项观测（<code>/proc/pid/pagemap</code>）：本份历史记录由旧版探针采集，尚未包含逐页 PTE 采样；${esc(hint)}</p>`;
}

/**
 * 渲染 3.3 按需调页（单组或 THP 对照双组）页表项观测面板。
 * @param {object|null} sample 主采样
 * @param {object} options { pairSamples?: [offSample, onSample], pairLabels?: [string, string] }
 * @returns {string}
 */
export function renderDemandPagemapPanel(sample, options = {}) {
  const { pairSamples = null, pairLabels = ['禁用大页建议', '使用大页建议'], caseRecord = null, peerCaseRecord = null, findings = null } = options;
  const context = (caseRecord || peerCaseRecord || findings) ? { caseRecord, peerCaseRecord, findings } : null;
  if (pairSamples && pairSamples.length === 2) {
    const compared = compareThpPagemap(pairSamples[0], pairSamples[1], pairLabels, context);
    if (!compared) {
      return legacyPagemapNote('新版探针采集后将在此并排展示两组哨兵页 Present 状态与 2 MiB PFN 连续性核验。');
    }
    return renderThpPagemapPanel(pairSamples, pairLabels, '3.3 页表项（PTE）双组核验', context);
  }

  const info = inspectDemandPagemap(sample, context);
  if (!info) {
    return legacyPagemapNote('新版探针采集后将在此展示各哨兵页的驻留位（Present）与物理页帧（PFN）变化。');
  }

  const grid = info.entries.length
    ? `<ol class="pte-grid" aria-label="抽样虚拟页 Present 状态">${info.entries.map(e => {
      const stateCls = e.present ? 'is-present' : 'is-absent';
      const writeTag = e.expected_written === true ? '已写' : e.expected_written === false ? '未写' : '';
      const pfnLine = !e.present
        ? '<span class="pte-pfn">无物理页</span>'
        : info.pfn_access === 'visible' && e.pfn
          ? `<span class="pte-pfn" title="PFN ${esc(formatHex(e.pfn))}">PFN ${esc(compactPfn(e.pfn))}</span>`
          : '<span class="pte-pfn is-masked">PFN 已屏蔽</span>';
      return `<li class="pte-cell ${stateCls}">
        <div class="pte-cell-head"><span class="pte-idx">#${e.page_index}</span>${writeTag ? `<span class="pte-write-tag ${e.expected_written ? 'is-written' : ''}">${writeTag}</span>` : ''}</div>
        <strong class="pte-bit">P = ${e.present ? '1' : '0'}</strong>
        <span class="pte-label">${esc(e.label)}</span>
        ${pfnLine}
      </li>`;
    }).join('')}</ol>`
    : '';

  return `<section class="pagemap-panel" data-pagemap-state="${esc(info.status)}" aria-label="页表项与物理页帧观测">
    <div class="pagemap-head">
      <div><span class="pagemap-kicker">页表层实证 · /proc/pid/pagemap</span><h3>逐页 Present 位与物理页帧核验</h3></div>
      ${accessBadge(info.status, info.pfn_access)}
    </div>
    <p class="pagemap-verdict">${esc(info.verdict)}</p>
    ${info.status === 'available' ? `<div class="pagemap-counters">
      <span>抽样哨兵页 <strong>${info.sampled_count}</strong> 页</span>
      <span>Present = 1：<strong>${info.present_count}</strong> 页</span>
      <span>Present = 0：<strong>${info.not_present_count}</strong> 页</span>
      ${info.swapped_count ? `<span>Swapped：<strong>${info.swapped_count}</strong> 页</span>` : ''}
    </div>` : ''}
    ${grid}
    ${info.case_blocked ? '' : hugeContiguityNote(info.huge_blocks)}
    ${rawEntriesTable(info.entries, info.pfn_access)}
  </section>`;
}

/**
 * 渲染 COW 写时复制页表项与父子 PFN 对照面板。
 * @param {object|null} sample 当前步骤采样
 * @param {object|null} peerSample 对侧进程采样（若当前为 fork_shared / child_write）
 * @param {object|null} cowInfo 案例 data.cow
 * @returns {string}
 */
export function renderCowPagemapPanel(sample, peerSample = null, cowInfo = null, context = null) {
  const result = compareCowPagemap(sample, peerSample, cowInfo, context);
  if (!result) {
    return legacyPagemapNote('新版探针采集后将在此直接比对父子进程同一虚拟地址的 PFN，实锤共享零页与写时物理页分裂。');
  }

  if (result.mode === 'single') {
    const grid = result.entries.length
      ? `<ol class="pte-grid" aria-label="COW 单进程抽样页状态">${result.entries.map(e => {
        const cls = !e.present ? 'is-absent' : (result.shared_zero_confirmed ? 'is-zero-shared' : 'is-present');
        const pfnText = !e.present
          ? '无物理页'
          : result.pfn_access === 'visible' && e.pfn
            ? `PFN ${compactPfn(e.pfn)}`
            : 'PFN 已屏蔽';
        return `<li class="pte-cell ${cls}">
          <div class="pte-cell-head"><span class="pte-idx">#${e.page_index}</span></div>
          <strong class="pte-bit">P = ${e.present ? '1' : '0'}</strong>
          <span class="pte-label">${esc(e.label)}</span>
          <span class="pte-pfn" title="${esc(formatHex(e.pfn))}">${esc(pfnText)}</span>
        </li>`;
      }).join('')}</ol>`
      : '';
    return `<section class="pagemap-panel" data-pagemap-state="${esc(result.status)}" data-cow-pagemap="single" aria-label="页表项与物理页帧观测">
      <div class="pagemap-head">
        <div><span class="pagemap-kicker">页表层实证 · /proc/pid/pagemap</span><h3>${result.shared_zero_confirmed ? '共享零页物理帧核验' : '逐页 Present 与物理页帧（PFN）'}</h3></div>
        ${accessBadge(result.status, result.pfn_access)}
      </div>
      <p class="pagemap-verdict">${esc(result.verdict)}</p>
      ${grid}
      ${rawEntriesTable(result.entries, result.pfn_access)}
    </section>`;
  }

  // 双进程配对模式：父子同址 PFN 共享/分裂对照矩阵
  const relationMeta = {
    shared_same_pfn: { cls: 'is-shared', symbol: '＝ 共享同 PFN', short: '共享' },
    split_diff_pfn: { cls: 'is-split', symbol: '≠ PFN 已分裂', short: '分裂复制' },
    pfn_masked: { cls: 'is-masked', symbol: 'PFN 已屏蔽', short: '需 root' },
    not_present: { cls: 'is-absent', symbol: '未驻留', short: '未驻留' },
    partial: { cls: 'is-absent', symbol: '单侧缺失', short: '缺失' }
  };

  const relationSymbolFor = row => {
    if (row.relation === 'not_present') {
      if (row.parent?.present && !row.child?.present) return '仅父驻留';
      if (!row.parent?.present && row.child?.present) return '仅子驻留';
      return '均未驻留';
    }
    return (relationMeta[row.relation] || relationMeta.partial).symbol;
  };

  const matrix = result.rows.length
    ? `<ol class="cow-pfn-grid" aria-label="父子进程同址 PFN 对照">${result.rows.map(row => {
      const meta = relationMeta[row.relation] || relationMeta.partial;
      const symbol = relationSymbolFor(row);
      const pPfn = !row.parent ? '缺失' : !row.parent.present ? 'P=0' : (result.pfn_access === 'visible' ? compactPfn(row.parent.pfn) : 'P=1 · 屏蔽');
      const cPfn = !row.child ? '缺失' : !row.child.present ? 'P=0' : (result.pfn_access === 'visible' ? compactPfn(row.child.pfn) : 'P=1 · 屏蔽');
      const writeTag = row.expected_written === true ? '<span class="pte-write-tag is-written">子进程改写</span>'
        : row.expected_written === false ? '<span class="pte-write-tag">未改写</span>' : '';
      return `<li class="cow-pfn-card ${meta.cls}">
        <div class="pte-cell-head"><span class="pte-idx">第 ${row.page_index} 页</span>${writeTag}</div>
        <div class="cow-pfn-pair">
          <div class="cow-pfn-side"><span>父 PFN</span><code title="${esc(formatHex(row.parent?.pfn))}">${esc(pPfn)}</code></div>
          <div class="cow-pfn-link" aria-label="${esc(symbol)}">${esc(symbol)}</div>
          <div class="cow-pfn-side"><span>子 PFN</span><code title="${esc(formatHex(row.child?.pfn))}">${esc(cPfn)}</code></div>
        </div>
      </li>`;
    }).join('')}</ol>`
    : '';

  const formatCowSide = entry => !entry
    ? '缺失'
    : (entry.present ? (result.pfn_access === 'visible' && entry.pfn ? formatHex(entry.pfn) : 'Present=1（PFN屏蔽）') : 'Present=0');
  const detailRows = result.rows.map(row => [
    pageTitle(row.page_index, row.label),
    formatHex(row.vaddr),
    row.expected_written === null ? '—' : (row.expected_written ? '子进程改写' : '保持原样'),
    formatCowSide(row.parent),
    formatCowSide(row.child),
    relationSymbolFor(row)
  ]);

  const pairCounters = [
    `<span>配对抽样 <strong>${result.rows.length}</strong> 页</span>`,
    ...(result.pfn_access === 'visible' ? [
      `<span class="counter-shared">同 PFN 共享：<strong>${result.shared_count}</strong> 页</span>`,
      `<span class="counter-split">异 PFN 分裂：<strong>${result.split_count}</strong> 页</span>`
    ] : result.pfn_access === 'masked' ? [
      `<span>PFN 屏蔽：<strong>${result.masked_count}</strong> 页</span>`
    ] : []),
    ...(result.not_present_count ? [`<span>至少一方未驻留：<strong>${result.not_present_count}</strong> 页</span>`] : []),
    ...(result.partial_count ? [`<span>单侧缺失：<strong>${result.partial_count}</strong> 页</span>`] : [])
  ].join('');

  return `<section class="pagemap-panel" data-pagemap-state="${esc(result.status)}" data-cow-pagemap="pair" aria-label="父子进程物理页帧 COW 对照">
    <div class="pagemap-head">
      <div><span class="pagemap-kicker">页表层实证 · 父子同步 /proc/pid/pagemap</span><h3>父子同虚拟地址物理页帧（PFN）对照</h3></div>
      ${accessBadge(result.status, result.pfn_access)}
    </div>
    <p class="pagemap-verdict">${esc(result.verdict)}</p>
    <div class="pagemap-counters">${pairCounters}</div>
    ${matrix}
    ${detailRows.length ? `<details class="secondary-fold pte-raw-fold"><summary>展开父子 PFN 逐页比对表（${detailRows.length} 页）</summary>
      ${table(['抽样页', '虚拟地址', '本步预期', '父进程 PFN', '子进程 PFN', '物理页关系'], detailRows)}
      <p class="detail-copy">数据源：父进程 <code>${esc(result.parent_source || '—')}</code>，子进程 <code>${esc(result.child_source || '—')}</code>。父进程在子进程阻塞等待管道指令时同步读取两侧页表，无竞态。</p>
    </details>` : ''}
  </section>`;
}

/**
 * 渲染 THP 透明大页（及 3.3 双组对照）跨 2 MiB 边界哨兵页并排对比面板。
 * @param {Array<object|null>} samples [offSample, onSample]
 * @param {Array<string>} labels [关闭组名, 请求组名]
 * @param {string} heading 标题
 * @returns {string}
 */
export function renderThpPagemapPanel(samples, labels = ['关闭大页', '请求大页'], heading = '跨 2 MiB 边界哨兵页表对照', context = null) {
  const compared = compareThpPagemap(samples?.[0], samples?.[1], labels, context);
  if (!compared) {
    return legacyPagemapNote('新版探针采集后将在此并排展示同一 2 MiB 块内未写邻页的 Present 扩散与 PFN 连续对齐核验。');
  }

  const pfnStatus = pairedPfnAccess([compared.off, compared.on]);
  const allowHuge = compared.allow_huge_attribution;

  const rowsHtml = compared.rows.map(row => {
    const cell = (entry, pm, available) => {
      if (!available) return `<span class="thp-pte-pill is-absent">${pm?.status === 'unmapped' ? '无映射' : '未采到'}</span>`;
      if (!entry) return '<span class="thp-pte-pill is-absent">缺失</span>';
      if (!entry.present) return '<span class="thp-pte-pill is-absent">P = 0</span>';
      const pfnPart = pm?.pfn_access === 'visible' && entry.pfn ? ` · ${compactPfn(entry.pfn)}` : '';
      const highlight = allowHuge && row.collateral_huge_resident && pm === compared.on ? ' is-collateral' : ' is-present';
      return `<span class="thp-pte-pill${highlight}" title="${esc(formatHex(entry.pfn))}">P = 1${esc(pfnPart)}</span>`;
    };
    const tag = row.expected_written === true
      ? '<span class="pte-write-tag is-written">程序已写</span>'
      : (allowHuge && row.collateral_huge_resident)
        ? `<span class="pte-write-tag is-huge">${samples[1]?.huge_kib > 0 ? '未写 · 随大页驻留' : '未写 · 已驻留'}</span>`
        : row.expected_written === false
          ? '<span class="pte-write-tag">未写邻页</span>'
          : '';
    return `<li class="thp-pte-row${allowHuge && row.collateral_huge_resident ? ' is-collateral-row' : ''}">
      <div class="thp-pte-page"><strong>#${row.page_index}</strong><span>${esc(row.label)}</span>${tag}</div>
      <div class="thp-pte-pair">
        <div><small>${esc(labels[0])}</small>${cell(row.off, compared.off, compared.off_available)}</div>
        <div><small>${esc(labels[1])}</small>${cell(row.on, compared.on, compared.on_available)}</div>
      </div>
    </li>`;
  }).join('');

  const formatSideDetail = (entry, pm, available) => {
    if (!available) return pm?.status === 'unmapped' ? '无映射' : '未采到';
    if (!entry) return '—';
    return entry.present ? `P=1${pm?.pfn_access === 'visible' && entry.pfn ? ' · ' + formatHex(entry.pfn) : ''}` : 'P=0';
  };
  const diffLabel = row => {
    if (!compared.off_available && !compared.on_available) return '双侧未采到';
    if (!compared.off_available || !compared.on_available) return '单侧未采到';
    if (!row.off && !row.on) return '双侧缺失';
    if (!row.off || !row.on) return '单侧缺失';
    if (allowHuge && row.collateral_huge_resident) return samples[1]?.huge_kib > 0 ? '随大页驻留的邻页' : '仅请求组驻留';
    if (row.off.present === row.on.present) return '两侧一致';
    return `${labels[0]} Present=${row.off.present ? 1 : 0}，${labels[1]} Present=${row.on.present ? 1 : 0}`;
  };
  const detailRows = compared.rows.map(row => [
    pageTitle(row.page_index, row.label),
    row.expected_written === null ? '—' : (row.expected_written ? '程序写入' : '未写邻页'),
    formatSideDetail(row.off, compared.off, compared.off_available),
    formatSideDetail(row.on, compared.on, compared.on_available),
    diffLabel(row)
  ]);

  const offNonContig = compared.off_blocks.some(b => b.status === 'non_contiguous_4k');
  const onVerified = compared.on_blocks.find(b => b.status === 'contiguous_2mib_verified');
  const contiguityHtml = !allowHuge
    ? ''
    : (offNonContig && onVerified
      ? `<p class="pte-contiguity is-huge"><strong>双组 2 MiB 物理连续性对照</strong>。「${esc(labels[0])}」组的抽样 PFN 未全部符合对齐关系。「${esc(labels[1])}」组区间 ${onVerified.blockIndex} 中，${onVerified.sampled} 个抽样 PFN 都等于对齐基址 <code>${esc(formatHex(onVerified.basePfn))}</code> 加页内序号。</p>`
      : hugeContiguityNote(compared.on_blocks));

  return `<section class="pagemap-panel" data-pagemap-state="${esc(compared.status)}" data-thp-pagemap="pair" aria-label="透明大页页表项对照">
    <div class="pagemap-head">
      <div><span class="pagemap-kicker">页表层实证 · /proc/pid/pagemap</span><h3>${esc(heading)}</h3></div>
      ${accessBadge(compared.status, pfnStatus)}
    </div>
    <p class="pagemap-verdict">${esc(compared.verdict)}</p>
    ${rowsHtml ? `<ol class="thp-pte-list" aria-label="两组抽样哨兵页对照">${rowsHtml}</ol>` : ''}
    ${contiguityHtml}
    ${detailRows.length ? `<details class="secondary-fold pte-raw-fold"><summary>展开两组哨兵页明细（${detailRows.length} 页）</summary>
      ${table(['哨兵页', '写入角色', labels[0], labels[1], '页表差异'], detailRows)}
    </details>` : ''}
  </section>`;
}

/**
 * 为学习报告 HTML 导出提供单行页表项汇总（无 pagemap 数据时返回 null，完全不改动旧报告输出）。
 * @param {object|null|undefined} sample
 * @returns {string|null}
 */
export function pagemapReportSummary(sample) {
  const info = inspectDemandPagemap(sample);
  if (!info) return null;
  if (info.status === 'unmapped') return '无目标映射（未采样）';
  if (info.status !== 'available') return `不可读（${info.reason || info.status}）`;
  const pfnLabel = info.pfn_access === 'visible' ? 'PFN 可见' : info.pfn_access === 'masked' ? 'PFN 已屏蔽' : '无驻留页';
  const hugeVerified = info.huge_blocks.some(b => b.status === 'contiguous_2mib_verified');
  return `${info.present_count}/${info.sampled_count} 哨兵页 Present=1 · ${pfnLabel}${hugeVerified ? ' · 抽样 PFN 符合 2 MiB 对齐关系' : ''}`;
}
