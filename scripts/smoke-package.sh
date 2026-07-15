#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/kontra-pi-smoke.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

cd "$ROOT"
TARBALL=$(npm pack --silent --pack-destination "$WORK")

"${PYTHON:-python3}" -m venv "$WORK/venv"
"$WORK/venv/bin/python" -m pip install --quiet "kontra>=0.13.0"

mkdir "$WORK/project"
cd "$WORK/project"
npm init --yes >/dev/null
npm install --quiet --ignore-scripts "$WORK/$TARBALL"
test -f node_modules/kontra-pi/skills/kontra/references/contracts.md

PI_CODING_AGENT_DIR="$WORK/pi-home" \
  KONTRA_PYTHON="$WORK/venv/bin/python" \
  ./node_modules/.bin/pi \
  -e ./node_modules/kontra-pi \
  --offline \
  --list-models >/dev/null

printf 'id,email\n1,ada@example.com\n2,grace@example.com\n' > users.csv
printf '%s\n' \
  'name: users' \
  'datasource: users.csv' \
  'rules:' \
  '  - name: not_null' \
  '    params: { column: id }' \
  '  - name: unique' \
  '    params: { column: email }' > users.yml

printf '%s' '{"operation":"rules","rule":"unique"}' \
  | "$WORK/venv/bin/python" node_modules/kontra-pi/bridge/bridge.py \
  | node -e 'let value=""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => { const response=JSON.parse(value); if (!response.ok || response.result?.name !== "unique") process.exit(1); });'

printf '%s' '{"operation":"validate","contract":"users.yml","save":false}' \
  | "$WORK/venv/bin/python" node_modules/kontra-pi/bridge/bridge.py \
  | node -e 'let value=""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => { const response=JSON.parse(value); if (!response.ok || response.result?.passed !== true) process.exit(1); });'

echo "package smoke test passed"
