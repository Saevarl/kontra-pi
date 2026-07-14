# Contributing

Keep the extension small, inspectable, and native to Pi.

## Setup

```bash
git clone https://github.com/Saevarl/kontra-pi.git
cd kontra-pi
npm install --ignore-scripts
npm run check
```

Kontra must be importable for the live bridge test:

```bash
python -m pip install "kontra>=0.13.0"
export KONTRA_PYTHON="$(command -v python)"
```

Try the package without installing it:

```bash
pi -e .
```

## Shape of the code

- `extensions/index.ts` registers the tool, command, renderer, activity, and gate.
- `extensions/bridge.ts` owns the bounded child process.
- `bridge/bridge.py` maps the protocol to Kontra's public Python API.
- `extensions/render.ts` contains presentation only.
- `skills/kontra/SKILL.md` teaches the model when and how to measure.

Rule semantics belong to Kontra's Python catalog. Do not mirror them in the
extension or skill; the `rules` operation must stay a thin, version-matched
view over the installed library.

## Pull requests

- Add a focused test for behavior changes.
- Keep samples at zero unless the user explicitly asks for rows.
- Do not add arbitrary Python, SQL, package installation, credential discovery,
  background services, or a second model tool.
- Run `npm run check` and `npm pack --dry-run` before opening a PR.

Use a short imperative title and explain the user-visible behavior in the PR
body. Screenshots are useful for renderer changes; expanded and collapsed
states should both be shown.
