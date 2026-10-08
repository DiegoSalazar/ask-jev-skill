// Kev on PyTorch MPS grows well past its weight size; below these it swaps and requests take minutes.
const REQUIRED_GB: [RegExp, number][] = [
  [/kev-0\.8b/i, 6],
  [/kev-4b/i, 20],
  [/kev-9b/i, 32],
  [/kev-27b/i, 64],
];

export function requiredGb(model: string): number {
  return REQUIRED_GB.find(([re]) => re.test(model))?.[1] ?? 0;
}

export function availableGb(vmStat: string): number {
  const pageSize = Number(vmStat.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
  const pages = (label: string) => Number(vmStat.match(new RegExp(`Pages ${label}:\\s+(\\d+)`))?.[1] ?? 0);
  return ((pages("free") + pages("inactive") + pages("speculative")) * pageSize) / 1024 ** 3;
}

export function checkMemory(model: string, vmStat: string) {
  const needGb = requiredGb(model);
  const freeGb = Math.round(availableGb(vmStat) * 10) / 10;
  return { ok: freeGb >= needGb, freeGb, needGb };
}

if (import.meta.main) {
  const model = process.argv[2] ?? "";
  const vmStat = Bun.spawnSync(["vm_stat"]).stdout.toString();
  const r = checkMemory(model, vmStat);
  if (!r.ok) {
    console.error(
      `ask-jev: ${model} needs ~${r.needGb} GB free, only ${r.freeGb} GB available.\n` +
        "  Free memory first (e.g. colima stop, quit Docker/IDEs), or run anyway with KEV_SKIP_MEM_CHECK=1.",
    );
    process.exit(1);
  }
}
