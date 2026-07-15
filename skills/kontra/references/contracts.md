# Kontra contracts

Read nearby contracts before introducing new policy. Existing severity levels,
context keys, naming, and inheritance are stronger evidence than generic
conventions.

## Workflow

1. Use `sources`, then `profile` the intended datasource.
2. Use `rules` without `rule` for the compact rule index.
3. Call `rules` with `rule` for every unfamiliar rule. Its parameters, NULL
   behavior, counting semantics, and YAML match the installed Kontra version.
4. Write the contract with Pi's normal file tools.
5. Run `check`, then `explain`, then `validate` when data access is intended.

## Shape

A contract requires `name`, `datasource`, and `rules`. It may also include a
human-readable `description` or `extends` for inheritance. Follow nearby
contracts when either convention is already established.

```yaml
name: users
datasource: warehouse.users
description: Production user records
rules:
  - name: not_null
    params:
      column: user_id
    severity: blocking
    context:
      owner: identity-team
      fix_hint: Restore user_id in the upstream transform
```

Each rule requires `name` and `params`. It may also contain:

- `id`: a stable explicit identifier, useful when otherwise identical rule IDs
  would collide.
- `severity`: `blocking` (default), `warning`, or `info`.
- `tally`: request exact counts (`true`) or permit fail-fast execution (`false`)
  for rules that support it.
- `context`: consumer-owned metadata that Kontra preserves but does not
  interpret.

## Severity

- `blocking` failures make `result.passed` false and fail the completion gate.
- `warning` failures are reported but do not block.
- `info` failures are informational and do not block.

Severity is business policy. Do not infer it from a rule name or choose a less
strict level to make validation pass. Use the user's request or established
project artifacts; ask when the choice matters and no policy exists.

## Context

Context can carry project conventions such as `owner`, `fix_hint`, `tags`,
`runbook`, or `sla_hours`. These names are examples, not a fixed schema. Reuse
keys and values established by the project. Do not invent ownership, SLAs, or
remediation instructions, and never put credentials or secrets in context.

A `fix_hint` is evidence for diagnosis, not permission to change data, code, or
the contract. Never weaken a contract merely to obtain a passing result.

Use `custom_sql_check` only when the requested behavior cannot be expressed by
a built-in rule.
