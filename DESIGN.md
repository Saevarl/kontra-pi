# kontra-pi design

## Intent

Make Kontra feel native inside Pi without turning Pi into a data platform.

That requires restraint: a small surface, inspectable code, terminal-native
output, and no background machinery.

## Surface

There is one LLM tool: `kontra`.

Its operation selects one bounded measurement or inspection:

- `sources` — list configured datasource and table names without credentials
- `rules` — inspect the compact built-in index or one exact rule specification
- `doctor` — report the local Kontra/Python/config integration
- `check` — validate contract syntax without reading data
- `explain` — preview metadata, SQL, and Polars execution tiers
- `validate` — measure a source against a contract
- `profile` — inspect one source
- `diff` — compare saved validation runs
- `profile_diff` — compare saved profiles over time
- `compare` — measure the effect of a transformation
- `profile_compare` — compare current profiles without requiring a key
- `relationship` — measure the shape of a possible join

One tool keeps Pi's prompt small. The operation names mirror Kontra's public
Python API. Results send concise `to_llm()` text to the model and retain the
structured result for Pi's expanded renderer.

The collapsed renderer states only what the measurement supports: validation
and contract syntax can pass or fail; drift can demand attention without being
called wrong; transformation and relationship probes remain measurements. The
expanded renderer keeps Kontra's semantic summary and adds backend provenance
resolved by the bridge. It never substitutes a truncated JSON dump for a view.
SQL Server is reported as `mssql`, matching Kontra's datasource type and URI
scheme; `sqlserver://` remains an accepted alias.

The `/kontra` command handles human-invoked status, rule and datasource discovery,
diagnostics, help, and gate runs. It is not a second API.

## Execution

The TypeScript extension starts a short-lived Python bridge for each operation.
The bridge reads one JSON object on stdin and writes one JSON object on stdout.
There is no server, daemon, MCP transport, socket, cache, or install-time code.

Python resolution is deterministic:

1. `.pi/kontra.json` `python`
2. `KONTRA_PYTHON`
3. the active `VIRTUAL_ENV`
4. `.venv/bin/python`
5. `venv/bin/python`
6. `python3`, then `python`

Candidates must successfully import Kontra. The extension never installs Python
packages on the user's behalf.

## Trust and boundaries

- Project configuration and execution require Pi project trust.
- Contract paths and path-like sources stay below the project root by default.
- Remote URIs are disabled by default.
- Named Kontra data sources remain usable because their credentials and network
  policy belong to Kontra's explicit project configuration.
- Commands use argument arrays, never a shell.
- Output and samples are bounded. Samples default to zero.
- Errors are redacted before entering the transcript.
- The extension accepts no arbitrary Python, SQL, or inline rule definitions.

Subprocess termination is explicit: timeout, caller cancellation, and output
overflow are separate outcomes. Pi shows activity only while work exists; the
extension does not leave a watcher or spinner behind.

## Completion gate

The gate is disabled by default. When enabled, it remembers successful Pi
`edit` and `write` calls whose paths match configured globs. Successful `bash`
calls may opt in separately. At the end of the agent run it validates configured
contracts once.

The gate does not watch files, alter contracts, choose policy, or fix data. A
failure is displayed and persisted as a Pi entry. `continueOnFailure` may opt in
to one agent continuation carrying the measurement; a continuation occurs only
after a newly dirty run, preventing a self-sustaining retry loop.

## Non-goals

- Reimplementing Kontra in TypeScript
- Managing credentials
- Mutating contracts through the Kontra tool (Pi may draft requested contracts
  with normal file tools after inspecting the live catalog)
- Choosing thresholds or business policy
- Mutating history annotations
- Recommending transformations
- Hosting state or orchestration
- Adding a bespoke UI
