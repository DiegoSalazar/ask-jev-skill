# ask-jev-skill

A Claude Code skill plus a dependency-free `jev` CLI (Bun) that lets Claude offload cheap, repetitive judgments to [TypeSafe Jev](https://docs.typesafe.ai/introduction): which files to read, whether a command's output means pass or fail, which skill fits a request, filtering and ranking many items. The raw content stays out of Claude's context.

## Install

```bash
./install.sh                      # symlinks skill/ -> ~/.claude/skills/ask-jev and bin/jev.ts -> ~/.local/bin/jev
export TYPESAFE_API_KEY=...       # from https://console.typesafe.ai/keys
```

## Local backend (no API key, nothing leaves your machine)

Runs [Kev](https://github.com/jaredpalmer/kev) (Apache-2.0), an open model with the same request and response format as Jev. On Apple Silicon it uses PyTorch MPS. kev-4b needs 13 to 22 GB of unified memory, so close Colima/Docker and other heavy apps first, or it will swap and slow to a crawl. Requires [uv](https://docs.astral.sh/uv/) and [bun](https://bun.sh).

```bash
pnpm install    # clones Kev at a pinned commit into vendor/kev and installs its deps
pnpm start      # serves kev-4b on 127.0.0.1:8009 (first run downloads ~8 GB)
export JEV_API_URL=http://127.0.0.1:8009/v1/systemone
```

- `pnpm start` refuses to launch kev-4b with less than ~20 GB free, and warns if Colima is running. Override with `KEV_SKIP_MEM_CHECK=1`.
- If requests slow to tens of seconds after the server has sat idle for hours, restart it: macOS has paged the weights out.
- `KEV_MODEL=jaredpalmer/kev-0.8b pnpm start` runs the smaller model (~6 GB, less accurate).
- `KEV_PORT` changes the port.
- Set `ASK_JEV_SKIP_LOCAL=1` before `pnpm install` to skip the Kev setup.

When `JEV_API_URL` points at localhost, the CLI:
- sends no API key
- raises every confidence bar by 0.1, because Kev's calibration error is 2-3x Jev's ([benchmark](https://opper.ai/blog/jev-vs-kev-open-decision-model))
- sends shorter inputs, because Kev was trained on at most 384 tokens

## Develop

```bash
pnpm test
```

- `src/jev.ts`: API client (retries on 429/529, redacts secrets), confidence-to-action thresholds, keyed ranking
- `src/triage.ts`: output tailing and line matching for `jev triage`
- `bin/jev.ts`: CLI (`yes`, `pick`, `rate`, `rank`, `triage`)
- `skill/SKILL.md`: what Claude reads

Ranking uses keyed references (`candidates.k3`) instead of array positions. Positional indexing misfires 9 to 27% of the time ([measured here](https://gist.github.com/pedramamini/014676fa8684d91bf7000f4623701ada)).
