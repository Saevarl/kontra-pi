# Configuration

`kontra-pi` reads project settings from `.pi/kontra.json`. No file is required.

## Python

The extension selects the first Python that can import `kontra`:

1. `python` in `.pi/kontra.json`
2. `KONTRA_PYTHON`
3. the active `VIRTUAL_ENV`
4. `.venv/bin/python`
5. `venv/bin/python`
6. `python3`, then `python`

Pin it when a repository has more than one environment:

```json
{
  "python": ".venv/bin/python"
}
```

`/kontra doctor` shows the selected executable, Kontra version, configuration,
rule count, and datasource count.

## Project boundary

```json
{
  "allowOutsideProject": false,
  "allowRemoteSources": false,
  "timeoutMs": 120000
}
```

| Setting | Default | Meaning |
|---|---:|---|
| `allowOutsideProject` | `false` | Allow path-like sources and contracts outside the trusted project root. |
| `allowRemoteSources` | `false` | Allow raw remote URIs in tool requests. Named Kontra datasources are unaffected. |
| `timeoutMs` | `120000` | Child-process timeout, bounded to 1–600 seconds. |

Prefer named datasources for databases and object stores. Their credentials stay
in Kontra's configuration and never need to appear in the model request.

## Completion gate

The gate runs configured contracts once when an agent run finishes after a
matching successful edit.

```json
{
  "gate": {
    "enabled": true,
    "contracts": [
      "contracts/users.yml",
      "contracts/orders.yml"
    ],
    "include": [
      "src/**",
      "models/**",
      "pipelines/**"
    ],
    "afterBash": false,
    "tally": false,
    "sample": 0,
    "save": true,
    "continueOnFailure": false
  }
}
```

| Setting | Default | Meaning |
|---|---:|---|
| `enabled` | `false` | Run automatically at agent completion. `/kontra gate` remains available when off. |
| `contracts` | `[]` | Project-relative contract files to validate. |
| `include` | `["**/*"]` | File globs that mark the gate dirty after successful Pi edits. |
| `afterBash` | `false` | Also mark the gate dirty after a successful shell command. |
| `tally` | `false` | Request exact failure counts rather than fail-fast checks. |
| `sample` | `0` | Failure rows per rule, bounded to 0–20. |
| `save` | `true` | Save validation state through Kontra. |
| `continueOnFailure` | `false` | Give Pi one follow-up turn containing the failed measurement. |

The gate never edits a contract or retries indefinitely. A failure is a
measurement for the project to interpret.

## Kontra datasources

Datasource configuration belongs to Kontra, normally in `.kontra/config.yml`:

```yaml
version: "1"

datasources:
  warehouse:
    type: postgres
    host: ${PGHOST}
    user: ${PGUSER}
    password: ${PGPASSWORD}
    database: analytics
    tables:
      users: public.users
```

Pi can then ask for `warehouse.users`; the connection string is resolved inside
Kontra's Python process.
