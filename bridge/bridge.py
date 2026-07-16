"""One request in, one result out. No transport, no state, no magic."""

from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any


_URI_USERINFO = re.compile(r"(?i)([a-z][a-z0-9+.-]*://)([^/@\s]+)@")
_AUTHORIZATION = re.compile(
    r"(?i)\b((?:proxy-)?authorization\s*:\s*)(?:bearer|basic|digest)\s+[^\s,;]+"
)
_SECRET_HEADER = re.compile(
    r"(?i)\b((?:x-api-key|api-key|x-auth-token|set-cookie|cookie)\s*:\s*)[^\r\n]+"
)
_SECRET = re.compile(
    r'''(?ix)\b
    (password|passwd|pwd|secret|client[_-]?secret|token|access[_-]?token|
     refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key|
     access[_-]?key|secret[_-]?access[_-]?key|account[_-]?key|
     private[_-]?key|credential|connection[_-]?string|sig|signature|sas)
    (\s*[=:]\s*)
    (?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)'''
)
_SECRET_QUERY = re.compile(
    r"(?i)([?&](?:sig|signature|token|access_token|refresh_token|id_token|sas|"
    r"password|pass|secret|key|credential|x-amz-signature|x-amz-credential)=)"
    r"[^&\s'\";]+"
)
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
    re.DOTALL,
)
_AWS_ACCESS_KEY = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")
_PROVIDER_TOKEN = re.compile(
    r"\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    r"xox[baprs]-[A-Za-z0-9-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b"
)
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_SENSITIVE_ENV = re.compile(
    r"(?:^|_)(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)(?:$|_)",
    re.I,
)
_SENSITIVE_KEY = re.compile(
    r"^(?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|"
    r"id_token|session_token|api_key|access_key|access_key_id|secret_access_key|"
    r"account_key|private_key|authorization|proxy_authorization|credential|credentials|"
    r"connection_string|sig|signature|sas|cookie|set_cookie)$"
)


class _BridgeResult:
    """Give small integration-only results Kontra's normal result protocol."""

    def __init__(self, summary: str, result: dict[str, Any]):
        self.summary = summary
        self.result = result

    def to_dict(self) -> dict[str, Any]:
        return self.result

    def to_llm(self) -> str:
        return self.summary


def _environment_secrets() -> list[str]:
    return sorted(
        {
            value
            for name, value in os.environ.items()
            if name not in {"PWD", "OLDPWD"}
            and _SENSITIVE_ENV.search(name)
            and len(value) >= 4
        },
        key=len,
        reverse=True,
    )


def _redact(value: str, exact_secrets: list[str] | None = None) -> str:
    def redact_userinfo(match: re.Match[str]) -> str:
        scheme, userinfo = match.groups()
        user, separator, _password = userinfo.partition(":")
        return f"{scheme}{user}:***@" if separator else f"{scheme}***@"

    value = _PRIVATE_KEY.sub("[redacted private key]", value)
    value = _URI_USERINFO.sub(redact_userinfo, value)
    value = _AUTHORIZATION.sub(r"\1[redacted]", value)
    value = _SECRET_HEADER.sub(r"\1[redacted]", value)
    value = _SECRET_QUERY.sub(r"\1[redacted]", value)
    value = _SECRET.sub(r"\1\2[redacted]", value)
    value = _AWS_ACCESS_KEY.sub("[redacted access key]", value)
    value = _PROVIDER_TOKEN.sub("[redacted token]", value)
    value = _JWT.sub("[redacted token]", value)
    for secret in exact_secrets if exact_secrets is not None else _environment_secrets():
        value = value.replace(secret, "[redacted]")
    return value


def _sensitive_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
    return bool(_SENSITIVE_KEY.fullmatch(normalized))


def _sanitize(value: Any, exact_secrets: list[str] | None = None) -> Any:
    secrets = exact_secrets if exact_secrets is not None else _environment_secrets()
    if isinstance(value, str):
        return _redact(value, secrets)
    if isinstance(value, dict):
        return {
            key: "[redacted]" if _sensitive_key(str(key)) and child is not None
            else _sanitize(child, secrets)
            for key, child in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize(child, secrets) for child in value]
    return value


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
    if operation == "rules":
        rule_name = request.get("rule")
        if rule_name:
            if not hasattr(kontra, "describe_rule"):
                raise RuntimeError(
                    "Exact rule details require a newer Kontra release; upgrade the project's Kontra package."
                )
            detail = kontra.describe_rule(rule_name)
            parameters = []
            for parameter in detail["parameters"]:
                requirement = "required" if parameter["required"] else f"default {parameter.get('default')!r}"
                constraints = f"; {parameter['constraints']}" if parameter.get("constraints") else ""
                parameters.append(
                    f"  {parameter['name']}: {parameter['type']} ({requirement}{constraints})"
                    f" — {parameter['description']}"
                )
            notes = [f"note: {note}" for note in detail.get("notes", [])]
            summary = "\n".join([
                f"RULE: {detail['name']} [{detail['scope']}]",
                detail["summary"],
                f"fails: {detail['fails_when']}",
                f"nulls: {detail['nulls']}",
                f"counting: {detail['counting']}",
                f"tally: {'supported' if detail['supports_tally'] else 'not supported'}",
                "params:",
                *parameters,
                *notes,
                "entry: name + params; optional id, severity, tally, context",
                "contract:",
                detail["example"],
            ])
            return _BridgeResult(summary, detail)
        rules = kontra.list_rules()
        lines = [f"RULES: {len(rules)} built-ins"]
        lines.extend(
            f"  {rule['name']} [{rule['scope']}]: {rule['description']}"
            for rule in rules
        )
        return _BridgeResult("\n".join(lines), {"rules": rules})
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
    response = _sanitize(response)
    json.dump(response, sys.stdout, default=str, separators=(",", ":"))
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
