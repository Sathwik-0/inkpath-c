import { ProviderError } from "./errors";

/** Pull a JSON value out of a model reply, tolerating code fences and chatter. */
export function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.search(/[[{]/);
  if (first > 0) s = s.slice(first);
  return JSON.parse(s);
}

/**
 * Ask the model, parse and validate; if the reply is malformed, ask once more
 * with a correction note. `parse` should be a Zod `.parse` so shape errors throw.
 */
export async function generateParsed<T>(
  generate: (correction?: string) => Promise<string>,
  parse: (raw: unknown) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate(
      attempt === 0
        ? undefined
        : "Your previous reply was not valid JSON matching the required shape. Reply with ONLY the corrected JSON.",
    );
    try {
      return parse(extractJson(raw));
    } catch {
      // fall through and retry once
    }
  }
  throw new ProviderError("bad_response", "The model returned data in an unexpected format.");
}
