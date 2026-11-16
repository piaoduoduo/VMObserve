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
    source_errors = []
    for rel, sha in report.get("sources", {}).items():
        try:
            p = safe_child(root, rel if legacy else "source/" + rel)
            if digest(p) != sha:
                source_errors.append("source hash mismatch: " + rel)
        except (OSError, ValueError) as exc:
            source_errors.append(f"source unavailable: {rel}: {exc}")
    if not report.get("sources"):
        source_errors.append("source manifest missing")
    artifact_errors = {}
    for rel, sha in report.get("artifacts", {}).items():
        try:
            if digest(safe_child(root, rel)) != sha:
                artifact_errors[rel] = "artifact hash mismatch: " + rel
        except (OSError, ValueError) as exc:
            artifact_errors[rel] = f"artifact unavailable: {rel}: {exc}"
    raw_paths = {rel for case in report.get("cases", []) for rel in case.get("artifacts", {}).values()}
    shared_errors = source_errors + [error for rel, error in artifact_errors.items() if rel not in raw_paths]
    errors = source_errors + list(artifact_errors.values())
    for case in report.get("cases", []):
        # Always discard derived fields, even when the saved process failed.
        case["data"] = None
        case["validation"] = {"status": "insufficient_evidence", "checks": []}
        case.pop("integrity", None)
        if case.get("status") != "completed":
            continue
        try:
            if shared_errors:
                raise ValueError("shared source/environment manifest verification failed")
            artifacts = case["artifacts"]
            if not legacy and any(relative not in report["artifacts"] for relative in artifacts.values()):
                raise ValueError("raw evidence missing from artifact manifest")
            case_errors = [artifact_errors[rel] for rel in artifacts.values() if rel in artifact_errors]
            if case_errors:
                raise ValueError("; ".join(case_errors))
            data = parse_case(safe_child(root, artifacts["jsonl"]), safe_child(root, artifacts.get("kernel", artifacts.get("smaps"))), case["suite"], case["parameters"])
            validation = validate_measurements(case["suite"], data)
            case.update(data=data, validation=validation, integrity="legacy_partial" if legacy else "verified")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            case.update(integrity="failed", error={"code": "replay_evidence_invalid", "message": str(exc)})
            errors.append(f"{case['id']}: {exc}")
    report["integrity"] = {"status": "failed" if errors else "legacy_partial" if legacy else "verified", "errors": errors,
                           "note": "Legacy raw files have no original hash manifest; current JSONL/smaps consistency checked." if legacy else "Hashes detect file changes relative to this manifest; this is not a signed attestation."}
    report["diagnosis"] = diagnose(report)
    return report
