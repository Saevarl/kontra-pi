import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KontraRequest, ToolDetails } from "./types.js";

type Tone = "success" | "error" | "warning" | "accent";
type ExpandedTone = Tone | "dim" | "muted";

export interface ResultPresentation {
  tone: Tone;
  mark: string;
  headline: string;
}

export interface GateOutcome {
  contract: string;
  passed: boolean;
  summary: string;
}

const EXECUTION_ORDER = ["metadata", "postgres", "mssql", "clickhouse", "duckdb", "sql", "polars"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function failedRules(result: Record<string, unknown>, severity: string): number {
  if (!Array.isArray(result.rules)) return 0;
  return result.rules.filter((value) => {
    const rule = record(value);
    return rule.passed === false && rule.severity === severity;
  }).length;
}

function label(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function subject(request: KontraRequest): string {
  if (["validate", "check", "explain", "diff"].includes(request.operation)) return request.contract ?? "?";
  if (["profile", "profile_diff"].includes(request.operation)) return request.source ?? "?";
  if (["compare", "profile_compare"].includes(request.operation)) return `${request.before ?? "?"} → ${request.after ?? "?"}`;
  if (request.operation === "relationship") return `${request.left ?? "?"} ↔ ${request.right ?? "?"}`;
  if (request.operation === "rules") return request.rule ?? "built-ins";
  return request.operation === "sources" ? "configured names" : "environment";
}

export function activityLabel(request: KontraRequest): string {
  if (request.operation === "validate") return `validating ${request.contract ?? "contract"}`;
  if (request.operation === "profile") return `profiling ${request.source ?? "source"}`;
  if (request.operation === "check") return `checking ${request.contract ?? "contract"}`;
  if (request.operation === "explain") return `planning ${request.contract ?? "contract"}`;
  if (request.operation === "diff") return `diffing ${request.contract ?? "contract"}`;
  if (request.operation === "profile_diff") return `checking drift for ${request.source ?? "source"}`;
  if (request.operation === "compare") return `comparing ${request.before ?? "before"} → ${request.after ?? "after"}`;
  if (request.operation === "profile_compare") return `comparing profiles ${request.before ?? "before"} → ${request.after ?? "after"}`;
  if (request.operation === "relationship") return `measuring ${request.left ?? "left"} ↔ ${request.right ?? "right"}`;
  if (request.operation === "rules") return request.rule ? `reading ${request.rule}` : "listing rules";
  if (request.operation === "sources") return "listing sources";
  return "checking setup";
}

function validationPresentation(result: Record<string, unknown>): ResultPresentation {
  const passed = result.passed !== false;
  const total = number(result.total_rules) ?? 0;
  const blocking = number(result.failed_count) ?? failedRules(result, "blocking");
  const warnings = number(result.warning_count) ?? failedRules(result, "warning");
  const info = number(result.info_count) ?? failedRules(result, "info");
  const passedRules = number(result.passed_count) ?? Math.max(total - blocking - warnings - info, 0);
  const rows = number(result.total_rows);
  const suffix = [
    blocking ? label(blocking, "blocking failure") : "",
    warnings ? label(warnings, "warning") : "",
    info ? label(info, "info", "info") : "",
    rows !== undefined ? `${rows.toLocaleString()} rows` : "",
  ]
    .filter(Boolean).join(" · ");
  const tone = !passed ? "error" : warnings ? "warning" : info ? "accent" : "success";
  const mark = !passed ? "✗" : warnings ? "!" : info ? "◆" : "✓";
  return { tone, mark, headline: `${passedRules}/${total} rules passed${suffix ? ` · ${suffix}` : ""}` };
}

export function resultPresentation(details: ToolDetails): ResultPresentation {
  const result = record(details.result);
  const first = details.summary.split("\n").find((line) => line.trim()) ?? "complete";

  if (details.operation === "validate") return validationPresentation(result);
  if (details.operation === "check") {
    const valid = result.valid !== false;
    const rules = number(result.rules_count) ?? 0;
    return { tone: valid ? "success" : "error", mark: valid ? "✓" : "✗", headline: valid ? `contract valid · ${rules} rules` : "contract invalid" };
  }
  if (details.operation === "doctor") {
    const healthy = result.status === "ok";
    return { tone: healthy ? "success" : "error", mark: healthy ? "✓" : "✗", headline: `Kontra ${String(result.version ?? "?")} · ${String(result.status ?? "unknown")}` };
  }
  if (details.operation === "profile") {
    const dataset = record(result.dataset);
    const rows = number(dataset.row_count) ?? 0;
    const columns = number(dataset.column_count) ?? 0;
    const estimated = dataset.row_count_estimated === true ? "~" : "";
    return { tone: "accent", mark: "◆", headline: `${estimated}${rows.toLocaleString()} rows × ${columns} columns · ${String(result.preset ?? "scan")}` };
  }
  if (details.operation === "compare") {
    const meta = record(result.meta);
    const keys = record(result.key_stats);
    const changes = record(result.change_stats);
    const hasChanges = (number(meta.before_rows) ?? 0) !== (number(meta.after_rows) ?? 0)
      || (number(keys.dropped) ?? 0) > 0 || (number(keys.added) ?? 0) > 0
      || (number(keys.duplicated_after) ?? 0) > 0 || (number(changes.changed_rows) ?? 0) > 0;
    return {
      tone: hasChanges ? "warning" : "success", mark: hasChanges ? "Δ" : "✓",
      headline: `${number(meta.before_rows) ?? 0}→${number(meta.after_rows) ?? 0} rows · ${number(keys.dropped) ?? 0} dropped · ${number(keys.added) ?? 0} added · ${number(changes.changed_rows) ?? 0} changed`,
    };
  }
  if (details.operation === "relationship") {
    const coverage = record(result.coverage);
    const leftStats = record(record(result.key_stats).left);
    const rightStats = record(record(result.key_stats).right);
    const left = number(coverage.left_keys_without_match) ?? 0;
    const right = number(coverage.right_keys_without_match) ?? 0;
    const noteworthy = left > 0 || right > 0
      || (number(leftStats.null_rate) ?? 0) > 0 || (number(rightStats.null_rate) ?? 0) > 0
      || (number(leftStats.duplicate_keys) ?? 0) > 0 || (number(rightStats.duplicate_keys) ?? 0) > 0;
    return { tone: noteworthy ? "warning" : "success", mark: noteworthy ? "Δ" : "✓", headline: `${left} unmatched left keys · ${right} unmatched right keys` };
  }
  if (details.operation === "sources") {
    const datasources = record(result.datasources);
    const tables = Object.values(datasources).reduce<number>((total, value) => total + count(value), 0);
    return { tone: "accent", mark: "◆", headline: `${Object.keys(datasources).length} datasources · ${tables} tables` };
  }
  if (details.operation === "rules") {
    const named = typeof result.name === "string";
    return {
      tone: "accent",
      mark: "◆",
      headline: named
        ? `${String(result.name)} · ${String(result.scope ?? "unknown")}`
        : `${count(result.rules)} built-in rules`,
    };
  }
  if (details.operation === "explain") {
    const tiers = record(result.summary);
    const parts = ["metadata", "sql", "polars"]
      .map((tier) => [tier, number(tiers[tier]) ?? 0] as const)
      .filter(([, value]) => value > 0)
      .map(([tier, value]) => `${value} ${tier}`);
    return { tone: "accent", mark: "◆", headline: `${number(result.total_rules) ?? 0} rules${parts.length ? ` · ${parts.join(" · ")}` : ""}` };
  }
  if (details.operation === "diff") {
    const regressed = result.regressed === true;
    const improved = result.improved === true;
    return {
      tone: regressed ? "error" : improved ? "success" : "accent",
      mark: regressed ? "✗" : improved ? "✓" : "◆",
      headline: regressed ? `${count(result.new_failures)} new failures` : improved ? `${count(result.resolved)} resolved failures` : "no validation change",
    };
  }
  if (details.operation === "profile_compare" || details.operation === "profile_diff") {
    if (result.has_history === false) return { tone: "warning", mark: "!", headline: "no comparable profile history" };
    const changes = record(result.changes);
    const changed = count(changes.columns_changed);
    const added = count(changes.columns_added);
    const removed = count(changes.columns_removed);
    const delta = number(changes.row_count_delta) ?? 0;
    const hasChanges = delta !== 0 || changed + added + removed > 0;
    return {
      tone: hasChanges ? "warning" : "success",
      mark: hasChanges ? "Δ" : "✓",
      headline: `${delta >= 0 ? "+" : ""}${delta.toLocaleString()} rows · ${added} added · ${removed} removed · ${changed} changed columns`,
    };
  }
  return { tone: "accent", mark: "◆", headline: first };
}

export function executionProvenance(details: ToolDetails): string[] {
  if (details.execution?.length) return details.execution;
  const result = record(details.result);
  const found = new Set<string>();
  if (details.operation === "validate") {
    for (const rule of Array.isArray(result.rules) ? result.rules : []) {
      const source = record(rule).source;
      if (typeof source === "string" && source) {
        found.add(source === "sql" ? "duckdb" : source === "sqlserver" ? "mssql" : source);
      }
    }
  } else if (details.operation === "explain") {
    const tiers = record(result.summary);
    for (const tier of ["metadata", "sql", "polars"]) {
      if ((number(tiers[tier]) ?? 0) > 0) found.add(tier);
    }
  } else if (details.operation === "compare" || details.operation === "relationship") {
    const tier = record(result.meta).execution_tier;
    if (typeof tier === "string" && tier) found.add(tier);
  }
  return [...found].sort((a, b) => {
    const ai = EXECUTION_ORDER.indexOf(a);
    const bi = EXECUTION_ORDER.indexOf(b);
    return (ai < 0 ? EXECUTION_ORDER.length : ai) - (bi < 0 ? EXECUTION_ORDER.length : bi) || a.localeCompare(b);
  });
}

export function expandedDetails(details: ToolDetails): string[] {
  const lines = details.summary.split("\n");
  const execution = executionProvenance(details);
  if (execution.length) lines.push(`execution: ${execution.join(", ")}`);
  if (details.python) lines.push(`python: ${details.python}`);
  return lines;
}

export function expandedLineTone(line: string, summary: boolean): ExpandedTone {
  if (!summary) return "muted";
  if (line.startsWith("BLOCKING:")) return "error";
  if (line.startsWith("WARNING:")) return "warning";
  if (line.startsWith("INFO:")) return "accent";
  if (line.startsWith("CONTEXT:") || line.startsWith("ANNOTATIONS ") || line.startsWith("  ")) return "muted";
  return "dim";
}

export function statusSummary(details: ToolDetails, gateEnabled: boolean, contractCount: number): string {
  const result = record(details.result);
  return [
    `Kontra ${String(result.version ?? "?")}`,
    `config: ${String(result.config_path ?? "not found")}`,
    `python: ${String(result.python ?? details.python ?? "unknown")}`,
    `automatic gate: ${gateEnabled ? "on" : "off"} · ${contractCount} contracts`,
  ].join("\n");
}

export function gateOutcomeLines(results: GateOutcome[]): string[] {
  return results.map((result) =>
    `${result.passed ? "✓" : "✗"} ${result.contract}${result.passed ? "" : ` — ${result.summary.split("\n")[0]}`}`,
  );
}

export function renderCall(request: KontraRequest, theme: Theme): Text {
  return new Text(
    `${theme.fg("toolTitle", theme.bold("kontra "))}${theme.fg("accent", request.operation)} ${theme.fg("muted", subject(request))}`,
    0,
    0,
  );
}

export function renderResult(details: ToolDetails | undefined, expanded: boolean, partial: boolean, theme: Theme): Text {
  if (partial) return new Text(theme.fg("warning", "measuring…"), 0, 0);
  if (!details) return new Text(theme.fg("error", "no result"), 0, 0);
  const presentation = resultPresentation(details);
  let text = `${theme.fg(presentation.tone, presentation.mark)} ${presentation.headline}`;
  if (details.runtimeMs !== undefined) text += theme.fg("dim", `  ${details.runtimeMs}ms`);
  if (expanded) {
    const lines = expandedDetails(details);
    const summaryLines = details.summary.split("\n").length;
    text += `\n${lines.map((line, index) => theme.fg(expandedLineTone(line, index < summaryLines), line)).join("\n")}`;
  }
  return new Text(text, 0, 0);
}
