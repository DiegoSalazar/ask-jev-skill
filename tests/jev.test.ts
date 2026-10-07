import { describe, expect, test } from "bun:test";
import {
  API_URL,
  ask,
  decide,
  isSensitivePath,
  noulConfidence,
  rank,
  rankRequest,
  redact,
} from "../src/jev";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more mock responses");
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const noulAnswer = (answers: Record<string, number>) => ({
  model: "jev-1.13.0",
  answers: Object.fromEntries(
    Object.entries(answers).map(([k, p]) => [k, { type: "noul", noul: p }]),
  ),
  usage: { input_tokens: 10, output_tokens: 1 },
});

const noSleep = async () => {};

describe("ask", () => {
  test("POSTs model, state and questions with bearer auth", async () => {
    const { fn, calls } = mockFetch([json(noulAnswer({ q: 0.9 }))]);
    const res = await ask("hello", { q: { type: "noul", instructions: "Is it a greeting?" } }, {
      apiKey: "test-key",
      fetch: fn,
    });

    expect(res.answers.q).toEqual({ type: "noul", noul: 0.9 });
    expect(calls[0].url).toBe(API_URL);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({
      model: "jev-latest",
      state: "hello",
      questions: { q: { type: "noul", instructions: "Is it a greeting?" } },
    });
  });

  test("redacts secrets before sending", async () => {
    const { fn, calls } = mockFetch([json(noulAnswer({ q: 0.1 }))]);
    await ask({ log: "password=hunter2 key AKIAABCDEFGHIJKLMNOP" }, { q: { type: "noul", instructions: "x" } }, {
      apiKey: "k",
      fetch: fn,
    });
    const sent = calls[0].init.body as string;
    expect(sent).not.toContain("hunter2");
    expect(sent).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  test("throws without an API key", async () => {
    const prev = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      await expect(ask("x", {})).rejects.toThrow("TYPESAFE_API_KEY");
    } finally {
      if (prev !== undefined) process.env.TYPESAFE_API_KEY = prev;
    }
  });

  test("retries on 429 and 529", async () => {
    const { fn, calls } = mockFetch([
      json({}, 429),
      json({}, 529),
      json(noulAnswer({ q: 0.5 })),
    ]);
    const res = await ask("x", {}, { apiKey: "k", fetch: fn, sleep: noSleep });
    expect(calls.length).toBe(3);
    expect(res.answers.q).toBeDefined();
  });

  test("does not retry other errors", async () => {
    const { fn, calls } = mockFetch([json({ error: "bad key" }, 401)]);
    await expect(ask("x", {}, { apiKey: "k", fetch: fn, sleep: noSleep })).rejects.toThrow("401");
    expect(calls.length).toBe(1);
  });
});

describe("redact", () => {
  test.each([
    ["password=hunter2", "hunter2"],
    ["API_KEY: abc123def", "abc123def"],
    ['"token": "tok_live_999"', "tok_live_999"],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz"],
    ["AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123", "ghp_abcdefghijklmnopqrstuvwxyz0123"],
    ["xoxb-1234567890-abcdef", "xoxb-1234567890-abcdef"],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----", "MIIE"],
  ])("removes secret in %p", (input, secret) => {
    expect(redact(input)).not.toContain(secret);
  });

  test("keeps the key name so context survives", () => {
    expect(redact("password=hunter2")).toBe("password=[REDACTED]");
  });

  test("walks nested objects and arrays", () => {
    expect(redact({ a: ["secret: s3cr3t"], b: { c: 1 } })).toEqual({
      a: ["secret: [REDACTED]"],
      b: { c: 1 },
    });
  });

  test("leaves ordinary text alone", () => {
    expect(redact("3 tests failed in src/token-parser.ts")).toBe("3 tests failed in src/token-parser.ts");
  });
});

describe("decide", () => {
  test.each([
    [0.3, "read", "escalate"],
    [0.55, "read", "confirm"],
    [0.6, "read", "act"],
    [0.75, "write", "confirm"],
    [0.8, "write", "act"],
    [0.85, "destructive", "confirm"],
    [0.9, "destructive", "act"],
  ] as const)("confidence %p at risk %p -> %p", (confidence, risk, action) => {
    expect(decide(confidence, risk)).toBe(action);
  });
});

test("noulConfidence measures distance from a coin flip", () => {
  expect(noulConfidence(0.5)).toBe(0);
  expect(noulConfidence(1)).toBe(1);
  expect(noulConfidence(0)).toBe(1);
  expect(noulConfidence(0.95)).toBeCloseTo(0.9);
});

describe("isSensitivePath", () => {
  test.each([".env", "app/.env.local", "~/.ssh/id_rsa", "server.pem", "~/.aws/credentials", "config/secrets.yaml", "~/.npmrc"])(
    "%p is sensitive",
    (p) => expect(isSensitivePath(p)).toBe(true),
  );

  test.each(["src/index.ts", "README.md", ".envrc.example.md", "src/environment.ts"])("%p is not sensitive", (p) =>
    expect(isSensitivePath(p)).toBe(false),
  );
});

describe("rank", () => {
  test("keys candidates instead of using array positions", () => {
    const { state, questions } = rankRequest("auth bug", [
      { label: "a.ts", text: "login code" },
      { label: "b.ts", text: "css" },
    ]);
    expect(state).toEqual({ query: "auth bug", candidates: { k0: "login code", k1: "css" } });
    expect(Object.keys(questions)).toEqual(["k0", "k1"]);
    expect(questions.k1.instructions).toContain("`candidates.k1`");
    expect(questions.k1.instructions).not.toContain("[1]");
  });

  test("batches requests and sorts by relevance", async () => {
    const { fn, calls } = mockFetch([json(noulAnswer({ k0: 0.2, k1: 0.9 })), json(noulAnswer({ k0: 0.6 }))]);
    const ranked = await rank(
      "q",
      [
        { label: "a", text: "a" },
        { label: "b", text: "b" },
        { label: "c", text: "c" },
      ],
      { apiKey: "k", fetch: fn, batchSize: 2 },
    );
    expect(calls.length).toBe(2);
    expect(ranked).toEqual([
      { label: "b", p: 0.9 },
      { label: "c", p: 0.6 },
      { label: "a", p: 0.2 },
    ]);
  });
});
