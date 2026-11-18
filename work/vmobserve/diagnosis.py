"""Conservative, evidence-linked rules; no performance or page-frame claims."""

from .allocator import allocator_findings
from .layout import layout_findings
from .thp_policy import policy_comparisons
from . import group3, group4, systems

RULE_VERSION = "2026-11-13.1"
REFERENCES = ["https://docs.kernel.org/filesystems/proc.html",
              "https://docs.kernel.org/admin-guide/mm/transhuge.html",
              "https://man7.org/linux/man-pages/man2/getrusage.2.html",
              "https://man7.org/linux/man-pages/man3/dl_iterate_phdr.3.html"]


def diagnose(report):
    findings, comparisons, cow_observations = [], [], []
    def add(rule, confidence, title, explanation, evidence, limitations, recipe=None):
        item = dict(rule=rule, confidence=confidence, title=title, explanation=explanation,
                    evidence=evidence, limitations=limitations)
        if recipe:
            item["recheck"] = {"recipe": recipe, "description": ("在当前执行目标保持大页建议相同，重新运行进程允许/禁用配对；比较新旧内核和大页策略后标注复验条件。" if recipe.endswith("_process_pair") else "在当前执行目标重新运行 THP 开/关配对实验；比较新旧内核和大页策略后标注复验条件。")}
        findings.append(item)
    valid = []
    for case in report.get("cases", []):
        if (case.get("suite") == "course" and case.get("status") == "completed" and case.get("data") and
                case.get("integrity") != "failed" and case.get("validation", {}).get("status") == "failed"):
            add("course_task_incomplete", "confirmed", "采集完成，但代码任务检查未通过",
                "写入位置计数或页首值不符合任务要求。先修正访问循环，再用新记录复验。不能把这组数据当作标准动作已经完成。",
                [{"case_id": case["id"], "checks": case["validation"]["checks"], "jsonl": case["artifacts"]["jsonl"]}],
                "自动检查只覆盖规定的访问动作，不评价你是否理解按需分配。")
            continue
        if (case.get("status") != "completed" or not case.get("data") or
                case.get("validation", {}).get("status") in ("failed", "insufficient_evidence") or
                case.get("integrity") == "failed"):
            add("incomplete_evidence", "insufficient_evidence", "本次实验证据不足",
                "执行、采集或证据校验未完成，不能从缺失指标推断内存机制。",
                [{"case_id": case["id"], "status": case.get("status"), "error": case.get("error")}],
                "失败日志是故障证据，不是成功实验数据。")
            continue
        if case["suite"] in systems.SUITES:
            continue  # These observations use the per-step checks in the course replay.
        if case["suite"] == "course":
            findings.extend(allocator_findings(case))
            continue
        if case["suite"] == "layout":
            findings.extend(layout_findings(case))
            continue
        if case["suite"] in group3.SUITES:
            findings.extend(group3.findings(case))
            continue
        if case["suite"] in group4.SOURCES:
            findings.extend(group4.findings(case))
            continue
        valid.append(case)
        data = case["data"]
        s = {(x["phase"], x["role"]): x for x in data["samples"]}
        def ev(phase, role="parent", fields=("rss_kib", "pss_kib", "huge_kib", "action_minor")):
            return {"case_id": case["id"], "phase": phase, "role": role,
                    "jsonl": case["artifacts"]["jsonl"], "smaps": case["artifacts"]["smaps"],
                    "metrics": {k: s[phase, role][k] for k in fields}}
        if case["suite"] == "baseline":
            read = s["read_all", "parent"]
            if read["rss_kib"] == 0 and read["private_dirty_kib"] == 0 and read["action_minor"] > 0 and read["huge_kib"] == 0:
                add("anonymous_zero_page", "probable", "只读缺页与共享零页机制相符",
                    "只读阶段发生次缺页，目标区域 RSS 和私有脏页仍为 0；这支持匿名内存使用共享零页的解释。",
                    [ev("untouched"), ev("read_all")],
                    "没有采集物理页帧号或页错误路径；不能宣称直接观测了零页共享。RSS 不包括页表开销。")
            size = data["condition"]["mib"] * 1024
            cow = data["cow"]
            phase, written = cow["phase"], cow["written_kib"]
            pre = sum(s["fork_shared", r]["pss_kib"] for r in ("parent", "child"))
            post = sum(s[phase, r]["pss_kib"] for r in ("parent", "child"))
            rss = sum(s["fork_shared", r]["rss_kib"] for r in ("parent", "child"))
            confirmed = (pre == size and rss == 2 * size and post == size + written and data["value_check"]["ok"] and
                    case["validation"]["status"] == "passed" and
                    all(x["swap_kib"] == x["huge_kib"] == 0 for x in s.values()) and
                    all(s[phase, r]["private_dirty_kib"] == written and s[phase, r]["shared_dirty_kib"] == size - written
                        for r in ("parent", "child")))
            cow_observations.append({"case_id": case["id"], "mib": data["condition"]["mib"],
                "repeat": case["parameters"]["repeat"], "fraction": cow["fraction"],
                "written_pages": cow["written_pages"], "total_pages": cow["total_pages"],
                "expected_pss_kib": size + written, "observed_pss_kib": post, "confirmed": confirmed})
            if confirmed:
                title = "已确认共享计账与改写后的隔离" if written else "未改写时保持共享计账"
                add("cow_accounting", "confirmed", title,
                    f"fork 后 RSS 合计 {rss} KiB，但 PSS 合计 {pre} KiB；子进程改写 {cow['written_pages']}/{cow['total_pages']} 个基础页（比例 {cow['fraction']}）后，PSS 合计为 {post} KiB，预期为 {size + written} KiB，父子值校验通过。" +
                    ("受控现象符合写时复制。" if written else "这是不改写的对照，不证明发生了复制。"),
                    [ev(p, r) for p in ("fork_shared", phase) for r in ("parent", "child")],
                    "确认的是区域计账和程序值隔离，不是逐物理页的复制事件。父进程 Private_Dirty 增长也可来自共享页变为独占计账。")
        else:
            c, after = data["condition"], s["after_write", "parent"]
            if after["huge_kib"] > 0:
                add("observed_thp", "confirmed", "smaps 已记录透明大页驻留",
                    f"AnonHugePages={after['huge_kib']} KiB。KernelPageSize={after['kernel_page_kib']} KiB，不能单独用后者判断是否使用透明大页。",
                    [ev("after_write", fields=("rss_kib", "huge_kib", "kernel_page_kib", "action_minor"))],
                    "这是采样时的观测；MADV_HUGEPAGE 本身不保证大页分配。")
            elif c["thp_requested"] == "on" and c.get("process_thp_disabled") == 1 and c.get("status_thp_enabled") == 0:
                add("thp_process_disabled", "confirmed", "已确认进程级策略禁止透明大页",
                    "大页建议调用成功，但 PR_GET_THP_DISABLE=1，原始 /proc/self/status 的 THP_enabled=0，目标区域 AnonHugePages=0。进程级禁用是本案例的明确阻断条件。",
                    [ev("after_write"), {"case_id": case["id"], "condition": c, "smaps": case["artifacts"]["smaps"]}],
                    "这是人为设置的受控条件，不是自然发生的内存碎片案例。解除限制仍不保证大页分配；须看允许组的实际观测。", "thp_" + c["pattern"] + "_process_pair")
            elif c["thp_requested"] == "on":
                add("thp_not_observed", "insufficient_evidence", "请求了大页，但尚不能确定未生效原因",
                    "MADV_HUGEPAGE 返回成功，采样时 AnonHugePages 为 0。策略限制、内存分配条件和采样时机均可能相关，现有记录不能区分。",
                    [ev("after_write"), {"environment": {k: report.get("environment", {}).get(k) for k in ("thp_enabled", "thp_defrag", "thp_sizes")}}],
                    "这不等于程序失败，也不能据此断言物理内存碎片。未观测到 PMD THP 不排除其他内核的大页实现。", "thp_" + c["pattern"] + "_pair")
                findings[-1]["next_steps"] = [
                    "先核对原始进程状态与全局 THP 策略；旧记录没有进程策略时不能补猜。",
                    "运行进程策略对照：保持 MADV_HUGEPAGE 和访问动作一致，只改变当前进程的允许/禁用状态。",
                    "若允许组仍为 0，大页分配条件和采样时机仍未区分；保持证据不足，不归因为碎片。"]
        deviations = [x["id"] for x in case["validation"].get("checks", []) if x["status"] != "passed"]
        if deviations:
            add("expectation_deviation", "insufficient_evidence", "观测偏离了基线预期",
                "以下关系未满足：" + "、".join(deviations) + "。保留观测，不自动归因为内核或程序错误。",
                [{"case_id": case["id"], "checks": [x for x in case["validation"]["checks"] if x["status"] != "passed"]}],
                "getrusage 缺页增量属于整个进程，不能与目标区域逐页事件完全等同。")
    for pattern in ("sparse", "full"):
        cases = [c for c in valid if c["suite"] == "thp" and c["parameters"]["pattern"] == pattern]
        for off in cases:
            if off["parameters"]["thp"] != "off":
                continue
            on = next((c for c in cases if c["parameters"]["thp"] == "on" and c["parameters"]["repeat"] == off["parameters"]["repeat"] and
                       c["parameters"].get("process_thp", "inherit") == off["parameters"].get("process_thp", "inherit")), None)
            if not on:
                continue
            oc, nc = off["data"]["condition"], on["data"]["condition"]
            keys = ("pattern", "page_bytes", "huge_bytes", "region_bytes", "stride_bytes", "writes", "huge_aligned")
            if any(oc[k] != nc[k] for k in keys):
                continue
            a, b = off["data"]["samples"][-1], on["data"]["samples"][-1]
            clean = (a["huge_kib"] == 0 and b["huge_kib"] > 0 and
                     all(s["swap_kib"] == s["action_major"] == 0 for c in (off, on) for s in c["data"]["samples"]) and
                     all(c["validation"]["status"] == "passed" for c in (off, on)))
            comparison = {"pattern": pattern, "repeat": off["parameters"]["repeat"], "off": off["id"], "on": on["id"],
                          "control_valid": clean, "rss_kib": {"off": a["rss_kib"], "on": b["rss_kib"]},
                          "minor_faults": {"off": a["action_minor"], "on": b["action_minor"]},
                          "rss_ratio": b["rss_kib"] / a["rss_kib"] if a["rss_kib"] else None}
            comparisons.append(comparison)
            if clean:
                if pattern == "sparse":
                    title = "对照已确认稀疏写的驻留放大" if b["rss_kib"] > a["rss_kib"] else "对照已确认大页驻留不同"
                else:
                    title = ("对照已确认逐页写的缺页计数差异" if a["action_minor"] != b["action_minor"]
                             else "对照已确认大页驻留不同，次缺页计数相同")
                add("thp_" + pattern + "_control", "confirmed", title,
                    f"相同动作、步长、区域尺寸和重复编号，仅改变区域的大页建议。关闭/请求大页的 RSS 为 {a['rss_kib']}/{b['rss_kib']} KiB，次缺页为 {a['action_minor']}/{b['action_minor']}；两组实际大页驻留也不同。",
                    [{"case_id": c["id"], "jsonl": c["artifacts"]["jsonl"], "smaps": c["artifacts"]["smaps"]} for c in (off, on)],
                    "这是同轮受控功能观测；未测量延迟或吞吐，不能据此声称性能提高相同倍数。", "thp_" + pattern + "_pair")
    controls = policy_comparisons(valid)
    for control in controls:
        if control["control_valid"]:
            add("thp_process_control", "confirmed", "对照确认进程策略改变了本轮大页驻留",
                f"两组都成功请求大页；相同尺寸与访问动作下，允许组/禁用组 AnonHugePages 为 {control['huge_kib']['allow']}/{control['huge_kib']['disable']} KiB。两组进程策略均经内核状态回读。",
                [{"case_id": control[k]} for k in ("allow", "disable")],
                "只确认这组受控干预。不能据此解释其他历史记录，也不构成实机性能或内存碎片的证据。", "thp_" + control["pattern"] + "_process_pair")
    if not report.get("cases"):
        add("no_cases", "insufficient_evidence", "没有可用的实验记录", "环境检查失败或尚未执行。", [report.get("error")], "不能给出机制诊断。")
    return {"rule_version": RULE_VERSION, "findings": findings, "comparisons": comparisons,
            "cow_observations": cow_observations, "policy_comparisons": controls, "references": REFERENCES,
            "confidence_labels": {"confirmed": "已确认（限列出的观测与对照）", "probable": "可能原因", "insufficient_evidence": "证据不足"}}
