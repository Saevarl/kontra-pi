import assert from "node:assert/strict";
import test from "node:test";
import { configuredEnvironmentSecrets, redact, sanitize } from "../extensions/redact.js";

test("redacts headers, signed URLs, provider tokens, JWTs, and private keys", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123";
  const input = [
    "Authorization: Bearer bearer-value",
    "X-Api-Key: header-value",
    "https://example.test/file?X-Amz-Signature=signed-value&safe=yes",
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
    jwt,
    "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
  ].join("\n");
  const output = redact(input, []);
  for (const secret of ["bearer-value", "header-value", "signed-value", "ghp_abcdefghijklmnopqrstuvwxyz123456", jwt, "private-material"]) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /safe=yes/);
});

test("recursively redacts sensitive fields and exact environment credential values", () => {
  const result = sanitize({
    password: "unpatterned-value",
    nested: [{ note: "driver leaked opaque-env-value" }],
    source: "postgres://alice:hunter2@db.example.test/app",
    token_count: 12,
  }, ["opaque-env-value"]);
  assert.deepEqual(result, {
    password: "[redacted]",
    nested: [{ note: "driver leaked [redacted]" }],
    source: "postgres://alice:***@db.example.test/app",
    token_count: 12,
  });
});

test("credential environment discovery excludes the shell working directory", () => {
  const secrets = configuredEnvironmentSecrets({
    PWD: "/project/visible",
    OLDPWD: "/project/old",
    DB_PWD: "database-secret",
    SERVICE_TOKEN: "service-secret",
  });
  assert.deepEqual(secrets.sort(), ["database-secret", "service-secret"]);
});
