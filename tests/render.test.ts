import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLabel,
  executionProvenance,
  expandedDetails,
  expandedLineTone,
  resultPresentation,
  statusSummary,
} from "../extensions/render.js";
import type { KontraRequest, ToolDetails } from "../extensions/types.js";

function details(request: KontraRequest, result: Record<string, unknown>): ToolDetails {
  return { ok: true, operation: request.operation, request, result, summary: "summary" };
}

test("renders failed validation as a failure", () => {
  const presentation = resultPresentation(details(
    { operation: "validate", contract: "users.yml" },
    { passed: false, total_rules: 8, passed_count: 5, failed_count: 2, warning_count: 1, total_rows: 50 },
  ));
  assert.equal(presentation.tone, "error");
  assert.equal(presentation.mark, "✗");
  assert.equal(presentation.headline, "5/8 rules passed · 2 blocking failures · 1 warning · 50 rows");

  const passed = resultPresentation(details(
    { operation: "validate", contract: "users.yml" },
    { passed: true, total_rules: 8, passed_count: 8, failed_count: 0, warning_count: 0, total_rows: 50 },
  ));
  assert.equal(passed.tone, "success");
  assert.equal(passed.mark, "✓");
  assert.equal(passed.headline, "8/8 rules passed · 50 rows");
});

test("distinguishes non-blocking validation severities", () => {
  const warning = resultPresentation(details(
    { operation: "validate", contract: "users.yml" },
    {
      passed: true, total_rules: 8, passed_count: 7, failed_count: 0,
      total_rows: 50,
      rules: [{ passed: false, severity: "warning" }],
    },
  ));
  assert.equal(warning.tone, "warning");
  assert.equal(warning.mark, "!");
  assert.equal(warning.headline, "7/8 rules passed · 1 warning · 50 rows");

  const info = resultPresentation(details(
    { operation: "validate", contract: "users.yml" },
    {
      passed: true, total_rules: 8, passed_count: 7, failed_count: 0,
      warning_count: 0, total_rows: 50,
      rules: [{ passed: false, severity: "info" }],
    },
  ));
  assert.equal(info.tone, "accent");
  assert.equal(info.mark, "◆");
  assert.equal(info.headline, "7/8 rules passed · 1 info · 50 rows");
});

test("flags probe changes without calling them failures", () => {
  const compare = resultPresentation(details(
    { operation: "compare", before: "a", after: "b", key: "id" },
    {
      meta: { before_rows: 5, after_rows: 4 },
      key_stats: { dropped: 1, added: 0 },
      change_stats: { changed_rows: 2 },
    },
  ));
  assert.equal(compare.tone, "warning");
  assert.equal(compare.mark, "Δ");
  assert.match(compare.headline, /1 dropped/);

  const unchanged = resultPresentation(details(
    { operation: "compare", before: "a", after: "b", key: "id" },
    {
      meta: { before_rows: 5, after_rows: 5 },
      key_stats: { dropped: 0, added: 0, duplicated_after: 0 },
      change_stats: { changed_rows: 0 },
    },
  ));
  assert.equal(unchanged.tone, "success");
  assert.equal(unchanged.mark, "✓");
});

test("shows concrete execution provenance only in expanded details", () => {
  const validation = details(
    { operation: "validate", contract: "users.yml" },
    {
      passed: true,
      rules: [
        { source: "metadata" },
        { source: "postgres" },
        { source: "sqlserver" },
        { source: "clickhouse" },
        { source: "polars" },
      ],
    },
  );
  validation.summary = "VALIDATION: users PASSED";
  validation.python = "/project/.venv/bin/python";
  assert.deepEqual(executionProvenance(validation), ["metadata", "postgres", "mssql", "clickhouse", "polars"]);
  assert.deepEqual(expandedDetails(validation), [
    "VALIDATION: users PASSED",
    "execution: metadata, postgres, mssql, clickhouse, polars",
    "python: /project/.venv/bin/python",
  ]);
});

test("colors expanded validation semantics without adding output", () => {
  assert.equal(expandedLineTone("VALIDATION: users FAILED", true), "dim");
  assert.equal(expandedLineTone("BLOCKING: COL:id:not_null", true), "error");
  assert.equal(expandedLineTone("WARNING: COL:email:unique", true), "warning");
  assert.equal(expandedLineTone("INFO: DATASET:min_rows", true), "accent");
  assert.equal(expandedLineTone("CONTEXT: owner=identity", true), "muted");
  assert.equal(expandedLineTone("  ... +2 more rules with context", true), "muted");
  assert.equal(expandedLineTone("execution: postgres", false), "muted");
});

test("uses concise Pi-native activity and status text", () => {
  assert.equal(activityLabel({ operation: "profile", source: "pg.users" }), "profiling pg.users");
  const doctor = details(
    { operation: "doctor" },
    { version: "0.12.2", config_path: "/project/.kontra/config.yml", python: "/project/.venv/bin/python" },
  );
  assert.equal(statusSummary(doctor, false, 2), [
    "Kontra 0.12.2",
    "config: /project/.kontra/config.yml",
    "python: /project/.venv/bin/python",
    "automatic gate: off · 2 contracts",
  ].join("\n"));
});

test("renders the rule index and one rule without dumping the catalog", () => {
  const index = resultPresentation(details(
    { operation: "rules" },
    { rules: [{ name: "range" }, { name: "unique" }] },
  ));
  assert.equal(index.headline, "2 built-in rules");
  assert.equal(activityLabel({ operation: "rules", rule: "unique" }), "reading unique");

  const rule = resultPresentation(details(
    { operation: "rules", rule: "unique" },
    { name: "unique", scope: "column" },
  ));
  assert.equal(rule.headline, "unique · column");
});

test("highlights profile drift without calling it a failure", () => {
  const drift = resultPresentation(details(
    { operation: "profile_compare", before: "a", after: "b" },
    { changes: { row_count_delta: 3, columns_added: ["status"], columns_removed: [], columns_changed: ["email"] } },
  ));
  assert.equal(drift.tone, "warning");
  assert.equal(drift.mark, "Δ");
  assert.match(drift.headline, /1 changed columns/);
});
