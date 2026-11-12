import { ProviderError } from "./errors";
import { requestJson, retryAfterMs, type Classifier } from "./http";
import { generateParsed } from "./json";
import { MODELS } from "./config";
import type { AIProvider, ImageRequest, ImageResult, JsonRequest, ValidationResult } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function messageOf(bodyText: string): string {
  try {
    return JSON.parse(bodyText)?.error?.message ?? bodyText;
  } catch {
    return bodyText;
  }
}

interface GeminiQuotaDetails {
  metric?: string;
  quotaId?: string;
  limit?: number;
  retryDelay?: string;
  retryAfterMs?: number;
  message?: string;
}

export function parseGeminiQuotaDetails(bodyText: string, headers?: Headers): GeminiQuotaDetails {
  const details: GeminiQuotaDetails = {};

  if (headers) {
    const ra = headers.get("retry-after");
    if (ra && !Number.isNaN(Number(ra))) {
      details.retryAfterMs = Math.ceil(Number(ra) * 1000);
      details.retryDelay = `${ra}s`;
    }
  }

  try {
    const json = JSON.parse(bodyText);
    const err = json?.error;
    if (err) {
      details.message = err.message;
      if (Array.isArray(err.details)) {
        for (const d of err.details) {
          if (d["@type"]?.includes("QuotaFailure") && Array.isArray(d.violations)) {
            for (const v of d.violations) {
              const desc = v.description || "";
              const metricMatch = desc.match(/metric\s+['"]?([^'",\s]+)['"]?/i);
              if (metricMatch) details.metric = metricMatch[1];
              const limitMatch = desc.match(/limit\s+['"]?([A-Za-z0-9_]+)['"]?/i);
              if (limitMatch) details.quotaId = limitMatch[1];
            }
          }
          if (d["@type"]?.includes("ErrorInfo") && d.metadata) {
            if (d.metadata.quota_metric) details.metric = d.metadata.quota_metric;
            if (d.metadata.quota_id) details.quotaId = d.metadata.quota_id;
            if (d.metadata.quota_limit !== undefined) {
              const num = Number(d.metadata.quota_limit);
              if (!Number.isNaN(num)) details.limit = num;
            }
          }
          if (d["@type"]?.includes("RetryInfo") && d.retryDelay) {
            details.retryDelay = d.retryDelay;
            const sec = parseFloat(d.retryDelay);
            if (!Number.isNaN(sec)) details.retryAfterMs = Math.ceil(sec * 1000);
          }
        }
      }
    }
  } catch {
    // not JSON
  }

  // Fallback regex over raw bodyText if details not parsed
  if (details.limit === undefined) {
    const lm = bodyText.match(/limit:?\s*(\d+)\b/i);
    if (lm) details.limit = Number(lm[1]);
  }
  if (!details.quotaId) {
    const qm = bodyText.match(/(?:quota(?:_id)?|limit)\s*['":]?\s*([A-Za-z0-9_]*Per[A-Za-z0-9_]*)/i);
    if (qm) details.quotaId = qm[1];
  }
  if (!details.metric) {
    const mm = bodyText.match(/(?:quota_metric|metric)\s*['":]?\s*([A-Za-z0-9_]+)/i);
    if (mm) details.metric = mm[1];
  }
  if (!details.retryAfterMs) {
    const rm = bodyText.match(/retry (?:in|after)\s+([\d.]+)\s*s/i);
    if (rm) {
      details.retryDelay = `${rm[1]}s`;
      details.retryAfterMs = Math.ceil(Number(rm[1]) * 1000);
    }
  }

  return details;
}

export const classifyGemini: Classifier = (status, bodyText, headers) => {
  const msg = messageOf(bodyText);
  if (status === 400 && /api key not valid|API_KEY_INVALID/i.test(bodyText)) {
    return new ProviderError("invalid_key", "Gemini rejected the API key.");
  }
  if (status === 401) return new ProviderError("invalid_key", "Gemini rejected the API key.");
  if (status === 403) {
    if (/billing|payment|enable/i.test(msg)) {
      return new ProviderError("billing_required", "Billing is required for this Gemini feature.");
    }
    return new ProviderError("invalid_key", "Gemini rejected the API key or it lacks permission.");
  }
  if (status === 429) {
    const quota = parseGeminiQuotaDetails(bodyText, headers);

    // Log a short, key-free summary of quota details (never log keys or full prompts)
    console.warn(
      `[Gemini 429 Quota] metric=${quota.metric || "unknown"} quota_id=${quota.quotaId || "unknown"} limit=${
        quota.limit !== undefined ? quota.limit : "unknown"
      } retryDelay=${quota.retryDelay || (quota.retryAfterMs ? `${quota.retryAfterMs}ms` : "none")}`,
    );

    // Classify in strict required order:
    // (a) Daily limit (quota id or message contains PerDay / RequestsPerDay)
    const isDaily =
      (quota.quotaId && /PerDay/i.test(quota.quotaId)) ||
      (quota.message && /PerDay|RequestsPerDay|daily/i.test(quota.message)) ||
      /PerDay|RequestsPerDay|daily/i.test(bodyText);

    if (isDaily) {
      return new ProviderError(
        "quota_exceeded",
        "Your Gemini key's free daily limit is used up. It resets daily (around 12:30 pm IST), or you can enable billing, use another key, or try again later.",
      );
    }

    // (b) Per-minute limit or retry delay present (or limit > 0)
    const isPerMinute =
      (quota.retryAfterMs !== undefined && quota.retryAfterMs > 0) ||
      Boolean(quota.retryDelay) ||
      (quota.quotaId && /PerMinute|RPM/i.test(quota.quotaId)) ||
      /PerMinute|RPM/i.test(bodyText) ||
      (quota.limit !== undefined && quota.limit > 0);

    if (isPerMinute) {
      return new ProviderError(
        "rate_limited",
        "Gemini is rate limiting requests. We will retry automatically.",
        quota.retryAfterMs,
      );
    }

    // (c) ONLY when the reported limit value is exactly 0 for the model that was called
    if (quota.limit === 0 || /limit:\s*0\b/i.test(bodyText)) {
      return new ProviderError(
        "billing_required",
        "This Gemini key has no quota for the requested model (billing is not enabled).",
      );
    }

    // Default 429 fallback (a free-tier mention alone must never mean billing_required)
    return new ProviderError(
      "rate_limited",
      "Gemini is rate limiting requests.",
      quota.retryAfterMs,
    );
  }
  if (status === 400 && /blocked|safety/i.test(msg)) {
    return new ProviderError("content_blocked", "Gemini blocked this request.");
  }
  if (status >= 500) return new ProviderError("network", "Gemini had a temporary error.");
  return new ProviderError("bad_response", `Gemini returned an error (${status}).`);
};

type Part = Record<string, unknown>;

function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  lastModelUsed: string = MODELS.gemini.text;

  constructor(private key: string) {}

  private headers() {
    return { "x-goog-api-key": this.key };
  }

  async validateKey(): Promise<ValidationResult> {
    const data = await requestJson<{ models?: { name: string }[] }>({
      url: `${BASE}/models?pageSize=200`,
      method: "GET",
      headers: this.headers(),
      key: this.key,
      classify: classifyGemini,
      timeoutMs: 20_000,
    });
    return { ok: true, models: (data.models ?? []).map((m) => m.name.replace(/^models\//, "")) };
  }

  /**
   * Startup or admin check that calls the model-list endpoint and warns if the configured model is not available.
   */
  async verifyConfiguredModel(): Promise<{ available: boolean; configured: string; availableModels: string[] }> {
    try {
      const res = await this.validateKey();
      const configured = MODELS.gemini.text;
      const available = res.models.includes(configured);
      if (!available) {
        console.warn(
          `[Gemini Warning] Configured model "${configured}" was not found in available models: ${res.models.join(", ")}`,
        );
      }
      return { available, configured, availableModels: res.models };
    } catch (err: any) {
      console.warn(`[Gemini Warning] Failed to verify model availability:`, err?.message || err);
      return { available: false, configured: MODELS.gemini.text, availableModels: [] };
    }
  }

  private async generate(model: string, body: Record<string, unknown>) {
    return requestJson<any>({
      url: `${BASE}/models/${model}:generateContent`,
      headers: this.headers(),
      body,
      key: this.key,
      classify: classifyGemini,
    });
  }

  /**
   * Tries the primary model, and if it fails with quota or not-found,
   * retries once on the next model in GEMINI_TEXT_MODEL_FALLBACKS.
   */
  private async generateWithFallback(bodyBuilder: (model: string) => Record<string, unknown>) {
    const candidates = [MODELS.gemini.text, ...MODELS.gemini.textFallbacks];
    let lastErr: unknown = null;

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        this.lastModelUsed = model;
        const res = await this.generate(model, bodyBuilder(model));
        return res;
      } catch (err: any) {
        lastErr = err;
        const isQuotaOrNotFound =
          (err instanceof ProviderError &&
            (err.code === "quota_exceeded" || err.code === "rate_limited" || err.code === "billing_required")) ||
          (err instanceof Error && /not found|404|RESOURCE_EXHAUSTED|quota|limit/i.test(err.message));

        if (isQuotaOrNotFound && i < candidates.length - 1) {
          const nextModel = candidates[i + 1];
          console.warn(
            `[Gemini Fallback] Model "${model}" failed (${
              err instanceof ProviderError ? err.code : err?.message || "error"
            }). Retrying on fallback model "${nextModel}"...`,
          );
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private textOf(data: any): string {
    const parts: Part[] = data?.candidates?.[0]?.content?.parts ?? [];
    // Gemini 2.5 Flash outputs thought parts marked with thought: true.
    // Filter them out so internal reasoning tokens do not corrupt JSON or text extraction.
    const nonThoughtParts = parts.filter((p: any) => !p?.thought);
    const targetParts = nonThoughtParts.length > 0 ? nonThoughtParts : parts;
    const text = targetParts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
    if (!text) {
      if (data?.promptFeedback?.blockReason) {
        throw new ProviderError("content_blocked", "Gemini blocked this request.");
      }
      throw new ProviderError("bad_response", "Gemini returned no text.");
    }
    return text;
  }

  async generateText(system: string, prompt: string, opts?: { maxOutputTokens?: number }): Promise<string> {
    const data = await this.generateWithFallback(() => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: opts?.maxOutputTokens ?? 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }));
    return this.textOf(data);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const attachmentParts: Part[] = (req.attachments ?? []).map((a) =>
      a.kind === "inline"
        ? { inlineData: { mimeType: a.mimeType, data: a.data.toString("base64") } }
        : { fileData: { fileUri: a.url } },
    );
    return generateParsed(async (correction) => {
      const data = await this.generateWithFallback(() => ({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          {
            role: "user",
            parts: [...attachmentParts, { text: correction ? `${req.prompt}\n\n${correction}` : req.prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxOutputTokens ?? 8192,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }));
      return this.textOf(data);
    }, req.parse);
  }

  /**
   * The only image source in the app. Returns bytes that came back in the
   * provider's own response; nothing is ever fetched from a URL.
   */
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const model = MODELS.gemini.image;
    const parts: Part[] = [
      ...(req.references ?? []).map((r) => ({
        inlineData: { mimeType: r.mimeType, data: r.data.toString("base64") },
      })),
      { text: `${req.system}\n\n${req.prompt}` },
    ];
    const data = await this.generate(model, {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: req.aspectRatio },
      },
    });

    const outParts: Part[] = data?.candidates?.[0]?.content?.parts ?? [];
    for (const p of outParts) {
      const inline = (p.inlineData ?? p.inline_data) as { data?: string } | undefined;
      if (inline?.data) {
        const buf = Buffer.from(inline.data, "base64");
        const mime = sniffImage(buf);
        if (!mime || buf.length < 4096) {
          throw new ProviderError("bad_response", "Gemini returned an invalid image.");
        }
        return { mimeType: mime, data: buf, model };
      }
    }
    const reason = data?.candidates?.[0]?.finishReason;
    if (data?.promptFeedback?.blockReason || (reason && /SAFETY|PROHIBITED|IMAGE_/i.test(String(reason)))) {
      throw new ProviderError("content_blocked", "Gemini declined to draw this panel.");
    }
    throw new ProviderError("bad_response", "Gemini returned no image.");
  }
}
