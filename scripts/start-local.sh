#!/usr/bin/env bash
# Serves Kev on 127.0.0.1. First run downloads the model from Hugging Face (~8 GB for 4B).
# Refuses to start without enough free memory (kev-4b: ~20 GB); override with KEV_SKIP_MEM_CHECK=1.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/vendor/kev"
model="${KEV_MODEL:-jaredpalmer/kev-4b}"
port="${KEV_PORT:-8009}"

[ -d "$dir/.git" ] || bash "$root/scripts/setup-local.sh"

if [ "${KEV_SKIP_MEM_CHECK:-}" != "1" ]; then
  bun "$root/src/memory.ts" "$model"
  if command -v colima >/dev/null && colima status >/dev/null 2>&1; then
    echo "ask-jev: warning: Colima is running; Kev and Docker together may swap. Consider: colima stop" >&2
  fi
fi

echo "ask-jev: serving $model on http://127.0.0.1:$port"
echo "ask-jev: in another shell: export JEV_API_URL=http://127.0.0.1:$port/v1/systemone"
cd "$dir"
exec uv run --extra serve python -m kev.serve --run "$model" --port "$port"
