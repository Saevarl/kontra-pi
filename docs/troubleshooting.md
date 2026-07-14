# Troubleshooting

Start with:

```text
/kontra doctor
```

It reports the selected Python, Kontra version, project configuration, rules,
and configured datasource count.

## Kontra is not importable

Install Kontra into the project's environment and point the extension at it:

```bash
.venv/bin/python -m pip install kontra
```

```json
{
  "python": ".venv/bin/python"
}
```

`KONTRA_PYTHON` is useful in CI or temporary shells.

## A datasource is unknown

Run `/kontra sources`. Named sources come from Kontra's project configuration,
normally `.kontra/config.yml`. The extension does not discover credentials or
invent connection strings.

## A path or URI is rejected

Paths outside the project and raw remote URIs are blocked by default. Prefer a
named Kontra datasource. If the broader access is intentional, enable the
specific boundary in `.pi/kontra.json`:

```json
{
  "allowOutsideProject": true,
  "allowRemoteSources": true
}
```

These settings expand what the model can ask the child process to read. Treat
them as security decisions, not convenience flags.

## A measurement times out

The default timeout is two minutes. Increase it up to ten minutes:

```json
{
  "timeoutMs": 300000
}
```

Before increasing it, try `explain`, the `scout` profile preset, or fail-fast
validation without `tally`.

## The gate says it is off

That message describes automatic end-of-run validation. `/kontra gate` still
runs configured gate contracts manually. Set `gate.enabled` to `true` only when
automatic validation is wanted.

## Database driver errors

Drivers belong to the Python environment, not the Pi package. Install the
backend extra or driver recommended by Kontra, then rerun `/kontra doctor` from
the same project.
