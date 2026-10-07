import { expect, test } from "bun:test";

const run = (args: string[], env: Record<string, string> = {}) =>
  Bun.spawnSync(["bun", "bin/jev.ts", ...args], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, TYPESAFE_API_KEY: "", ...env },
    stdin: "ignore",
  });

test("prints usage and exits 1 with no command", () => {
  const p = run([]);
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString()).toContain("jev yes");
});

test("rejects unknown commands", () => {
  const p = run(["nope", "q", "--state", "x"]);
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString()).toContain("unknown command");
});

test("pick requires options before calling the API", () => {
  const p = run(["pick", "which?", "--state", "x"]);
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString()).toContain("--opt");
});

test("reports a missing API key", () => {
  const p = run(["yes", "is it?", "--state", "x"]);
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString()).toContain("TYPESAFE_API_KEY");
});
