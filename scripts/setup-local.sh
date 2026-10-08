#!/usr/bin/env bash
# Installs Kev, an open Jev-compatible decision server, into vendor/kev. Runs on `pnpm install`; re-runnable.
# Skip with ASK_JEV_SKIP_LOCAL=1 (e.g. CI, or hosted Jev only).
set -euo pipefail

KEV_REPO="https://github.com/jaredpalmer/kev.git"
KEV_REF="3aa96e53f8ed00a87434d69cb62b24bb16246816" # tag kev-family (Kev 1.0)

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/vendor/kev"

if [ "${ASK_JEV_SKIP_LOCAL:-}" = "1" ]; then
  echo "ask-jev: skipping local Kev setup (ASK_JEV_SKIP_LOCAL=1)"
  exit 0
fi

command -v uv >/dev/null || { echo "ask-jev: uv is required for the local backend: brew install uv" >&2; exit 1; }

if [ ! -d "$dir/.git" ]; then
  echo "ask-jev: cloning Kev into vendor/kev"
  git clone --quiet "$KEV_REPO" "$dir"
fi

if [ "$(git -C "$dir" rev-parse HEAD)" != "$KEV_REF" ]; then
  git -C "$dir" fetch --quiet origin
  git -C "$dir" -c advice.detachedHead=false checkout --quiet "$KEV_REF"
fi

echo "ask-jev: installing Kev server dependencies (uv sync --extra serve)"
(cd "$dir" && uv sync --quiet --extra serve)

echo "ask-jev: local backend ready. Start it with: pnpm start"
