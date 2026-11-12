import { describe, expect, it } from "vitest";
import { classifyGemini, parseGeminiQuotaDetails } from "@/lib/ai/gemini";
import { classifyOpenAI } from "@/lib/ai/openai";
import { classifyAnthropic } from "@/lib/ai/anthropic";
import { classifyGroq } from "@/lib/ai/groq";
import { redact } from "@/lib/ai/http";
import { extractJson } from "@/lib/ai/json";
import { userMessage, ProviderError } from "@/lib/ai/errors";
import { publicError } from "@/lib/api";

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

  it("treats a 429 with free_tier metric and limit 20 as rate_limited or quota_exceeded, never billing_required", () => {
    const jsonBody = JSON.stringify({
      error: {
        code: 429,
        message: "Resource exhausted",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            metadata: {
              quota_metric: "generate_content_free_tier_requests",
              quota_id: "RequestsPerMinutePerProject",
              quota_limit: "20",
            },
          },
        ],
      },
    });
    const e = classifyGemini(429, jsonBody, h);
    expect(e.code).toBe("rate_limited");
    expect(e.code).not.toBe("billing_required");
  });

  it("classifies limit: 0 as billing_required", () => {
    const jsonBody = JSON.stringify({
      error: {
        code: 429,
        message: "Quota exceeded for model gemini-3.1-flash-image: limit: 0",
      },
    });
    const e = classifyGemini(429, jsonBody, h);
    expect(e.code).toBe("billing_required");
  });

  it("treats an ordinary 429 as a transient rate limit with the retry hint", () => {
    const e = classifyGemini(429, body("Resource exhausted. Please retry in 12.5s"), h);
    expect(e.code).toBe("rate_limited");
    expect(e.transient).toBe(true);
    expect(e.retryAfterMs).toBe(12500);
  });

  it("detects daily quota exhaustion and produces daily reset message", () => {
    const e = classifyGemini(429, body("Quota exceeded: RequestsPerDay"), h);
    expect(e.code).toBe("quota_exceeded");
    expect(e.message).toContain("resets daily");
    expect(e.message).toContain("12:30 pm IST");
  });

  it("extracts structured quota details from Google RPC JSON", () => {
    const jsonBody = JSON.stringify({
      error: {
        code: 429,
        message: "Quota exceeded",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ description: "Quota exceeded for metric 'generate_content_free_tier_requests' and limit 'RequestsPerDayPerProject'" }],
          },
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            metadata: { quota_metric: "generate_content_free_tier_requests", quota_id: "RequestsPerDayPerProject", quota_limit: "50" },
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "60s",
          },
        ],
      },
    });
    const parsed = parseGeminiQuotaDetails(jsonBody);
    expect(parsed.metric).toBe("generate_content_free_tier_requests");
    expect(parsed.quotaId).toBe("RequestsPerDayPerProject");
    expect(parsed.limit).toBe(50);
    expect(parsed.retryAfterMs).toBe(60000);
  });

  it("detects a bad key", () => {
    expect(classifyGemini(400, body("API key not valid. Please pass a valid API key."), h).code).toBe("invalid_key");
  });
});

describe("Task-aware user messages", () => {
  it("text-step billing_required error never mentions image generation", () => {
    const textMsg = userMessage("billing_required", "Google Gemini", "text");
    expect(textMsg).not.toContain("image");
    expect(textMsg).toContain("text");

    const err = new ProviderError("billing_required", "");
    const pub = publicError(err, "text");
    expect(pub.message).not.toContain("image");
  });

  it("image-step billing_required mentions image models and billing", () => {
    const imgMsg = userMessage("billing_required", "Google Gemini", "image");
    expect(imgMsg).toContain("image");
  });

  it("daily quota message gives the explicit reset guidance", () => {
    const msg = userMessage("quota_exceeded", "Gemini", "text");
    expect(msg).toContain("resets daily (around 12:30 pm IST)");
  });
});

describe("other providers", () => {
  it("OpenAI insufficient_quota is quota_exceeded", () => {
    expect(classifyOpenAI(429, '{"error":{"code":"insufficient_quota"}}', h).code).toBe("quota_exceeded");
  });
  it("Anthropic low credit is quota_exceeded", () => {
    expect(classifyAnthropic(400, "Your credit balance is too low", h).code).toBe("quota_exceeded");
  });
  it("Groq handles invalid key and rate limit", () => {
    expect(classifyGroq(401, '{"error":{"message":"Invalid API Key"}}', h).code).toBe("invalid_key");
    expect(classifyGroq(429, '{"error":{"message":"Rate limit reached"}}', h).code).toBe("rate_limited");
    expect(classifyGroq(429, '{"error":{"code":"insufficient_quota"}}', h).code).toBe("quota_exceeded");
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
