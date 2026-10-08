import { expect, test } from "bun:test";
import { availableGb, checkMemory, requiredGb } from "../src/memory";

const vmStat = (free: number, inactive: number, speculative: number) =>
  [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    `Pages free:                               ${free}.`,
    "Pages active:                             900000.",
    `Pages inactive:                           ${inactive}.`,
    `Pages speculative:                        ${speculative}.`,
    "Pages wired down:                         300000.",
  ].join("\n");

const GB = 1024 ** 3 / 16384; // pages per GB at 16 KB pages

test("availableGb sums free, inactive and speculative pages", () => {
  expect(availableGb(vmStat(GB * 10, GB * 5, GB * 1))).toBeCloseTo(16);
});

test("availableGb honors the reported page size", () => {
  const text = vmStat(0, 0, 0).replace("16384", "4096").replace("Pages free:                               0.", `Pages free: ${1024 ** 3 / 4096}.`);
  expect(availableGb(text)).toBeCloseTo(1);
});

test.each([
  ["jaredpalmer/kev-0.8b", 6],
  ["jaredpalmer/kev-4b", 20],
  ["jaredpalmer/kev-9b", 32],
  ["jaredpalmer/kev-27b", 64],
  ["./runs/custom", 0],
])("requiredGb(%p) = %p", (model, gb) => {
  expect(requiredGb(model)).toBe(gb);
});

test("checkMemory passes when enough is free", () => {
  expect(checkMemory("jaredpalmer/kev-4b", vmStat(GB * 25, 0, 0))).toEqual({ ok: true, freeGb: 25, needGb: 20 });
});

test("checkMemory fails with a fix hint when too little is free", () => {
  const r = checkMemory("jaredpalmer/kev-4b", vmStat(GB * 12, 0, 0));
  expect(r.ok).toBe(false);
  expect(r.freeGb).toBe(12);
  expect(r.needGb).toBe(20);
});

test("unknown models are not blocked", () => {
  expect(checkMemory("./runs/custom", vmStat(0, 0, 0)).ok).toBe(true);
});
