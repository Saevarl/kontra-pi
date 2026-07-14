<p align="center">
  <img src="assets/kontra-pi.svg" width="128" alt="kontra-pi logo">
</p>

<h1 align="center">kontra-pi</h1>

<p align="center">Native data-quality measurements for Pi.</p>

<p align="center">
  <a href="https://github.com/Saevarl/kontra-pi/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Saevarl/kontra-pi/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-2743F0"></a>
  <a href="https://pi.dev"><img alt="Pi 0.80+" src="https://img.shields.io/badge/Pi-0.80%2B-111318"></a>
</p>

One tool connects [Pi](https://pi.dev) to [Kontra](https://kontrakit.io):
discover sources and exact rule semantics, validate contracts, profile data,
inspect execution plans, compare transformations, measure relationships, and
track drift.

No server. No MCP configuration. One short-lived Python process per
measurement.

## Install

Install Kontra in the Python environment used by your project, then install the
Pi package:

```bash
pip install "kontra>=0.13.0"
pi install npm:kontra-pi
```

Or try it for one session:

```bash
pi -e git:github.com/Saevarl/kontra-pi
```

Inside Pi:

```text
> What data sources does Kontra know about?
> Write a contract for warehouse.users. Inspect every rule you use first.
> Explain how contracts/users.yml will execute.
> Validate contracts/users.yml.
> Compare raw.users and warehouse.users on user_id.
```

Run `/kontra doctor` if Pi cannot find the intended Python environment.
Exact rule lookups require Kontra 0.13.0 or newer.

## What it adds

The model receives one `kontra` tool with a small operation field:

| Need | Operations |
|---|---|
| Discover | `rules`, `sources`, `doctor` |
| Contracts | `check`, `explain`, `validate` |
| Profiles | `profile`, `profile_compare`, `profile_diff` |
| History | `diff` |
| Probes | `compare`, `relationship` |

Collapsed results stay short:

```text
kontra validate contracts/events.yml
✓ 4/4 passed · 100,000 rows

kontra compare raw.users → warehouse.users
Δ 5→5 rows · 0 dropped · 0 added · 3 changed

kontra rules unique
◆ unique · column
```

Expand a result to see Kontra's semantic summary, the Python executable, and
the concrete execution path: `metadata`, `postgres`, `mssql`, `clickhouse`,
`duckdb`, or `polars`.

The human-facing slash command stays equally small:

```text
/kontra status
/kontra rules
/kontra sources
/kontra doctor
/kontra gate
/kontra help
```

## Configuration

The extension works without configuration. To select Python explicitly, add
`.pi/kontra.json`:

```json
{
  "python": ".venv/bin/python"
}
```

The optional completion gate validates selected contracts once after Pi edits
a matching file:

```json
{
  "gate": {
    "enabled": true,
    "contracts": ["contracts/users.yml"],
    "include": ["src/**", "models/**", "pipelines/**"]
  }
}
```

See [configuration](docs/configuration.md) for every setting,
[troubleshooting](docs/troubleshooting.md) for setup failures, and
[security](SECURITY.md) for the trust boundary.

## Defaults that matter

- Samples default to zero.
- Remote URIs and paths outside the project are rejected by default.
- Named Kontra datasources remain available without placing credentials in the
  tool request.
- Commands use argument arrays with `shell: false`.
- Timeout, cancellation, and the 2 MiB output limit are distinct failures.
- The completion gate is off until a project enables it.

Exact counts cost more. Pi asks for `tally` or bounded samples only when the
next decision needs them.

## Contract authoring

Kontra owns the rule reference, so Pi reads the catalog from the installed
version instead of carrying a stale copy. A compact `rules` call lists the
built-ins; a named lookup returns exact parameters, inclusive boundaries, NULL
behavior, counting semantics, tally support, and valid YAML.

Pi can then write a requested contract with its normal file tools and run
`check`, `explain`, and `validate`. The extension supplies mechanics, not
policy: it does not choose thresholds, allowed values, severity, or freshness
windows for you.

## Why a native package?

Kontra's official MCP server is the right fit for a shared or remote service.
`kontra-pi` is for local Pi workflows: it uses the project's Python environment,
renders directly in the terminal, and requires nothing to keep running.

## Development

```bash
npm install --ignore-scripts
npm run check
pi -e .
```

The bridge protocol is deliberately plain JSON over stdin/stdout. Start with
[DESIGN.md](DESIGN.md), then read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
