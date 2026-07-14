import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MAX_OUTPUT, redact, runProcess } from "../extensions/bridge.js";
import { normalizeRequest } from "../extensions/types.js";

function findPython(): string | undefined {
  for (const candidate of [process.env.KONTRA_PYTHON, "python3", "python"]) {
    if (candidate && spawnSync(candidate, ["--version"]).status === 0) return candidate;
  }
  return undefined;
}

function findKontraPython(): string | undefined {
  const siblingDevelopmentPython = fileURLToPath(new URL("../../Kontra/.venv/bin/python", import.meta.url));
  for (const candidate of [process.env.KONTRA_PYTHON, siblingDevelopmentPython, "python3", "python"]) {
    if (candidate && spawnSync(candidate, ["-c", "import kontra"]).status === 0) return candidate;
  }
  return undefined;
}

const python = findPython();
const kontraPython = findKontraPython();
const bridge = fileURLToPath(new URL("../bridge/bridge.py", import.meta.url));

test("redacts common credential forms", () => {
  const output = redact("postgres password=hunter2 token:abc123 api_key=secret");
  assert.equal(output.includes("hunter2"), false);
  assert.equal(output.includes("abc123"), false);
  assert.equal(output.includes("api_key=[redacted]"), true);
});

test("redacts URI userinfo while preserving the username", () => {
  const output = redact("failed to connect to postgres://alice:hunter2@db.example.com/app");
  assert.equal(output, "failed to connect to postgres://alice:***@db.example.com/app");
});

test("normalizes transformation probes to zero samples", () => {
  assert.equal(normalizeRequest({ operation: "compare", before: "a", after: "b", key: "id" }).sampleLimit, 0);
  assert.equal(normalizeRequest({ operation: "relationship", left: "a", right: "b", on: "id" }).sampleLimit, 0);
  assert.equal(normalizeRequest({ operation: "compare", before: "a", after: "b", key: "id", sampleLimit: 3 }).sampleLimit, 3);
});

test("reports timeout, cancellation, and output limits distinctly", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], "", process.cwd(), 25),
    /Kontra timed out after 25ms\./,
  );

  const controller = new AbortController();
  const cancelled = runProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    "",
    process.cwd(),
    5_000,
    controller.signal,
  );
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(cancelled, /Kontra was cancelled\./);

  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", `process.stdout.write(Buffer.alloc(${MAX_OUTPUT + 1}, 120))`],
      "",
      process.cwd(),
      5_000,
    ),
    /Kontra stopped because bridge output exceeded 2 MiB\./,
  );
});

test("the Python bridge defaults probe samples to zero and redacts URI errors", { skip: !python }, async () => {
  const fakeModule = await mkdtemp(join(tmpdir(), "kontra-pi-fake-"));
  await writeFile(join(fakeModule, "kontra.py"), `
class Result:
    def __init__(self, kwargs): self.kwargs = kwargs
    def to_dict(self): return self.kwargs
    def to_llm(self): return "ok"

def compare(*args, key=None, before_key=None, after_key=None, sample_limit=0, save=False):
    if args[0] == "error":
        raise ValueError("postgres://alice:hunter2@db.example.com/app")
    return Result({
        "key": key,
        "before_key": before_key,
        "after_key": after_key,
        "sample_limit": sample_limit,
    })

def profile_relationship(*args, on=None, left_on=None, right_on=None, sample_limit=0, save=False):
    return Result({
        "on": on,
        "left_on": left_on,
        "right_on": right_on,
        "sample_limit": sample_limit,
    })

def list_datasources(): return {"pg": ["users", "orders"], "lake": ["users"]}

def health():
    return {"version": "1.2.3", "status": "ok", "config_path": ".kontra/config.yml", "rule_count": 18}

def validate(*args, contract=None, dry_run=False, only=None, columns=None, **kwargs):
    if dry_run:
        return Result({"valid": True, "rules_count": 2, "only": only, "columns": columns})
    source = args[0] if args else None
    execution_source = {"metadata": "metadata", "polars": "polars"}.get(source, "sql")
    return Result({"passed": True, "only": only, "columns": columns, "rules": [{"source": execution_source}]})

def explain(*args, contract=None, only=None, columns=None):
    return Result({"total_rules": 2, "summary": {"sql": 2}, "rules": [{"tier": "sql"}], "only": only, "columns": columns})

def compare_profiles(*args, preset="scan", columns=None):
    return Result({"changes": {"row_count_delta": 0, "columns_added": [], "columns_removed": [], "columns_changed": []}})

def profile_diff(source, since=None): return None
`);

  const run = (request: Record<string, unknown>) => {
    const result = spawnSync(python!, [bridge], {
      input: JSON.stringify(request),
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: fakeModule },
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      summary: string;
      result?: Record<string, unknown>;
      execution?: string[];
    };
  };

  assert.equal(run({ operation: "compare", before: "a", after: "b", key: "id" }).result?.sample_limit, 0);
  assert.equal(run({ operation: "relationship", left: "a", right: "b", on: "id" }).result?.sample_limit, 0);
  const compare = run({
    operation: "compare", before: "a", after: "b", beforeKey: "source_id", afterKey: "id",
  });
  assert.equal(compare.ok, true);
  assert.equal(compare.result?.before_key, "source_id");
  assert.equal(compare.result?.after_key, "id");
  const relationship = run({
    operation: "relationship", left: "a", right: "b", leftOn: "user_id", rightOn: "id",
  });
  assert.equal(relationship.ok, true);
  assert.equal(relationship.result?.left_on, "user_id");
  assert.equal(relationship.result?.right_on, "id");
  const sources = run({ operation: "sources" });
  assert.equal(sources.ok, true);
  assert.equal(sources.summary, "SOURCES: 2 datasources, 3 tables\n  lake: users\n  pg: users, orders");
  assert.equal(run({ operation: "doctor" }).result?.datasource_count, 2);
  assert.equal(run({ operation: "check", contract: "contract.yml" }).result?.valid, true);
  const targeted = run({ operation: "validate", contract: "contract.yml", only: ["unique"] });
  assert.deepEqual(targeted.result?.only, ["unique"]);
  const targetedColumns = run({ operation: "validate", contract: "contract.yml", columns: ["email"] });
  assert.deepEqual(targetedColumns.result?.columns, ["email"]);
  assert.deepEqual(run({ operation: "validate", source: "postgresql://db/users", contract: "contract.yml" }).execution, ["postgres"]);
  assert.deepEqual(run({ operation: "validate", source: "clickhouse://db/events", contract: "contract.yml" }).execution, ["clickhouse"]);
  assert.deepEqual(run({ operation: "validate", source: "mssql://db/dbo.users", contract: "contract.yml" }).execution, ["mssql"]);
  assert.deepEqual(run({ operation: "validate", source: "sqlserver://db/dbo.users", contract: "contract.yml" }).execution, ["mssql"]);
  assert.deepEqual(run({ operation: "validate", source: "metadata", contract: "contract.yml" }).execution, ["metadata"]);
  assert.deepEqual(run({ operation: "validate", source: "polars", contract: "contract.yml" }).execution, ["polars"]);
  const conflictingFilters = run({ operation: "validate", contract: "contract.yml", only: ["unique"], columns: ["email"] });
  assert.equal(conflictingFilters.ok, false);
  assert.match(conflictingFilters.summary, /either only or columns/);
  const explained = run({ operation: "explain", contract: "contract.yml", only: ["unique"] });
  assert.deepEqual(explained.result?.only, ["unique"]);
  assert.equal(run({ operation: "profile_compare", before: "a", after: "b" }).ok, true);
  assert.equal(run({ operation: "profile_diff", source: "a" }).result?.has_history, false);
  const failure = run({ operation: "compare", before: "error", after: "b", key: "id" });
  assert.equal(failure.ok, false);
  assert.equal(failure.summary, "postgres://alice:***@db.example.com/app");
});

test("the bridge matches the real Kontra public API", { skip: !kontraPython }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kontra-pi-integration-"));
  await writeFile(join(cwd, "before.csv"), "id,email,age\n1,a@example.com,10\n2,a@example.com,121\n");
  await writeFile(join(cwd, "after.csv"), "id,email,age,status\n1,a@example.com,10,active\n2,b@example.com,21,active\n3,c@example.com,30,new\n");
  await writeFile(join(cwd, "contract.yml"), `
name: users
datasource: before.csv
rules:
  - name: not_null
    params: { column: id }
  - name: unique
    params: { column: email }
  - name: range
    params: { column: age, min: 0, max: 120 }
`);

  const run = (request: Record<string, unknown>) => {
    const process = spawnSync(kontraPython!, [bridge], {
      cwd,
      input: JSON.stringify(request),
      encoding: "utf8",
    });
    assert.notEqual(process.stdout, "", process.stderr);
    return JSON.parse(process.stdout) as { ok: boolean; summary: string; result?: Record<string, unknown>; execution?: string[] };
  };

  const check = run({ operation: "check", contract: "contract.yml" });
  assert.equal(check.ok, true);
  assert.equal(check.result?.valid, true);

  const targeted = run({ operation: "validate", contract: "contract.yml", only: ["not_null"], save: false });
  assert.equal(targeted.ok, true);
  assert.equal(targeted.result?.passed, true);
  assert.equal(targeted.result?.total_rules, 1);
  assert.deepEqual(targeted.execution, ["duckdb"]);

  const explain = run({ operation: "explain", contract: "contract.yml" });
  assert.equal(explain.ok, true);
  assert.equal(explain.result?.total_rules, 3);

  const comparison = run({ operation: "profile_compare", before: "before.csv", after: "after.csv", preset: "scan" });
  assert.equal(comparison.ok, true);
  const changes = comparison.result?.changes as Record<string, unknown>;
  assert.deepEqual(changes.columns_added, ["status"]);
  assert.equal(changes.row_count_delta, 1);
  assert.deepEqual(comparison.execution, ["duckdb"]);
});
