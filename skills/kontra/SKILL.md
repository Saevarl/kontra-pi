---
name: kontra
description: Discover data sources and measure contract validity, execution plans, data quality, dataset shape, drift, transformation effects, and join relationships with the native kontra tool.
---

# Kontra

Use the `kontra` tool when code reads, writes, joins, aggregates, deduplicates,
or otherwise transforms tabular data.

## Pick the smallest measurement

- `sources`: you need safe datasource/table discovery without reading config.
- `rules`: you need the built-in rule index or exact semantics for one rule.
- `doctor`: the Python, Kontra, or project configuration is uncertain.
- `check`: a contract changed and syntax should be verified without touching data.
- `explain`: you need to know where rules execute before running them.
- `validate`: a contract exists and you need pass/fail or violation counts.
- `profile`: you need shape, types, nulls, cardinality, or distributions.
- `diff`: you need change between saved validation runs.
- `profile_diff`: you need drift between saved profiles.
- `compare`: you have before/after sources and need row or key effects.
- `profile_compare`: you have two sources but no stable row key.
- `relationship`: you need join cardinality, coverage, or key multiplicity.

`compare` and `relationship` are probes. They report facts; they do not prove a
transformation is correct or select a join type.

Use `only` or `columns` for a targeted validation when the affected rules are
known. Do not use a narrow validation to claim the entire contract passed.

## Author contracts without guessing

When the user asks for a contract, or the task explicitly requires one:

1. Use `sources`, then `profile` the intended datasource.
2. Use `rules` without `rule` for the compact index.
3. Call `rules` with `rule` for every unfamiliar rule before writing it. Treat
   the returned parameters, NULL behavior, counting semantics, and YAML as the
   version-matched source of truth.
4. Write the contract with Pi's normal file tools.
5. Run `check`, then `explain`, then `validate` when data access is intended.

Do not invent thresholds, allowed values, severity, freshness windows, or other
business policy. Take them from the user's request or established project
artifacts; otherwise ask. Use `custom_sql_check` only when the user explicitly
needs behavior the built-ins cannot express.

A contract file uses this envelope; insert the exact rule entry returned by
`rules` under `rules:`:

```yaml
name: users
datasource: warehouse.users
rules:
  - name: not_null
    params: { column: user_id }
```

## Cost discipline

Start with `sample: 0`. Use samples only to explain a measured failure and keep
them bounded. Use `tally: false` for fast existence checks. Use `tally: true`
only when exact counts affect the next decision.

Profiles have three depths: `scout` for metadata, `scan` for normal work, and
`interrogate` for deliberately deeper analysis.

## Invariants

- Never weaken a contract just to obtain a passing result.
- Draft or edit contracts only when requested or required by the task; syntax
  knowledge is not permission to choose policy.
- Never describe a lower-bound count as exact.
- Do not expose sampled rows unnecessarily; they may contain sensitive data.
- Prefer structured measurements over guesses from a few rows.
- Report what changed, the key used, and the limits of the measurement.
