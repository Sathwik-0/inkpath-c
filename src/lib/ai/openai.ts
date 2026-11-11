import { ProviderError } from "./errors";
import { requestJson, retryAfterMs, type Classifier } from "./http";
import { generateParsed } from "./json";
import { MODELS } from "./config";
import type { AIProvider, JsonRequest, ValidationResult } from "./types";

const BASE = "https://api.openai.com/v1";

export const classifyOpenAI: Classifier = (status, bodyText, headers) => {
  if (status === 401) return new ProviderError("invalid_key", "OpenAI rejected the API key.");
  if (status === 429) {
    if (/insufficient_quota/i.test(bodyText)) {
      return new ProviderError("quota_exceeded", "This OpenAI account has no remaining credit.");
    }
    return new ProviderError("rate_limited", "OpenAI is rate limiting requests.", retryAfterMs(bodyText, headers));
  }
  if (status >= 500) return new ProviderError("network", "OpenAI had a temporary error.");
  return new ProviderError("bad_response", `OpenAI returned an error (${status}).`);
};

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
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
      classify: classifyOpenAI,
      timeoutMs: 20_000,
    });
    return { ok: true, models: (data.data ?? []).map((m) => m.id) };
  }

  private async chat(system: string, prompt: string, json: boolean, maxTokens: number, temperature = 0.7) {
    const data = await requestJson<any>({
      url: `${BASE}/chat/completions`,
      headers: this.headers(),
      key: this.key,
      classify: classifyOpenAI,
      body: {
        model: MODELS.openai.text,
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
      throw new ProviderError("bad_response", "OpenAI returned no text.");
    }
    return text;
  }

  generateText(system: string, prompt: string, opts?: { maxOutputTokens?: number }) {
    return this.chat(system, prompt, false, opts?.maxOutputTokens ?? 2048);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    if (req.attachments?.length) {
      throw new ProviderError("unsupported", "OpenAI cannot read attached files in this app.");
    }
    return generateParsed(
      (correction) =>
        this.chat(
          // JSON mode requires the word "JSON" in the messages.
          `${req.system}\nRespond with a single JSON object.`,
          correction ? `${req.prompt}\n\n${correction}` : req.prompt,
          true,
          req.maxOutputTokens ?? 8192,
          req.temperature,
        ),
      req.parse,
    );
  }
}
