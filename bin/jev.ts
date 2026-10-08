#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  ask,
  backend,
  decide,
  isSensitivePath,
  limits,
  noulConfidence,
  rank,
  type Candidate,
  type Risk,
} from "../src/jev";
import { matchingLines, tail } from "../src/triage";

const USAGE = `jev: typed decisions from TypeSafe Jev (state is read from --state or stdin)

  jev yes  "<question>" [--true <desc>] [--false <desc>]       P(true) for a statement
  jev pick "<question>" --opt key=desc [--opt key=desc ...]    choose one option
  jev rate "<question>" --level <desc> [--level <desc> ...]    score on an ordered rubric
  jev rank "<query>" [--top N] [--chars N] [file ...]          rank files (or stdin lines) by relevance
  jev triage "<question>" [--grep <regex>] -- <cmd> [args...]  run cmd, judge its output, return only the verdict

  common: --state <text>  --risk read|write|destructive (adds "action": act|confirm|escalate)
  env:    TYPESAFE_API_KEY  JEV_API_URL (localhost = local Kev, no key)  JEV_MODEL`;

const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
const [args, rest] = dashdash === -1 ? [argv, []] : [argv.slice(0, dashdash), argv.slice(dashdash + 1)];

const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    state: { type: "string" },
    risk: { type: "string", default: "read" },
    true: { type: "string" },
    false: { type: "string" },
    opt: { type: "string", multiple: true },
    level: { type: "string", multiple: true },
    top: { type: "string", default: "10" },
    chars: { type: "string" },
    grep: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [command, question, ...files] = positionals;
const risk = values.risk as Risk;
const be = backend();
const limit = limits(be);

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function readState(): Promise<string> {
  if (values.state !== undefined) return values.state;
  if (process.stdin.isTTY) fail("no state: pass --state or pipe it on stdin");
  return await Bun.stdin.text();
}

function out(result: Record<string, unknown>, confidence?: number) {
  if (confidence !== undefined) result.action = decide(confidence, risk, be.local);
  console.log(JSON.stringify(result));
}

const noulCriteria = () =>
  values.true || values.false ? { true: values.true ?? "Yes", false: values.false ?? "No" } : undefined;

async function main() {
  if (values.help || !command) fail(USAGE);
  if (!question) fail(`missing question\n\n${USAGE}`);

  switch (command) {
    case "yes": {
      const res = await ask(await readState(), { q: { type: "noul", instructions: question, criteria: noulCriteria() } });
      const a = res.answers.q;
      if (a.type !== "noul") fail("unexpected answer type");
      const confidence = noulConfidence(a.noul);
      return out({ p: a.noul, answer: a.noul >= 0.5, confidence }, confidence);
    }
    case "pick": {
      if (!values.opt?.length) fail("pick needs at least two --opt key=desc");
      const criteria = Object.fromEntries(
        values.opt.map((o) => {
          const i = o.indexOf("=");
          return i === -1 ? [o, o] : [o.slice(0, i), o.slice(i + 1)];
        }),
      );
      const res = await ask(await readState(), { q: { type: "choice", instructions: question, criteria } });
      const a = res.answers.q;
      if (a.type !== "choice") fail("unexpected answer type");
      return out({ choice: a.choice, confidence: a.confidence, probabilities: a.probabilities }, a.confidence);
    }
    case "rate": {
      if ((values.level?.length ?? 0) < 2) fail("rate needs at least two --level");
      const res = await ask(await readState(), { q: { type: "score", instructions: question, criteria: values.level! } });
      const a = res.answers.q;
      if (a.type !== "score") fail("unexpected answer type");
      const level = values.level![Math.round(a.score)];
      return out({ score: a.score, level, confidence: a.confidence }, a.confidence);
    }
    case "rank": {
      const chars = Number(values.chars ?? limit.chars);
      const skipped: string[] = [];
      let candidates: Candidate[];
      if (files.length) {
        candidates = [];
        for (const f of files) {
          if (isSensitivePath(f)) {
            skipped.push(f);
            continue;
          }
          candidates.push({ label: f, text: `path: ${f}\n${readFileSync(f, "utf8").slice(0, chars)}` });
        }
      } else {
        const lines = (await readState()).split("\n").filter((l) => l.trim());
        candidates = lines.map((l) => ({ label: l, text: l.slice(0, chars) }));
      }
      const ranked = await rank(question, candidates);
      return out({ ranked: ranked.slice(0, Number(values.top)), total: ranked.length, skipped });
    }
    case "triage": {
      if (!rest.length) fail("triage needs a command after --");
      const proc = Bun.spawnSync(rest, { stdout: "pipe", stderr: "pipe" });
      const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;
      const res = await ask(
        { command: rest.join(" "), exit_code: proc.exitCode, output: tail(output, limit.tail) },
        { q: { type: "noul", instructions: question, criteria: noulCriteria() } },
      );
      const a = res.answers.q;
      if (a.type !== "noul") fail("unexpected answer type");
      const confidence = noulConfidence(a.noul);
      return out(
        {
          p: a.noul,
          answer: a.noul >= 0.5,
          confidence,
          exit_code: proc.exitCode,
          total_lines: output.split("\n").length,
          lines: matchingLines(output, values.grep),
        },
        confidence,
      );
    }
    default:
      fail(`unknown command: ${command}\n\n${USAGE}`);
  }
}

main().catch((e) => fail(`jev: ${e instanceof Error ? e.message : e}`));
