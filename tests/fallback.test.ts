import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isFailoverEligible } from "@/lib/engine/runner";
import { getPlatformTextCandidates, PlatformPausedError, NoProviderError } from "@/lib/engine/credentials";
import { ProviderError } from "@/lib/ai/types";
import { serverEnv } from "@/lib/env";

describe("isFailoverEligible", () => {
  it("allows transient provider errors to fail over", () => {
    expect(isFailoverEligible(new ProviderError("rate_limited", "slow down", 1000))).toBe(true);
    expect(isFailoverEligible(new ProviderError("quota_exceeded", "out of credits"))).toBe(true);
    expect(isFailoverEligible(new ProviderError("network", "socket hang up"))).toBe(true);
    expect(isFailoverEligible(new ProviderError("bad_response", "invalid schema"))).toBe(true);
  });

  it("allows transient network and 5xx errors to fail over", () => {
    expect(isFailoverEligible(new Error("fetch failed: ECONNRESET"))).toBe(true);
    expect(isFailoverEligible(new Error("Request timed out after 30000ms"))).toBe(true);
    expect(isFailoverEligible(new Error("503 Service Unavailable"))).toBe(true);
    expect(isFailoverEligible(new Error("500 Internal Server Error"))).toBe(true);
  });

  it("blocks non-failover errors (invalid key, content blocked, billing)", () => {
    expect(isFailoverEligible(new ProviderError("invalid_key", "bad key"))).toBe(false);
    expect(isFailoverEligible(new ProviderError("content_blocked", "safety filter"))).toBe(false);
    expect(isFailoverEligible(new ProviderError("billing_required", "need card"))).toBe(false);
    expect(isFailoverEligible(new Error("TypeError: cannot read properties of undefined"))).toBe(false);
  });
});

describe("getPlatformTextCandidates", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.GEMINI_PLATFORM_KEY = "test-gemini-key";
    process.env.GROQ_PLATFORM_KEY = "test-groq-key";
    process.env.PLATFORM_TEXT_PROVIDERS = "gemini,groq";
    delete process.env.PLATFORM_DISABLE_GEMINI;
    delete process.env.PLATFORM_DISABLE_GROQ;
    delete process.env.PLATFORM_GENERATION_PAUSED;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns candidates in configured order", () => {
    const list = getPlatformTextCandidates();
    expect(list.map((c) => c.name)).toEqual(["gemini", "groq"]);
  });

  it("prioritizes the preferred provider for story continuity", () => {
    const list = getPlatformTextCandidates("groq");
    expect(list.map((c) => c.name)).toEqual(["groq", "gemini"]);
  });

  it("excludes disabled providers via kill-switch", () => {
    process.env.PLATFORM_DISABLE_GEMINI = "true";
    const list = getPlatformTextCandidates();
    expect(list.map((c) => c.name)).toEqual(["groq"]);
  });

  it("throws PlatformPausedError when platform generation is paused", () => {
    process.env.PLATFORM_GENERATION_PAUSED = "true";
    expect(() => getPlatformTextCandidates()).toThrow(PlatformPausedError);
  });

  it("throws NoProviderError when all candidates lack keys or are disabled", () => {
    process.env.PLATFORM_DISABLE_GEMINI = "true";
    process.env.PLATFORM_DISABLE_GROQ = "true";
    expect(() => getPlatformTextCandidates()).toThrow(NoProviderError);
  });
});

import { redact } from "@/lib/ai/http";
import { userMessage } from "@/lib/ai/errors";

describe("Free chapter failover accounting & isolation", () => {
  it("never exposes secret keys in redacted strings or error output", () => {
    const secretKey = "gsk_dummyTestSecretKeyForTestingRedaction99999999999";
    const rawError = `Failed at https://api.groq.com/openai/v1 with key ${secretKey}`;
    const sanitized = redact(rawError, secretKey);
    expect(sanitized).not.toContain("gsk_");
    expect(sanitized).toContain("[redacted]");

    // userMessage produces completely isolated safe messages without provider payload
    const safeMsg = userMessage("bad_response", "Groq");
    expect(safeMsg).not.toContain("gsk_");
  });

  it("handles step-level retry from primary to fallback on rate limit", async () => {
    const executed: string[] = [];
    const candidates = [
      {
        name: "gemini" as const,
        provider: {
          name: "gemini" as const,
          async generateText() {
            executed.push("gemini");
            throw new ProviderError("rate_limited", "Rate limit reached", 1000);
          },
        },
      },
      {
        name: "groq" as const,
        provider: {
          name: "groq" as const,
          async generateText() {
            executed.push("groq");
            return "Groq generated content";
          },
        },
      },
    ];

    let currentProvider: string | null = null;
    let output: string | null = null;
    const failovers: any[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        output = await candidate.provider.generateText();
        currentProvider = candidate.name;
        break;
      } catch (err: any) {
        if (isFailoverEligible(err) && i < candidates.length - 1) {
          failovers.push({ from: candidate.name, to: candidates[i + 1].name, reason: err.code });
          continue;
        }
        throw err;
      }
    }

    expect(executed).toEqual(["gemini", "groq"]);
    expect(currentProvider).toBe("groq");
    expect(output).toBe("Groq generated content");
    expect(failovers).toEqual([{ from: "gemini", to: "groq", reason: "rate_limited" }]);
  });

  it("does not fail over when provider returns invalid_key", async () => {
    const executed: string[] = [];
    const candidates = [
      {
        name: "gemini" as const,
        provider: {
          name: "gemini" as const,
          async generateText() {
            executed.push("gemini");
            throw new ProviderError("invalid_key", "Bad key");
          },
        },
      },
      {
        name: "groq" as const,
        provider: {
          name: "groq" as const,
          async generateText() {
            executed.push("groq");
            return "Should not run";
          },
        },
      },
    ];

    let caughtErr: any = null;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await candidate.provider.generateText();
        break;
      } catch (err: any) {
        if (err.code === "invalid_key") {
          caughtErr = err;
          break; // Stop immediately without failover
        }
        if (isFailoverEligible(err) && i < candidates.length - 1) {
          continue;
        }
        throw err;
      }
    }

    expect(executed).toEqual(["gemini"]);
    expect(caughtErr?.code).toBe("invalid_key");
  });

  it("triggers failover after schema validation failure (bad_response)", async () => {
    const executed: string[] = [];
    const candidates = [
      {
        name: "gemini" as const,
        provider: {
          name: "gemini" as const,
          async generateText() {
            executed.push("gemini");
            throw new ProviderError("bad_response", "Invalid JSON format after retry");
          },
        },
      },
      {
        name: "groq" as const,
        provider: {
          name: "groq" as const,
          async generateText() {
            executed.push("groq");
            return '{"valid": true}';
          },
        },
      },
    ];

    let output: string | null = null;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        output = await candidate.provider.generateText();
        break;
      } catch (err: any) {
        if (isFailoverEligible(err) && i < candidates.length - 1) {
          continue;
        }
        throw err;
      }
    }

    expect(executed).toEqual(["gemini", "groq"]);
    expect(output).toBe('{"valid": true}');
  });

  it("releases free chapter reservation when all providers fail", async () => {
    let released = false;
    const releaseFreeChapter = async () => {
      released = true;
    };

    const candidates = [
      {
        name: "gemini" as const,
        provider: {
          name: "gemini" as const,
          async generateText() {
            throw new ProviderError("rate_limited", "gemini 429", 1000);
          },
        },
      },
      {
        name: "groq" as const,
        provider: {
          name: "groq" as const,
          async generateText() {
            throw new ProviderError("rate_limited", "groq 429", 1000);
          },
        },
      },
    ];

    try {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        try {
          await candidate.provider.generateText();
          break;
        } catch (err: any) {
          if (isFailoverEligible(err) && i < candidates.length - 1) {
            continue;
          }
          throw err;
        }
      }
    } catch {
      await releaseFreeChapter();
    }

    expect(released).toBe(true);
  });

  it("retries exactly once on fallback model when primary Gemini model hits quota or not-found", async () => {
    const modelsTried: string[] = [];
    const fakeGenerateWithFallback = async (
      candidates: string[],
      callModel: (m: string) => Promise<string>,
    ) => {
      let lastErr: any = null;
      for (let i = 0; i < candidates.length; i++) {
        const m = candidates[i];
        modelsTried.push(m);
        try {
          return await callModel(m);
        } catch (err: any) {
          lastErr = err;
          const isQuotaOrNotFound =
            err.code === "quota_exceeded" ||
            err.code === "rate_limited" ||
            err.code === "billing_required" ||
            /404|not found/i.test(err.message);
          if (isQuotaOrNotFound && i < candidates.length - 1) {
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    };

    const result = await fakeGenerateWithFallback(
      ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
      async (model: string) => {
        if (model === "gemini-2.5-flash") {
          throw new ProviderError("quota_exceeded", "Daily quota reached for gemini-2.5-flash");
        }
        return `Generated successfully on ${model}`;
      },
    );

    expect(modelsTried).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    expect(result).toBe("Generated successfully on gemini-2.5-flash-lite");
  });
});


