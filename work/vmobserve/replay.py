"""Read-only reconstruction. Never execute saved source or trust cached diagnoses."""
import copy
from pathlib import Path

from . import SCHEMA_VERSION
from .common import digest, read_json, timestamp
from .diagnosis import diagnose
from .evidence import parse_case, validate_measurements


def safe_child(root, relative):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("artifact path escapes its run directory")
    return path


def legacy_report(root, old):
    """Explicit adapter for the initial 18-case format, preserving original files."""
    report = {"schema_version": SCHEMA_VERSION, "original_schema": "legacy-unversioned",
              "run_id": root.name, "data_origin": "real_execution", "view_mode": "historical_replay",
              "status": "completed" if old.get("completed") else "failed", "environment": old.get("environment", {}),
              "sources": old.get("sources", {}), "artifacts": {}, "cases": [], "related_run": None,
              "scope": "Historical mechanism/function evidence; not a performance benchmark."}
    for suite, folder in (("baseline", "proj5-memory-pilot"), ("thp", "proj5-round2")):
        names = [(f"{m}MiB-run{r}", {"mib": m, "repeat": r}) for m in (16, 64) for r in (1, 2, 3)] if suite == "baseline" else [
            (f"{p}-{mode}-{r}", {"pattern": p, "thp": mode, "repeat": r}) for p in ("sparse", "full") for mode in ("off", "on") for r in (1, 2, 3)]
        for name, params in names:
            report["cases"].append({"id": f"{suite}-{name}", "suite": suite, "parameters": params,
                                    "status": "completed" if old.get("completed") else "failed",
                                    "artifacts": {"jsonl": f"{folder}/results/{name}.jsonl", "smaps": f"{folder}/results/{name}.smaps.txt"}})
    return report


def load_run(directory):
    root = Path(directory).resolve()
    original = read_json(root / "report.json")
    legacy = "schema_version" not in original
    if not legacy and original["schema_version"] != SCHEMA_VERSION:
        raise ValueError("unsupported result schema")
    report = legacy_report(root, original) if legacy else copy.deepcopy(original)
    report.update(view_mode="historical_replay", replayed_at=timestamp(), original_report_sha256=digest(root / "report.json"))
    errors = []
    for rel, sha in report.get("sources", {}).items():
        try:
            p = safe_child(root, rel if legacy else "source/" + rel)
            if digest(p) != sha:
                errors.append("source hash mismatch: " + rel)
        except (OSError, ValueError) as exc:
            errors.append(f"source unavailable: {rel}: {exc}")
    if not report.get("sources"):
        errors.append("source manifest missing")
    for rel, sha in report.get("artifacts", {}).items():
        try:
            if digest(safe_child(root, rel)) != sha:
                errors.append("artifact hash mismatch: " + rel)
        except (OSError, ValueError) as exc:
            errors.append(f"artifact unavailable: {rel}: {exc}")
    for case in report.get("cases", []):
        # Always discard derived fields, even when the saved process failed.
        case["data"] = None
        case["validation"] = {"status": "insufficient_evidence", "checks": []}
        if case.get("status") != "completed":
            continue
        try:
            if errors:
                raise ValueError("source/artifact manifest verification failed")
            artifacts = case["artifacts"]
            if not legacy and any(artifacts[k] not in report["artifacts"] for k in ("jsonl", "smaps")):
                raise ValueError("raw evidence missing from artifact manifest")
            case["data"] = parse_case(safe_child(root, artifacts["jsonl"]), safe_child(root, artifacts["smaps"]), case["suite"], case["parameters"])
            case["validation"] = validate_measurements(case["suite"], case["data"])
            case["integrity"] = "legacy_partial" if legacy else "verified"
        except (OSError, ValueError, KeyError, TypeError) as exc:
            case.update(integrity="failed", error={"code": "replay_evidence_invalid", "message": str(exc)})
            errors.append(f"{case['id']}: {exc}")
    report["integrity"] = {"status": "failed" if errors else "legacy_partial" if legacy else "verified", "errors": errors,
                           "note": "Legacy raw files have no original hash manifest; current JSONL/smaps consistency checked." if legacy else "Hashes detect file changes relative to this manifest; this is not a signed attestation."}
    report["diagnosis"] = diagnose(report)
    return report
