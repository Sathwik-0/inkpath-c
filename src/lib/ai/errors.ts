export type ProviderErrorCode =
  | "invalid_key"
  | "billing_required" // key is valid but the account has no quota for this feature (e.g. images on a free Gemini key)
  | "quota_exceeded" // daily/monthly quota or credit used up
  | "rate_limited" // transient: retry with backoff
  | "content_blocked"
  | "bad_response"
  | "unsupported"
  | "network";

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** Errors where retrying later can succeed without the user doing anything. */
  get transient() {
    return this.code === "rate_limited" || this.code === "network";
  }
}

/** Plain-language messages that are safe to show in the UI. Never include key material. */
export function userMessage(
  code: ProviderErrorCode,
  provider = "the provider",
  task: "text" | "image" = "text",
): string {
  switch (code) {
    case "invalid_key":
      return `${provider} rejected this API key. Check that it is copied correctly and still active.`;
    case "billing_required":
      if (task === "image") {
        return `${provider} accepted the key but this account has no quota for image generation. Image models need billing enabled on the provider account. Text generation may still work.`;
      }
      return `${provider} accepted the key but this account has no quota for the requested text model. Enable billing on the provider account, switch to a free model, or connect another key.`;
    case "quota_exceeded":
      if (provider.toLowerCase().includes("gemini")) {
        return "Your Gemini key's free daily limit is used up. It resets daily (around 12:30 pm IST), or you can enable billing, use another key, or try again later.";
      }
      return `${provider} says the quota or credit for this key is used up. Generation is paused. Add credit, replace the key, or choose another provider.`;
    case "rate_limited":
      return `${provider} is rate limiting requests. We will retry automatically.`;
    case "content_blocked":
      if (task === "image") {
        return `${provider} declined to generate this panel. Try regenerating it.`;
      }
      return `${provider} declined to generate this content due to safety filters. Try adjusting your prompt.`;
    case "unsupported":
      return `${provider} does not support this feature.`;
    case "network":
      return `Could not reach ${provider}. We will retry automatically.`;
    default:
      return `${provider} returned an unexpected response.`;
  }
}
