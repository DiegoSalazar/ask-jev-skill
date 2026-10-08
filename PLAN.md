# Plan

## Phase 0: ask-jev skill + CLI (milestone 1) ✅

- [x] Research TypeSafe Jev (API, primitives, confidence, limits)
- [x] Survey existing skills (typesafe-ai/skills, pedramamini jev gist)
- [x] `jev` CLI: `yes`, `pick`, `rate`, `rank`, `triage`
- [x] API client with retries and secret redaction; keyed ranking
- [x] `skill/SKILL.md` with when-to-use, confidence-to-action rules, data rules
- [x] `install.sh` (symlinks skill and CLI)
- [x] Unit tests (44, API mocked)
- [x] Public repo: github.com/DiegoSalazar/ask-jev-skill

Open items carried forward:

- [ ] Smoke-test against the live API with a real `TYPESAFE_API_KEY`
- [ ] Trial in a real session; tune the skill description with skill-creator evals
- [ ] Auto-allow PreToolUse hook (blocked by auto-mode classifier; needs Diego to write it or grant permission)
- [ ] Confirm Sony data policy allows sending Abacus test output to TypeSafe

## Phase 1: local jev-like backend (milestone 2)

Goal: a dev runs `npm install` / `npm start` (or `bun`) and gets a local System One style server that the `jev` CLI and skill can use with no API key and no data leaving the machine.

- [x] Research open source System One / decision-only models (candidates named: OpenJev, Kev, NanoJev; find others)
- [x] Pick the best one to run locally (criteria: license, Apple Silicon support, latency, calibration, API compatibility with `/v1/systemone`)

### Research findings (2026-10-07)

| Project | Base | License | Apple Silicon | `/v1/systemone` | Notes |
|---|---|---|---|---|---|
| **Kev** (jaredpalmer/kev) | Qwen3.5 0.8B/4B/9B, Qwen3.8 27B | Apache-2.0 | MLX | Yes (wire-identical) | 8.6k stars. Only one with an independent benchmark vs Jev (Opper) |
| Ollaya (ollaya-dev/ollaya) | Runtime: serves Kev, Laya, decider, Von | Apache-2.0 | Metal | Yes | Single Rust binary, but `curl \| sh` install, telemetry undisclosed |
| Laya (NandhaKishorM/laya) | ModernBERT/mmBERT | ? | via laya-mlx | Yes | CPU-friendly, below Jev on benchmarks |
| OpenJev (razorback16) | DiffusionGemma 26B-A4B | Apache-2.0 | MLX | Yes | Too heavy for a laptop |
| NanoJev (TianyuCodings) | Qwen3-0.6B | ? | ? | Yes | Built for game actions, not general routing |
| logit-classifier (Blakeem) | General model logits | ? | ? | Yes | Not trained for calibration |

Several other repos also call themselves OpenJev (S1LV3RJ1NX, kyegomez, GPT-AGI, daseinlabs): early research code.

Opper benchmark, Kev-4B vs Jev 1.13 (362 items): accuracy within noise (93.9-98.3% vs 95.1-97.5%). Kev's calibration is worse (ECE 0.044-0.137 vs 0.027-0.049) and it is weak on long inputs (trained at max 384 tokens). Latency is 180-220 ms for Kev vs 265-275 ms for Jev.

**Pick: Kev-4B** served by Kev's own server (`uv` + MLX). Kev-0.8B is a lighter option.

Implications for the skill when running locally:
- Calibration is weaker, so raise the confidence bars by about 0.1, or treat `act` as `confirm` for writes.
- Short inputs only: lower `triage`'s output tail and `rank`'s `--chars` when the backend is local.
- [x] Setup script: `pnpm install` clones Kev at a pinned commit and runs `uv sync`; `pnpm start` serves kev-4b on 127.0.0.1:8009
- [x] Point the CLI at it (`JEV_API_URL` override, no key sent to localhost, bars +0.1, local limits, concurrency 1), 58 tests
- [x] Document in README and SKILL.md
- [x] kev-4b memory on a 36 GB Mac. Decision (2026-10-08): keep 4B as the default. `pnpm start` refuses to launch with less than ~20 GB free (`src/memory.ts`) and warns if Colima is running.
- [ ] Re-run the rank benchmark on a machine with 20 GB+ free (the numbers below were taken while swapping)

### Local test results (2026-10-08, kev-4b, M-series, 36 GB)

- Correction: Kev's server runs on PyTorch MPS, not MLX.
- Fresh server: first request 8 s, then about 180 ms per short request.
- Memory: the process grew to 22 GB. With Colima (8 GB) and other apps running, macOS swapped about 2 GB every 5 s, and requests took 50 to 80 s or timed out. Capping MPS at 12.6 GB fails at load (out of memory).
- Accuracy:
  - `triage` was correct in both pass and fail cases (p=0.01 and 0.05 that every test passed, with the right failure lines).
  - `pick` and `rate` gave sensible answers but at low confidence (0.51 to 0.52).
  - `rank` was correct for an obvious query at any setting. For a subtle query it was correct only at one file per request and 4000 characters (p=0.67). Batching hurts accuracy.
