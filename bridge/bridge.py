"""One request in, one result out. No transport, no state, no magic."""

from __future__ import annotations

import json
import re
import sys
import time
from typing import Any


_SECRET = re.compile(
    r"(?i)(password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)([^\s,;]+)"
)
_URI_USERINFO = re.compile(r"(?i)([a-z][a-z0-9+.-]*://)([^/@\s]+)@")


class _BridgeResult:
    """Give small integration-only results Kontra's normal result protocol."""

    def __init__(self, summary: str, result: dict[str, Any]):
        self.summary = summary
        self.result = result

    def to_dict(self) -> dict[str, Any]:
        return self.result

    def to_llm(self) -> str:
        return self.summary


def _redact(value: str) -> str:
    def redact_userinfo(match: re.Match[str]) -> str:
        scheme, userinfo = match.groups()
        user, separator, _password = userinfo.partition(":")
        return f"{scheme}{user}:***@" if separator else f"{scheme}***@"

    value = _URI_USERINFO.sub(redact_userinfo, value)
    return _SECRET.sub(r"\1\2[redacted]", value)[:4000]


def _require(request: dict[str, Any], *names: str) -> None:
    missing = [name for name in names if not request.get(name)]
    if missing:
        raise ValueError(f"missing required field(s): {', '.join(missing)}")


def _key_args(
    request: dict[str, Any],
    same: str,
    left: str,
    right: str,
    left_python: str,
    right_python: str,
) -> dict[str, Any]:
    if request.get(same) is not None:
        if request.get(left) is not None or request.get(right) is not None:
            raise ValueError(f"use either {same} or {left}/{right}, not both")
        return {same: request[same]}
    _require(request, left, right)
    return {left_python: request[left], right_python: request[right]}


def _rule_filter_args(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("only") is not None and request.get("columns") is not None:
        raise ValueError("use either only or columns, not both")
    return {"only": request.get("only"), "columns": request.get("columns")}


def _contract_source(contract: str) -> str | None:
    try:
        from kontra.config.loader import ContractLoader

        return ContractLoader.from_path(contract).datasource
    except Exception:  # Best-effort, cosmetic provenance only.
        return None


def _source_backend(kontra: Any, source: Any) -> str | None:
    if not isinstance(source, str) or not source:
        return None
    resolved = source
    if "://" not in source:
        try:
            resolved = kontra.resolve(source)
        except Exception:  # Best-effort, cosmetic provenance only.
            resolved = source
    scheme = resolved.split("://", 1)[0].lower() if "://" in resolved else ""
    if scheme in {"postgres", "postgresql"}:
        return "postgres"
    if scheme == "clickhouse":
        return "clickhouse"
    if scheme in {"mssql", "sqlserver"}:
        return "mssql"
    if scheme in {"s3", "az", "azure", "abfs", "abfss", "file", "http", "https"}:
        return "duckdb"
    if not scheme and ("." in resolved or "/" in resolved):
        return "duckdb"
    return None


def _execution_sources(
    kontra: Any,
    request: dict[str, Any],
    structured: dict[str, Any],
) -> list[str]:
    operation = request.get("operation")
    backends: list[str] = []
    if operation in {"validate", "explain"}:
        source = request.get("source") or _contract_source(request.get("contract", ""))
        backend = _source_backend(kontra, source)
        backends = [backend] if backend else []
    elif operation in {"profile", "profile_diff"}:
        backend = _source_backend(kontra, request.get("source"))
        backends = [backend] if backend else []
    elif operation in {"compare", "profile_compare"}:
        backends = [
            backend for backend in (
                _source_backend(kontra, request.get("before")),
                _source_backend(kontra, request.get("after")),
            ) if backend
        ]
    elif operation == "relationship":
        backends = [
            backend for backend in (
                _source_backend(kontra, request.get("left")),
                _source_backend(kontra, request.get("right")),
            ) if backend
        ]

    tiers: list[str] = []
    if operation == "validate":
        for rule in structured.get("rules", []):
            source = rule.get("source")
            if source == "sql":
                tiers.extend(backends or ["sql"])
            elif source:
                tiers.append(source)
    elif operation == "explain":
        for rule in structured.get("rules", []):
            tier = rule.get("tier")
            if tier == "sql":
                tiers.extend(backends or ["sql"])
            elif tier:
                tiers.append(tier)
    elif operation in {"compare", "relationship"}:
        tier = structured.get("meta", {}).get("execution_tier")
        if tier == "sql":
            tiers.extend(backends or ["sql"])
        elif tier:
            tiers.append(tier)
    elif operation in {"profile", "profile_compare"}:
        tiers.extend(backends)

    order = {name: index for index, name in enumerate(
        ["metadata", "postgres", "mssql", "clickhouse", "duckdb", "sql", "polars"]
    )}
    return sorted(set(tiers), key=lambda value: (order.get(value, len(order)), value))


def _run(request: dict[str, Any]) -> Any:
    import kontra

    operation = request.get("operation")
    if operation == "sources":
        datasources = kontra.list_datasources()
        table_count = sum(len(tables) for tables in datasources.values())
        lines = [f"SOURCES: {len(datasources)} datasources, {table_count} tables"]
        for name, tables in sorted(datasources.items()):
            suffix = ", ".join(tables) if tables else "(no named tables)"
            lines.append(f"  {name}: {suffix}")
        return _BridgeResult("\n".join(lines), {"datasources": datasources})
    if operation == "doctor":
        health = kontra.health()
        datasources = kontra.list_datasources()
        health["python"] = sys.executable
        health["datasource_count"] = len(datasources)
        summary = (
            f"DOCTOR: Kontra {health.get('version', '?')} {health.get('status', 'unknown')}\n"
            f"python: {sys.executable}\n"
            f"config: {health.get('config_path') or 'not found'}\n"
            f"rules: {health.get('rule_count', 0)}, datasources: {len(datasources)}"
        )
        return _BridgeResult(summary, health)
    if operation == "check":
        _require(request, "contract")
        return kontra.validate(contract=request["contract"], dry_run=True)
    if operation == "explain":
        _require(request, "contract")
        return kontra.explain(
            request.get("source"),
            contract=request["contract"],
            **_rule_filter_args(request),
        )
    if operation == "validate":
        _require(request, "contract")
        return kontra.validate(
            request.get("source"),
            contract=request["contract"],
            tally=request.get("tally"),
            sample=request.get("sample", 0),
            save=request.get("save", True),
            **_rule_filter_args(request),
        )
    if operation == "profile":
        _require(request, "source")
        kwargs = {
            "preset": request.get("preset", "scan"),
            "columns": request.get("columns"),
            "save": request.get("save", False),
        }
        if request.get("sample") is not None:
            kwargs["sample"] = request["sample"]
        return kontra.profile(request["source"], **kwargs)
    if operation == "diff":
        _require(request, "contract")
        return kontra.diff(request["contract"], since=request.get("since"))
    if operation == "profile_diff":
        _require(request, "source")
        result = kontra.profile_diff(request["source"], since=request.get("since"))
        if result is None:
            return _BridgeResult(
                f"PROFILE DIFF: no comparable history for {request['source']}",
                {"has_history": False, "source": request["source"]},
            )
        return result
    if operation == "profile_compare":
        _require(request, "before", "after")
        return kontra.compare_profiles(
            request["before"],
            request["after"],
            preset=request.get("preset", "scan"),
            columns=request.get("columns"),
        )
    if operation == "compare":
        _require(request, "before", "after")
        return kontra.compare(
            request["before"],
            request["after"],
            sample_limit=request.get("sampleLimit", 0),
            save=request.get("save", False),
            **_key_args(
                request,
                "key",
                "beforeKey",
                "afterKey",
                "before_key",
                "after_key",
            ),
        )
    if operation == "relationship":
        _require(request, "left", "right")
        return kontra.profile_relationship(
            request["left"],
            request["right"],
            sample_limit=request.get("sampleLimit", 0),
            save=request.get("save", False),
            **_key_args(
                request,
                "on",
                "leftOn",
                "rightOn",
                "left_on",
                "right_on",
            ),
        )
    raise ValueError(f"unknown operation: {operation!r}")


def main() -> int:
    started = time.perf_counter()
    operation = "validate"
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
        operation = str(request.get("operation", "validate"))
        result = _run(request)
        if result is None:
            structured = None
            summary = "No result available."
        else:
            structured = result.to_dict()
            summary = result.to_llm()
        response = {
            "ok": True,
            "operation": operation,
            "summary": summary,
            "result": structured,
            "runtimeMs": round((time.perf_counter() - started) * 1000, 1),
        }
        import kontra

        execution = _execution_sources(kontra, request, structured or {})
        if execution:
            response["execution"] = execution
    except (ImportError, OSError, ValueError, TypeError, KeyError, RuntimeError) as error:
        response = {
            "ok": False,
            "operation": operation,
            "summary": _redact(str(error)),
            "error": {"type": type(error).__name__, "message": _redact(str(error))},
            "runtimeMs": round((time.perf_counter() - started) * 1000, 1),
        }
    except Exception as error:  # Kontra backends expose driver-specific exception types.
        response = {
            "ok": False,
            "operation": operation,
            "summary": _redact(str(error)),
            "error": {"type": type(error).__name__, "message": _redact(str(error))},
            "runtimeMs": round((time.perf_counter() - started) * 1000, 1),
        }
    json.dump(response, sys.stdout, default=str, separators=(",", ":"))
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
