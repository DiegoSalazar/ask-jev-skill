export const DEFAULT_API_URL = "https://api.typesafe.ai/v1/systemone";

export type Backend = { url: string; model: string; local: boolean };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// JEV_API_URL pointing at localhost means a local Kev server (scripts/start-local.sh).
export function backend(env: Record<string, string | undefined> = process.env): Backend {
  const url = env.JEV_API_URL || DEFAULT_API_URL;
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  return { url, local, model: env.JEV_MODEL || (local ? "kev-latest" : "jev-latest") };
}

// Local Kev (measured on kev-4b, Apple Silicon): only ranks correctly with one candidate per request
// and enough content to judge; serves one request at a time, so queueing more just times out.
export const LIMITS = {
  remote: { chars: 1500, batchSize: 40, tail: 60_000, concurrency: Infinity },
  local: { chars: 4000, batchSize: 1, tail: 1_500, concurrency: 1 },
};

export const limits = (b: Backend) => (b.local ? LIMITS.local : LIMITS.remote);

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export type JevResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
};

export type AskOptions = {
  apiKey?: string;
  backend?: Backend;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export async function ask(
  state: unknown,
  questions: Record<string, Question>,
  opts: AskOptions = {},
): Promise<JevResponse> {
  const b = opts.backend ?? backend();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!b.local) {
    const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set (or set JEV_API_URL to a local server)");
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const body = JSON.stringify({ model: b.model, state: redact(state), questions });

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(b.url, {
      method: "POST",
      headers,
      body,
      // A local model's first request includes warm-up.
      signal: AbortSignal.timeout(opts.timeoutMs ?? (b.local ? 120_000 : 10_000)),
    });
    if (res.ok) return (await res.json()) as JevResponse;
    if ((res.status === 429 || res.status === 529) && attempt < retries) {
      await sleep(250 * 2 ** attempt);
      continue;
    }
    throw new Error(`Jev request failed: ${res.status} ${await res.text()}`);
  }
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED]"],
  [/\b((?:api[_-]?key|secret|token|password|passwd|pwd)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1[REDACTED]"],
];

export function redact<T>(value: T): T {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), value as string) as T;
  }
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)])) as T;
  }
  return value;
}

const SENSITIVE_PATH =
  /(^|[\/\s'"=~])(\.env(\.[\w-]+)?|\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|id_[a-z0-9]+|[\w.-]*\.(pem|key|p12|pfx|keystore)|[\w.-]*(credential|secret)s?[\w.-]*)(?=$|[\/\s'"])/i;

export function isSensitivePath(text: string): boolean {
  return SENSITIVE_PATH.test(text);
}

export type Risk = "read" | "write" | "destructive";
export type Action = "act" | "confirm" | "escalate";
export const THRESHOLDS: Record<Risk, number> = { read: 0.6, write: 0.8, destructive: 0.9 };

// Kev's calibration error is roughly 2-3x Jev's (Opper benchmark), so local answers need more confidence to act.
const LOCAL_PENALTY = 0.1;

export function decide(confidence: number, risk: Risk, local = false): Action {
  if (confidence < 0.5) return "escalate";
  const bar = local ? Math.min(1, Math.round((THRESHOLDS[risk] + LOCAL_PENALTY) * 100) / 100) : THRESHOLDS[risk];
  return confidence >= bar ? "act" : "confirm";
}

export function noulConfidence(p: number): number {
  return Math.abs(p - 0.5) * 2;
}

export type Candidate = { label: string; text: string };

// Keyed references (`candidates.k3`), not array positions: positional indexing misfires 9-27% of the time.
export function rankRequest(query: string, candidates: Candidate[]) {
  const keys = candidates.map((_, i) => `k${i}`);
  const state = { query, candidates: Object.fromEntries(candidates.map((c, i) => [keys[i], c.text])) };
  const questions: Record<string, Question> = Object.fromEntries(
    keys.map((k) => [
      k,
      {
        type: "noul",
        instructions: `Is \`candidates.${k}\` relevant to \`query\`?`,
        criteria: {
          true: "Directly relevant: needed to answer or act on the query",
          false: "Unrelated or only tangentially related to the query",
        },
      },
    ]),
  );
  return { state, questions };
}

export async function rank(
  query: string,
  candidates: Candidate[],
  opts: AskOptions & { batchSize?: number } = {},
): Promise<{ label: string; p: number }[]> {
  const limit = limits(opts.backend ?? backend());
  const size = opts.batchSize ?? limit.batchSize;
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += size) batches.push(candidates.slice(i, i + size));

  const results: { label: string; p: number }[][] = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const idx = next++;
      const batch = batches[idx];
      const { state, questions } = rankRequest(query, batch);
      const res = await ask(state, questions, opts);
      results[idx] = batch.map((c, i) => {
        const a = res.answers[`k${i}`];
        return { label: c.label, p: a?.type === "noul" ? a.noul : 0 };
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit.concurrency, batches.length) }, worker));
  return results.flat().sort((a, b) => b.p - a.p);
}
