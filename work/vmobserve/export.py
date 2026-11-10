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
    fields = ["run_id", "data_origin", "view_mode", "case_id", "suite", "phase", "role", "size_kib", "rss_kib", "pss_kib", "private_dirty_kib", "shared_dirty_kib", "huge_kib", "swap_kib", "kernel_page_kib", "action_minor", "action_major"]
    writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for c in report["cases"]:
        for s in (c.get("data") or {}).get("samples", []):
            writer.writerow(dict(run_id=report["run_id"], data_origin=report["data_origin"], view_mode=report["view_mode"], case_id=c["id"], suite=c["suite"], **s))
    return out.getvalue()


def html_text(report):
    esc = lambda value: html.escape(str(value))
    rows = []
    for case in report["cases"]:
        for s in (case.get("data") or {}).get("samples", []):
            cells = [case["id"], s["phase"], s["role"], s["rss_kib"], s["pss_kib"], s["huge_kib"], s["action_minor"]]
            rows.append("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in cells) + "</tr>")
    findings = []
    for f in report["diagnosis"]["findings"]:
        findings.append(f"<article><h3>{esc(LABELS[f['confidence']])} · {esc(f['title'])}</h3><p>{esc(f['explanation'])}</p><p>{esc(f['limitations'])}</p><details><summary>依据</summary><pre>{esc(json.dumps(f['evidence'], ensure_ascii=False, indent=2))}</pre></details></article>")
    metadata = {k: report.get(k) for k in ("run_id", "data_origin", "view_mode", "status", "integrity", "environment", "related_run", "original_report_sha256", "sources")}
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>虚拟内存实验报告</title>
<style>body{{font:16px/1.65 system-ui,sans-serif;max-width:1200px;margin:40px auto;padding:0 24px;color:#183036}}h1,h2{{line-height:1.3}}article{{border-top:1px solid #d9e3e3;padding:12px 0}}table{{border-collapse:collapse;font-size:13px;width:100%}}td,th{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}}.label{{padding:12px;background:#eaf4f1}}@media print{{details{{display:block}}body{{margin:0}}}}</style>
<h1>虚拟内存实验报告</h1><p class="label">历史回放 · 来源：{esc(report['data_origin'])} · 原执行状态：{esc(report['status'])} · 证据校验：{esc(report['integrity']['status'])}</p>
<p>只读重建于 {esc(report['replayed_at'])}。本报告未重新运行实验。QEMU TCG 结果仅用于机制和功能验证。</p>
<h2>环境与来源</h2><pre>{esc(json.dumps(metadata, ensure_ascii=False, indent=2))}</pre>
<h2>动作与真实观测</h2><p>内存单位 KiB，RSS/PSS 仅属于目标区域；缺页增量属于整个进程。</p><table><thead><tr><th>实验</th><th>动作阶段</th><th>角色</th><th>RSS</th><th>PSS</th><th>AnonHugePages</th><th>次缺页</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<h2>诊断与证据边界</h2>{''.join(findings)}<h2>接口依据</h2><ul>{''.join(f'<li><a href="{esc(url)}">{esc(url)}</a></li>' for url in report['diagnosis']['references'])}</ul></html>'''


def export_run(directory, destination):
    report = load_run(directory)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    write_json(destination / "report.json", report)
    (destination / "report.html").write_text(html_text(report), encoding="utf-8")
    (destination / "samples.csv").write_text(csv_text(report), encoding="utf-8-sig", newline="")
    return report
