"""Offline HTML/JSON/CSV exports from freshly verified historical evidence."""
import csv
import html
import io
import json
from pathlib import Path

from .common import write_json
from .replay import load_run

LABELS = {"confirmed": "已确认", "probable": "可能原因", "insufficient_evidence": "证据不足"}


def csv_text(report):
    out = io.StringIO(newline="")
    fields = ["run_id", "data_origin", "view_mode", "case_id", "suite", "scope", "requested_kib", "address", "program_break", "written_positions", "mapping_present", "cow_fraction", "cow_written_pages", "cow_total_pages", "phase", "role", "size_kib", "rss_kib", "pss_kib", "private_dirty_kib", "shared_dirty_kib", "huge_kib", "swap_kib", "kernel_page_kib", "action_minor", "action_major"]
    fields += ["course_code", "process_thp", "process_thp_disabled", "status_thp_enabled", "madvise_result", "lab", "observed"]
    fields += ["run_status", "case_status", "validation_status", "run_integrity", "case_integrity", "kernel", "environment_issue", "recheck_environment"]
    fields += ["symbol", "symbol_label", "mapping_start", "mapping_end", "permissions", "pathname", "elf_object", "elf_segment_index"]
    fields += ["count", "total_minor", "total_major", "process_rss_kib", "process_size_kib"]
    fields += ["event", "pid", "tid", "time_ns", "mode", "worker", "step", "value", "expected", "heap_address", "stack_address", "child_pid", "ppid", "exit_code", "signal", "errno", "read_bytes", "write_bytes", "message", "variant", "amount", "balance", "from", "to", "first_lock", "second_lock", "from_balance", "to_balance", "stack_base", "stack_bytes"]
    fields += ["related_scope", "related_vma_count", "related_size_kib", "related_rss_kib", "related_pss_kib"]
    writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for c in report["cases"]:
        cow = (c.get("data") or {}).get("cow", {})
        condition = (c.get("data") or {}).get("condition", {})
        extra = {k: condition.get(k) for k in ("course_code", "process_thp", "process_thp_disabled", "status_thp_enabled", "madvise_result")}
        # A failed case without samples still needs a status row, not silent omission.
        for s in (c.get("data") or {}).get("samples") or [{}]:
            writer.writerow(dict(run_id=report["run_id"], data_origin=report["data_origin"], view_mode=report["view_mode"],
                                 run_status=report["status"], case_status=c["status"],
                                 validation_status=c["validation"]["status"],
                                 run_integrity=report["integrity"]["status"], case_integrity=c.get("integrity"),
                                 kernel=report.get("environment", {}).get("kernel"),
                                 environment_issue="; ".join(e for e in report["integrity"].get("errors", []) if "environment" in e),
                                 recheck_environment=((report.get("related_run") or {}).get("environment_comparison") or {}).get("status"),
                                 case_id=c["id"], suite=c["suite"], cow_fraction=cow.get("fraction"),
                                 cow_written_pages=cow.get("written_pages"), cow_total_pages=cow.get("total_pages"), **extra, **s))
    return out.getvalue()


def html_text(report):
    esc = lambda value: html.escape(str(value))
    rows = []
    for case in report["cases"]:
        if case["suite"] in ("layout", "sync", "io") or case["suite"].startswith("g4-"):
            continue
        for s in (case.get("data") or {}).get("samples", []):
            cells = [case["id"], s["phase"], s["role"], s.get("scope", "exact_vma"), s["rss_kib"], s["pss_kib"], s["huge_kib"], s["action_minor"]]
            rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
    findings = []
    for f in report["diagnosis"]["findings"]:
        steps = "".join(f"<li>{esc(step)}</li>" for step in f.get("next_steps", []))
        findings.append(f"<article><h3>{esc(LABELS[f['confidence']])} · {esc(f['title'])}</h3><p>{esc(f['explanation'])}</p><ol>{steps}</ol><details><summary>判断依据</summary><p>{esc(f['limitations'])}</p><pre>{esc(json.dumps(f['evidence'], ensure_ascii=False, indent=2))}</pre></details></article>")
    metadata = {k: report.get(k) for k in ("run_id", "data_origin", "view_mode", "status", "integrity", "environment", "trace_tool", "related_run", "original_report_sha256", "sources")}
    cow_rows = []
    for item in report["diagnosis"].get("cow_observations", []):
        cells = [item["case_id"], item["fraction"], f"{item['written_pages']}/{item['total_pages']}",
                 item["expected_pss_kib"], item["observed_pss_kib"], "已确认观测" if item["confirmed"] else "未确认"]
        cow_rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
    cow_section = ("<h2>COW 写入量与目标区域 PSS 合计</h2><p>预期值基于本实验的受控条件；不是逐物理页复制证据。单位 KiB。</p>"
                   "<table><tr><th>实验</th><th>写入比例</th><th>写入页数/总页数</th><th>预计</th><th>实测</th><th>校验</th></tr>"
                   + "".join(cow_rows) + "</table>") if cow_rows else ""
    policy_rows = []
    task_rows = []
    for case in report["cases"]:
        c = (case.get("data") or {}).get("condition", {})
        if "process_thp" in c:
            cells = [case["id"], c["process_thp"], c["process_thp_disabled"], c["status_thp_enabled"], c["madvise_result"]]
            policy_rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
        if case["suite"] == "course":
            task_rows.append(f"<li>{esc(case['id'])} · {esc(c.get('course_code', 'legacy_reference'))} · {esc(case['validation']['status'])}<pre>{esc(json.dumps(case['validation']['checks'],ensure_ascii=False,indent=2))}</pre></li>")
    policy_section = ("<h2>进程级 THP 原始条件</h2><p>allow 表示解除进程级禁用，不保证实际分配大页。disable 为受控人为禁用。建议返回 0 表示调用成功。</p><table><tr><th>案例</th><th>操作</th><th>GET_THP_DISABLE</th><th>THP_enabled</th><th>建议返回</th></tr>" + "".join(policy_rows) + "</table>") if policy_rows else ""
    task_section = ("<h2>课程任务动作检查</h2><p>检查不代表理解程度，学生笔记另行导出。</p><details><summary>展开逐项检查</summary><ul>" + "".join(task_rows) + "</ul></details>") if task_rows else ""
    layout_rows, segment_rows = [], []
    for case in report["cases"]:
        if case["suite"] != "layout":
            continue
        for s in (case.get("data") or {}).get("samples", []):
            cells = [case["id"], s["symbol_label"], "0x" + s["address"], s["permissions"],
                     s["mapping_header"], s["elf_object"] or "非 ELF 装载段", s["elf_segment_index"]]
            layout_rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
        for s in (case.get("data") or {}).get("segments", []):
            cells = [case["id"], s["object"], s["index"], s["load_bias"], s["vaddr"], s["start"], s["end"], s["flags"], "\n".join(s["mappings"])]
            segment_rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
    layout_section = ("<h2>程序地址与映射</h2><p>地址均为虚拟地址。每个地址关联其所在的整个 VMA；相同 VMA 的内存统计不可按变量重复相加。</p>"
                      "<table><tr><th>案例</th><th>程序对象</th><th>地址</th><th>权限</th><th>原始映射头</th><th>ELF 对象</th><th>段编号</th></tr>"
                      + "".join(layout_rows) + "</table><h3>加载后的 ELF PT_LOAD</h3><p>运行起点 = 装载基址 + ELF 段虚拟地址。一个段可跨多条映射。地址列使用十六进制。</p>"
                      "<table><tr><th>案例</th><th>对象</th><th>段</th><th>基址</th><th>ELF 地址</th><th>运行起点</th><th>终点</th><th>段权限</th><th>相交映射</th></tr>"
                      + "".join(segment_rows) + "</table>") if layout_rows else ""
    group3_section = "".join("<details><summary>" + esc(c["id"]) + " · 第3组原课例证据</summary><pre>" + esc(json.dumps(c.get("data"),ensure_ascii=False,indent=2)) + "</pre></details>" for c in report["cases"] if c["suite"] in ("link-dynamic","link-static","sequence","demand512","stack"))
    group4_section = "".join("<details><summary>" + esc(c["id"]) + " · 进程/线程事件</summary><pre>" + esc(json.dumps(c.get("data"),ensure_ascii=False,indent=2)) + "</pre></details>" for c in report["cases"] if c["suite"].startswith("g4-"))
    systems_section = "".join("<h3>实验 " + esc(c["parameters"]["lab"]) + " · 第 " + esc(c["parameters"]["repeat"])
        + " 次</h3><p>动作核对 · " + esc(c["validation"]["status"]) + "</p><dl>" + "".join(
        "<dt>" + esc(row["phase"]) + "</dt><dd><pre>" + esc(row["observed"]) + "</pre></dd>"
        for row in (c.get("data") or {}).get("samples", [])) + "</dl>"
        for c in report["cases"] if c["suite"] in ("sync", "io"))
    mapping_rows = []
    sequence_rows = []
    for case in report["cases"]:
        if case["suite"] != "sequence":
            continue
        data = case.get("data") or {}
        for region in data.get("overview", {}).get("regions", []):
            cells = [case["id"], " + ".join("块 " + str(n) for n in region["blocks"]),
                     region["start"] + "–" + region["end"], region["size_kib"], region["rss_kib"]]
            mapping_rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
        for action in data.get("actions", []):
            cells = [case["id"], action["action"], action.get("requested_bytes", "释放全部"),
                     action.get("returned_address", "—"), f"{action['begin_line']}–{action['end_line']}",
                     "\n".join(f"L{e['line']}: {e['text']}" for e in action["events"]) or "该动作内无内存管理调用"]
            sequence_rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
    sequence_section = ("<h2>连续三次 malloc 与系统调用</h2><p>同一进程同时保留三个块，然后全部释放。行号对应各案例 syscalls.txt；启动和采样调用不计入动作区间。未写入用户数据，RSS 不应等同申请大小。</p><table><tr><th>案例</th><th>动作</th><th>申请字节</th><th>返回地址（十六进制）</th><th>标记行号</th><th>原始调用与返回值</th></tr>" + "".join(sequence_rows) + "</table>") if sequence_rows else ""
    if mapping_rows:
        sequence_section = ("<h2>三个块分别落在哪里？</h2><p>第三次申请后，按地址范围将块归到各自的映射。每段的大小和驻留量只计一次。</p>"
                            "<table><tr><th>案例</th><th>内存块</th><th>虚拟地址区间</th><th>映射 KiB</th><th>驻留 KiB</th></tr>"
                            + "".join(mapping_rows) + "</table>") + sequence_section
    title = "操作系统课程实验报告" if systems_section else "虚拟内存实验报告"
    memory_section = ("<h2>动作与真实观测</h2><p>内存单位 KiB。course 的 overlapping_vmas 为与申请范围相交的整个映射合计，可能含其他对象。第3组新增案例为地址所在整个映射；baseline/THP为隔离目标 VMA。缺页增量属于整个进程。</p>"
                      "<table><thead><tr><th>实验</th><th>动作阶段</th><th>角色</th><th>统计范围</th><th>RSS</th>"
                      "<th>PSS</th><th>AnonHugePages</th><th>次缺页</th></tr></thead><tbody>"
                      + "".join(rows) + "</tbody></table>") if rows else ""
    references = "" if systems_section and not rows else ("<h2>接口依据</h2><ul>" + "".join(
        f'<li><a href="{esc(ref)}">{esc(ref)}</a></li>' for ref in report["diagnosis"]["references"]) + "</ul>")
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title>
<style>body{{font:16px/1.65 system-ui,sans-serif;max-width:1200px;margin:40px auto;padding:0 24px;color:#183036}}h1,h2{{line-height:1.3}}article{{border-top:1px solid #d9e3e3;padding:12px 0}}table{{border-collapse:collapse;font-size:13px;width:100%}}td,th{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}}.label{{padding:12px;background:#eaf4f1}}@media print{{details{{display:block}}body{{margin:0}}}}</style>
<h1>{title}</h1><p class="label">历史回放 · 来源：{esc(report['data_origin'])} · 原执行状态：{esc(report['status'])} · 证据校验：{esc(report['integrity']['status'])}</p>
<p>回放时间：{esc(report['replayed_at'])}。</p>
<details><summary>运行环境与来源</summary><pre>{esc(json.dumps(metadata, ensure_ascii=False, indent=2))}</pre></details>
{layout_section}{sequence_section}{group3_section}{group4_section}{systems_section}{cow_section}{policy_section}{task_section}
{memory_section}{'<h2>诊断与证据边界</h2>' if findings else ''}{''.join(findings)}{references}</html>'''


def export_run(directory, destination):
    report = load_run(directory)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    write_json(destination / "report.json", report)
    (destination / "report.html").write_text(html_text(report), encoding="utf-8")
    (destination / "samples.csv").write_text(csv_text(report), encoding="utf-8-sig", newline="")
    return report
