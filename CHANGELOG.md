# Changelog

## 0.1.2 — credential redaction

- Recursively redact credentials from successful and failed Kontra responses.
- Add Pi tool-result and context redaction hooks so credentials from other tool
  output and older transcript entries are scrubbed before model calls.
- Cover authorization/API-key headers, signed URL parameters, structured secret
  fields, private keys, common provider tokens, JWTs, and exact values from
  credential-named environment variables.
- Verify compatibility with Kontra 0.14.1; its set-based SQL compare pushdown is
  used automatically through the existing compare operation.

## 0.1.1 — MIT license

- Relicense `kontra-pi` under the MIT License. Kontra itself remains Apache-2.0.

## 0.1.0 — first public release

- Add native validate, profile, history, transformation, and relationship operations.
- Add live compact and per-rule references for reliable contract authoring.
- Add Pi-native collapsed and expanded result rendering with execution provenance.
- Add temporary footer activity and `/kontra` diagnostics.
- Add the opt-in completion gate.
- Default all samples to zero and enforce project, URI, timeout, cancellation,
  output, symlink, and credential-redaction boundaries.
