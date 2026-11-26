"""Process-local THP control. Legacy records never acquire invented policy evidence."""
import re


def parse_policy(condition, raw, parameters, pid):
    if "process_thp" not in condition:
        if "process_thp" in parameters:
            raise ValueError("missing process THP policy evidence")
        return
    policy = condition["process_thp"]
    disabled = condition["process_thp_disabled"]
    if (policy not in ("inherit", "allow", "disable") or policy != parameters.get("process_thp", "inherit") or
            type(disabled) is not int or disabled not in (0, 1) or
            type(condition["madvise_result"]) is not int or condition["madvise_result"] != 0):
        raise ValueError("process THP condition differs from plan")
    blocks = re.findall(r"BEGIN_PROCESS pid=(\d+)\n(.*?)\nEND_PROCESS(?:\n|$)", raw, re.S)
    if len(blocks) != 1 or int(blocks[0][0]) != pid:
        raise ValueError("missing process status identity")
    body = blocks[0][1]
    enabled = re.findall(r"^THP_enabled:\s*([01])$", body, re.M)
    status_pid = re.findall(r"^Pid:\s*(\d+)$", body, re.M)
    if len(enabled) != 1 or status_pid != [str(pid)] or int(enabled[0]) != 1 - disabled:
        raise ValueError("process THP readback disagrees with raw status")
    if policy != "inherit" and disabled != int(policy == "disable"):
        raise ValueError("requested process THP policy was not applied")
    condition["status_thp_enabled"] = int(enabled[0])


def policy_comparisons(cases):
    """Only matched, clean, same-round interventions support a causal contrast."""
    result = []
    for disabled in cases:
        if disabled["suite"] != "thp" or disabled["parameters"].get("process_thp") != "disable":
            continue
        p = disabled["parameters"]
        allowed = next((c for c in cases if c["suite"] == "thp" and
                        c["parameters"] == dict(p, process_thp="allow")), None)
        if not allowed or p["thp"] != "on":
            continue
        dc, ac = (c["data"]["condition"] for c in (disabled, allowed))
        keys = ("pattern", "page_bytes", "huge_bytes", "region_bytes", "stride_bytes", "writes", "huge_aligned")
        if any(dc[k] != ac[k] for k in keys):
            continue
        d, a = (c["data"]["samples"][-1] for c in (disabled, allowed))
        verified = (dc.get("process_thp_disabled") == 1 and dc.get("status_thp_enabled") == 0 and
                    ac.get("process_thp_disabled") == 0 and ac.get("status_thp_enabled") == 1 and
                    dc.get("madvise_result") == ac.get("madvise_result") == 0)
        clean = (verified and d["huge_kib"] == 0 and a["huge_kib"] > 0 and
                 all(c["validation"]["status"] == "passed" for c in (disabled, allowed)) and
                 all(s["swap_kib"] == s["action_major"] == 0 for c in (disabled, allowed) for s in c["data"]["samples"]))
        result.append({"pattern": p["pattern"], "repeat": p["repeat"], "allow": allowed["id"],
                       "disable": disabled["id"], "control_valid": bool(clean),
                       "huge_kib": {"allow": a["huge_kib"], "disable": d["huge_kib"]},
                       "rss_kib": {"allow": a["rss_kib"], "disable": d["rss_kib"]}})
    return result
