#!/usr/bin/env bash
# Symlinks the ask-jev skill into Claude Code and the jev CLI onto PATH. Re-runnable.
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
skills="$HOME/.claude/skills"
bin="$HOME/.local/bin"

command -v bun >/dev/null || { echo "bun is required: https://bun.sh" >&2; exit 1; }

mkdir -p "$skills" "$bin"
ln -sfn "$repo/skill" "$skills/ask-jev"
ln -sfn "$repo/bin/jev.ts" "$bin/jev"
chmod +x "$repo/bin/jev.ts"

echo "skill: $skills/ask-jev -> $repo/skill"
echo "cli:   $bin/jev -> $repo/bin/jev.ts"
case ":$PATH:" in *":$bin:"*) ;; *) echo "add $bin to PATH" ;; esac
[ -n "${TYPESAFE_API_KEY:-}" ] || echo "set TYPESAFE_API_KEY (key from https://console.typesafe.ai/keys)"
