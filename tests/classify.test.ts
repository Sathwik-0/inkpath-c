import { describe, expect, it } from "vitest";
import { classifyGemini } from "@/lib/ai/gemini";
import { classifyOpenAI } from "@/lib/ai/openai";
import { classifyAnthropic } from "@/lib/ai/anthropic";
import { redact } from "@/lib/ai/http";
import { extractJson } from "@/lib/ai/json";

const h = new Headers();
const body = (message: string) => JSON.stringify({ error: { message } });

describe("Gemini error classification", () => {
  it("treats a zero image quota on a free key as billing_required, not a retry", () => {
    const e = classifyGemini(
      429,
      body("Quota exceeded for metric generate_content_free_tier_requests, limit: 0"),
      h,
    );
    expect(e.code).toBe("billing_required");
    expect(e.transient).toBe(false);
  });

  it("treats an ordinary 429 as a transient rate limit with the retry hint", () => {
    const e = classifyGemini(429, body("Resource exhausted. Please retry in 12.5s"), h);
    expect(e.code).toBe("rate_limited");
    expect(e.transient).toBe(true);
    expect(e.retryAfterMs).toBe(12500);
  });

  it("detects daily quota exhaustion", () => {
    expect(classifyGemini(429, body("Quota exceeded: RequestsPerDay"), h).code).toBe("quota_exceeded");
  });

  it("detects a bad key", () => {
    expect(classifyGemini(400, body("API key not valid. Please pass a valid API key."), h).code).toBe("invalid_key");
  });
});

describe("other providers", () => {
  it("OpenAI insufficient_quota is quota_exceeded", () => {
    expect(classifyOpenAI(429, '{"error":{"code":"insufficient_quota"}}', h).code).toBe("quota_exceeded");
  });
  it("Anthropic low credit is quota_exceeded", () => {
    expect(classifyAnthropic(400, "Your credit balance is too low", h).code).toBe("quota_exceeded");
  });
});

describe("helpers", () => {
  it("redacts the key from error text", () => {
    expect(redact("bad key sk-secret123 here", "sk-secret123")).toBe("bad key [redacted] here");
  });
  it("extracts JSON from fenced replies", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
