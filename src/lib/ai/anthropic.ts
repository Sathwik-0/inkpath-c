import { ProviderError } from "./errors";
import { requestJson, retryAfterMs, type Classifier } from "./http";
import { generateParsed } from "./json";
import { MODELS } from "./config";
import type { AIProvider, JsonRequest, ValidationResult } from "./types";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

export const classifyAnthropic: Classifier = (status, bodyText, headers) => {
  if (status === 401) return new ProviderError("invalid_key", "Anthropic rejected the API key.");
  if (status === 400 && /credit balance/i.test(bodyText)) {
    return new ProviderError("quota_exceeded", "This Anthropic account has no remaining credit.");
  }
  if (status === 429) {
    return new ProviderError("rate_limited", "Anthropic is rate limiting requests.", retryAfterMs(bodyText, headers));
  }
  if (status >= 500) return new ProviderError("network", "Anthropic had a temporary error.");
  return new ProviderError("bad_response", `Anthropic returned an error (${status}).`);
};

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  constructor(private key: string) {}

  private headers() {
    return { "x-api-key": this.key, "anthropic-version": VERSION };
  }

  async validateKey(): Promise<ValidationResult> {
    const data = await requestJson<{ data?: { id: string }[] }>({
      url: `${BASE}/models`,
      method: "GET",
      headers: this.headers(),
      key: this.key,
      classify: classifyAnthropic,
      timeoutMs: 20_000,
    });
    return { ok: true, models: (data.data ?? []).map((m) => m.id) };
  }

  private async message(system: string, prompt: string, maxTokens: number, temperature = 0.7) {
    const data = await requestJson<any>({
      url: `${BASE}/messages`,
      headers: this.headers(),
      key: this.key,
      classify: classifyAnthropic,
      body: {
        model: MODELS.anthropic.text,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: prompt }],
      },
    });
    const text = (data?.content ?? [])
      .map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : ""))
      .join("");
    if (!text) throw new ProviderError("bad_response", "Anthropic returned no text.");
    return text;
  }

  generateText(system: string, prompt: string, opts?: { maxOutputTokens?: number }) {
    return this.message(system, prompt, opts?.maxOutputTokens ?? 2048);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    if (req.attachments?.length) {
      throw new ProviderError("unsupported", "Claude cannot read attached files in this app.");
    }
    return generateParsed(
      (correction) =>
        this.message(
          `${req.system}\nRespond with ONLY a single JSON value and no other text.`,
          correction ? `${req.prompt}\n\n${correction}` : req.prompt,
          req.maxOutputTokens ?? 8192,
          req.temperature,
        ),
      req.parse,
    );
  }
}
