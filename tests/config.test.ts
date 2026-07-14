import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertRequestAllowed, globMatches, loadConfig } from "../extensions/config.js";

test("loads conservative defaults without a config file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kontra-pi-"));
  const config = await loadConfig(cwd);
  assert.equal(config.gate.enabled, false);
  assert.equal(config.allowRemoteSources, false);
  assert.equal(config.gate.continueOnFailure, false);
});

test("loads and bounds project configuration", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kontra-pi-"));
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi/kontra.json"), JSON.stringify({
    timeoutMs: 5,
    gate: { enabled: true, contracts: ["contracts/a.yml"], sample: 200 },
  }));
  const config = await loadConfig(cwd);
  assert.equal(config.timeoutMs, 1_000);
  assert.equal(config.gate.sample, 20);
  assert.deepEqual(config.gate.contracts, ["contracts/a.yml"]);
});

test("glob matching handles Pi-style project paths", () => {
  assert.equal(globMatches("src/**", "src/jobs/load.ts"), true);
  assert.equal(globMatches("**/*.sql", "models/marts/users.sql"), true);
  assert.equal(globMatches("src/*.ts", "src/jobs/load.ts"), false);
});

test("blocks outside paths and remote URIs by default", () => {
  const config = {
    allowOutsideProject: false,
    allowRemoteSources: false,
    timeoutMs: 1_000,
    gate: { enabled: false, contracts: [], include: ["**/*"], afterBash: false, tally: false, sample: 0, save: true, continueOnFailure: false },
  };
  assert.throws(() => assertRequestAllowed("/project", { operation: "validate", contract: "../contract.yml" }, config));
  assert.throws(() => assertRequestAllowed("/project", { operation: "profile", source: "s3://bucket/data.parquet" }, config));
  assert.doesNotThrow(() => assertRequestAllowed("/project", { operation: "profile", source: "warehouse.users" }, config));
});

test("blocks an in-project symlink that resolves outside the project", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kontra-pi-project-"));
  const outside = await mkdtemp(join(tmpdir(), "kontra-pi-outside-"));
  const outsideContract = join(outside, "contract.yml");
  await writeFile(outsideContract, "name: outside\n");
  await symlink(outsideContract, join(cwd, "contract.yml"));
  const config = {
    allowOutsideProject: false,
    allowRemoteSources: false,
    timeoutMs: 1_000,
    gate: { enabled: false, contracts: [], include: ["**/*"], afterBash: false, tally: false, sample: 0, save: true, continueOnFailure: false },
  };
  assert.throws(() => assertRequestAllowed(cwd, { operation: "validate", contract: "contract.yml" }, config));
});
