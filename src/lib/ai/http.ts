import { ProviderError } from "./errors";

export type Classifier = (status: number, bodyText: string, headers: Headers) => ProviderError;

/** Remove a secret from any text that might end up in an error or a log. */
export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

interface RequestOptions {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  key: string;
  classify: Classifier;
  timeoutMs?: number;
}

export async function requestJson<T = any>(opts: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method ?? "POST",
      headers: { "content-type": "application/json", ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 110_000),
    });
  } catch {
    throw new ProviderError("network", "Could not reach the AI provider.");
  }

  const text = await res.text();
  if (!res.ok) {
    throw opts.classify(res.status, redact(text.slice(0, 2000), opts.key), res.headers);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("bad_response", "The provider returned an unreadable response.");
  }
}

/** Parse "retry in 12.3s" style hints or a Retry-After header into milliseconds. */
export function retryAfterMs(bodyText: string, headers: Headers): number | undefined {
  const header = headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Math.ceil(Number(header) * 1000);
  const m = bodyText.match(/retry (?:in|after)\s+([\d.]+)\s*s/i);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  return undefined;
}
