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
    // A free-tier key has a hard limit of 0 for image models: not a temporary rate limit.
    if (/limit:\s*0|free.?tier|billing/i.test(bodyText)) {
      return new ProviderError(
        "billing_required",
        "This Gemini key has no quota for the requested model (billing is not enabled).",
      );
    }
    if (/per.?day|daily|RequestsPerDay/i.test(bodyText)) {
      return new ProviderError("quota_exceeded", "The daily Gemini quota for this key is used up.");
    }
    return new ProviderError("rate_limited", "Gemini is rate limiting requests.", retryAfterMs(bodyText, headers));
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

  private async generate(model: string, body: Record<string, unknown>) {
    return requestJson<any>({
      url: `${BASE}/models/${model}:generateContent`,
      headers: this.headers(),
      body,
      key: this.key,
      classify: classifyGemini,
    });
  }

  private textOf(data: any): string {
    const parts: Part[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
    if (!text) {
      if (data?.promptFeedback?.blockReason) {
        throw new ProviderError("content_blocked", "Gemini blocked this request.");
      }
      throw new ProviderError("bad_response", "Gemini returned no text.");
    }
    return text;
  }

  async generateText(system: string, prompt: string, opts?: { maxOutputTokens?: number }): Promise<string> {
    const data = await this.generate(MODELS.gemini.text, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: opts?.maxOutputTokens ?? 2048 },
    });
    return this.textOf(data);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const attachmentParts: Part[] = (req.attachments ?? []).map((a) =>
      a.kind === "inline"
        ? { inlineData: { mimeType: a.mimeType, data: a.data.toString("base64") } }
        : { fileData: { fileUri: a.url } },
    );
    return generateParsed(async (correction) => {
      const data = await this.generate(MODELS.gemini.text, {
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
        },
      });
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
