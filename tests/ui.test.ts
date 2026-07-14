import assert from "node:assert/strict";
import test from "node:test";
import { ActivityStatus } from "../extensions/activity.js";
import { parseKontraCommand } from "../extensions/commands.js";
import { gateOutcomeLines } from "../extensions/render.js";

test("footer activity is temporary and handles parallel measurements", () => {
  const updates: Array<string | undefined> = [];
  const ui = { setStatus: (_key: string, text: string | undefined) => updates.push(text) };
  const status = new ActivityStatus();

  const finishProfile = status.begin("profiling pg.users", ui);
  const finishValidation = status.begin("validating contracts/users.yml", ui);
  finishValidation();
  finishProfile();

  assert.deepEqual(updates, [
    "kontra: profiling pg.users",
    "kontra: 2 measurements",
    "kontra: profiling pg.users",
    undefined,
  ]);
});

test("gate output retains contract identity", () => {
  assert.deepEqual(gateOutcomeLines([
    { contract: "contracts/local.yml", passed: true, summary: "PASSED" },
    { contract: "contracts/pg.yml", passed: false, summary: "VALIDATION: pg FAILED\nBLOCKING: unique" },
  ]), [
    "✓ contracts/local.yml",
    "✗ contracts/pg.yml — VALIDATION: pg FAILED",
  ]);
});

test("unknown slash arguments do not collapse to status", () => {
  assert.equal(parseKontraCommand(""), "status");
  assert.equal(parseKontraCommand("doctor"), "doctor");
  assert.equal(parseKontraCommand("wat"), undefined);
});
