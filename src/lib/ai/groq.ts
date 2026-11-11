import { ProviderError } from "./errors";
import { requestJson, retryAfterMs, type Classifier } from "./http";
import { generateParsed } from "./json";
import { MODELS } from "./config";
import type { AIProvider, JsonRequest, ValidationResult } from "./types";

const BASE = "https://api.groq.com/openai/v1";

export const classifyGroq: Classifier = (status, bodyText, headers) => {
  if (status === 401) return new ProviderError("invalid_key", "Groq rejected the API key.");
  if (status === 429) {
    if (/insufficient_quota|quota_exceeded/i.test(bodyText)) {
      return new ProviderError("quota_exceeded", "This Groq account has no remaining credit or quota.");
    }
    return new ProviderError("rate_limited", "Groq is rate limiting requests.", retryAfterMs(bodyText, headers));
  }
  if (status >= 500) return new ProviderError("network", "Groq had a temporary error.");
  return new ProviderError("bad_response", `Groq returned an error (${status}).`);
};

export class GroqProvider implements AIProvider {
  readonly name = "groq" as const;
  constructor(private key: string) {}

  private headers() {
    return { authorization: `Bearer ${this.key}` };
  }

  async validateKey(): Promise<ValidationResult> {
    const data = await requestJson<{ data?: { id: string }[] }>({
      url: `${BASE}/models`,
      method: "GET",
      headers: this.headers(),
      key: this.key,
      classify: classifyGroq,
      timeoutMs: 20_000,
    });
    const models = (data.data ?? []).map((m) => m.id);
    const configuredModel = MODELS.groq.text;
    if (!models.includes(configuredModel)) {
      console.warn(
        `[Groq Warning] Configured model "${configuredModel}" was not found in available models: ${models.join(", ")}`,
      );
    }
    return { ok: true, models };
  }

  /**
   * Startup or admin check that verifies if the configured GROQ_TEXT_MODEL is active on Groq.
   */
  async verifyConfiguredModel(): Promise<{ available: boolean; configured: string; availableModels: string[] }> {
    try {
      const res = await this.validateKey();
      const configured = MODELS.groq.text;
      const available = res.models.includes(configured);
      return { available, configured, availableModels: res.models };
    } catch (err: any) {
      console.warn(`[Groq Warning] Failed to verify model availability:`, err?.message || err);
      return { available: false, configured: MODELS.groq.text, availableModels: [] };
    }
  }

  private async chat(system: string, prompt: string, json: boolean, maxTokens: number, temperature = 0.7) {
    const data = await requestJson<any>({
      url: `${BASE}/chat/completions`,
      headers: this.headers(),
      key: this.key,
      classify: classifyGroq,
      body: {
        model: MODELS.groq.text,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      },
    });
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text) {
      throw new ProviderError("bad_response", "Groq returned no text.");
    }
    return text;
  }

  generateText(system: string, prompt: string, opts?: { maxOutputTokens?: number }) {
    return this.chat(system, prompt, false, opts?.maxOutputTokens ?? 2048);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    if (req.attachments?.length) {
      throw new ProviderError("unsupported", "Groq cannot read attached files directly in this app.");
    }
    return generateParsed(
      (correction) =>
        this.chat(
          `${req.system}\nRespond with valid JSON matching the required shape.`,
          correction ? `${req.prompt}\n\n${correction}` : req.prompt,
          true,
          req.maxOutputTokens ?? 8192,
          req.temperature,
        ),
      req.parse,
    );
  }
}

