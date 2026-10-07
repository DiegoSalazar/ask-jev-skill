---
name: ask-jev
description: Offload token-expensive judgments to TypeSafe Jev (a decision-only model, ~250 ms, fractions of a cent) via the `jev` CLI instead of reading content into context. Use BEFORE reading many files to decide which matter, BEFORE scanning long command/test/log output to decide pass/fail or what broke, when choosing which skill or agent to invoke from a long list, when classifying/filtering/ranking many items, and to get a calibrated second opinion on a yes/no call. Not for writing, summarizing, code, math, or multi-step reasoning.
---

# ask-jev

Jev answers typed questions about a `state` and returns a probability, never text. You (Claude) keep the reasoning and writing; Jev makes the cheap, repetitive judgment so the raw content never enters your context.

Requires `jev` on PATH and `TYPESAFE_API_KEY` set. If either is missing, say so once and fall back to doing the work normally. Never read, print, or ask for the key.

## When to reach for it

| Situation | Instead of | Do |
|---|---|---|
| Which of 30+ files are relevant to a task | Reading them all | `jev rank "<task>" $(rg -l <term> src)` then read the top few |
| Did this test/build/lint run pass, what broke | Dumping full output | `jev triage "Did all tests pass?" -- bun test` |
| Which skill/agent/command fits a request | Loading several to compare | `printf '%s\n' "name: desc" ... \| jev rank "<request>" --top 3` |
| Classify or filter many items (log lines, tickets, diffs) | Reading each | `jev rank` or one `jev yes` per item in a loop |
| A yes/no call you are unsure about | Guessing | `jev yes "<literal statement>" --state "<facts>"` |
| Route to one of N known paths | Reasoning in prose | `jev pick "<question>" --opt a=desc --opt b=desc` |

Skip it when the item is small enough to judge at a glance, or when the answer needs counting, dates, arithmetic, generation, or chained reasoning. Jev is wrong sometimes; it just can't answer outside your schema.

## Commands

All output is one line of JSON. `--risk read|write|destructive` adds `"action"`.

```bash
jev yes  "Does the diff change public API signatures?" < diff.txt
# {"p":0.91,"answer":true,"confidence":0.82,"action":"act"}

jev pick "What kind of failure is this?" --opt flaky="timing/network, passes on retry" \
  --opt regression="logic broke from a recent change" --opt env="missing dep, config, or credentials" < log.txt
# {"choice":"regression","confidence":0.77,"probabilities":{...},"action":"act"}

jev rate "How risky is this migration?" --level "trivial" --level "needs review" --level "dangerous" < plan.md
# {"score":1.2,"level":"needs review","confidence":0.7,"action":"act"}

jev rank "where is JWT expiry validated" --top 5 $(git ls-files 'src/**/*.ts')
# {"ranked":[{"label":"src/auth/verify.ts","p":0.97},...],"total":84,"skipped":[]}

jev triage "Did every test pass?" --grep "FAIL|Error" -- bun test
# {"p":0.03,"answer":false,"confidence":0.94,"exit_code":1,"total_lines":412,"lines":["FAIL src/a.test.ts",...]}
```

`rank` reads the first `--chars` (default 1500) of each file, skips sensitive paths, and batches 40 per request. With no files it ranks stdin lines. `triage` runs the command itself (no shell: wrap pipelines in `sh -c` only if needed), sends only the tail of the output, and returns just the verdict plus matching lines.

## Acting on the answer

| `action` | Meaning | You do |
|---|---|---|
| `act` | confidence meets the bar for the risk level | Proceed without second-guessing or re-reading the source |
| `confirm` | between 0.5 and the bar | Spot-check: read the top 1-2 items or the matching `lines`, then decide |
| `escalate` | confidence < 0.5 | Jev doesn't know. Do the work yourself, or ask the user |

Bars: `read` 0.6, `write` 0.8, `destructive` 0.9. Pick `--risk` by what you will do with the answer, not by the question. A Jev answer is evidence, never permission: it does not replace the user's approval for writes, deletes, pushes, deploys, or messages.

## Writing questions that work

- **One atomic judgment per question.** "Did tests pass?" and "Is the failure in auth?" are two calls, not one with "and".
- **Literal, contrastive criteria.** `--true "Exit 0 and no FAIL lines" --false "Any failing test or crash"` beats bare yes/no.
- **Name fields with backticks** when state is JSON: "Is `diff` limited to test files?"
- **Never refer to items by array position.** Use keys (rank does this for you) or put the item in the question.
- **No negations.** Ask "Is it safe?" not "Is it not unsafe?"
- **State must be self-contained.** Jev sees only what you send. Include the facts it needs; it has no repo access. Keep it under ~30k tokens.

## Data rules

Everything sent goes to api.typesafe.ai. The CLI redacts common secret patterns, but you are the first filter:

- Never send `.env*`, keys, credentials, tokens, customer PII, or financial/royalty data.
- Prefer sending paths, error lines, and diffs of code over raw data dumps.
- If the user's org forbids external transmission of the content, don't use Jev for it.

## Reporting

When a Jev call drives a decision, mention it in one short clause with the number, e.g. "Jev ranked `verify.ts` top (p=0.97), reading that." Don't paste the raw JSON unless asked.
