export const API_URL = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-latest";

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
  const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const body = JSON.stringify({ model: MODEL, state: redact(state), questions });

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
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

export function decide(confidence: number, risk: Risk): Action {
  if (confidence < 0.5) return "escalate";
  return confidence >= THRESHOLDS[risk] ? "act" : "confirm";
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
  const size = opts.batchSize ?? 40;
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += size) batches.push(candidates.slice(i, i + size));

  const results = await Promise.all(
    batches.map(async (batch) => {
      const { state, questions } = rankRequest(query, batch);
      const res = await ask(state, questions, opts);
      return batch.map((c, i) => {
        const a = res.answers[`k${i}`];
        return { label: c.label, p: a?.type === "noul" ? a.noul : 0 };
      });
    }),
  );
  return results.flat().sort((a, b) => b.p - a.p);
}
