# ask-jev-skill

A Claude Code skill plus a dependency-free `jev` CLI (Bun) that lets Claude offload cheap, repetitive judgments to [TypeSafe Jev](https://docs.typesafe.ai/introduction): which files to read, whether a command's output means pass or fail, which skill fits a request, filtering and ranking many items. The raw content stays out of Claude's context.

## Install

```bash
./install.sh                      # symlinks skill/ -> ~/.claude/skills/ask-jev and bin/jev.ts -> ~/.local/bin/jev
export TYPESAFE_API_KEY=...       # from https://console.typesafe.ai/keys
```

## Develop

```bash
bun test
```

- `src/jev.ts`: API client (retries on 429/529, redacts secrets), confidence-to-action thresholds, keyed ranking
- `src/triage.ts`: output tailing and line matching for `jev triage`
- `bin/jev.ts`: CLI (`yes`, `pick`, `rate`, `rank`, `triage`)
- `skill/SKILL.md`: what Claude reads

Ranking uses keyed references (`candidates.k3`) instead of array positions. Positional indexing misfires 9 to 27% of the time ([measured here](https://gist.github.com/pedramamini/014676fa8684d91bf7000f4623701ada)).
