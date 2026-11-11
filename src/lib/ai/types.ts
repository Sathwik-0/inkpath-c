export type ProviderName = "gemini" | "openai" | "anthropic" | "groq";

export const PROVIDERS: ProviderName[] = ["gemini", "openai", "anthropic", "groq"];

export const PROVIDER_LABEL: Record<ProviderName, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  groq: "Groq",
};

/** Source material that a provider can read natively (Gemini only). */
export type Attachment =
  | { kind: "inline"; mimeType: string; data: Buffer }
  | { kind: "youtube"; url: string };

export interface JsonRequest<T> {
  system: string;
  prompt: string;
  /** Zod `.parse` (or similar): throws when the shape is wrong. */
  parse: (raw: unknown) => T;
  attachments?: Attachment[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface ImageRequest {
  /** Per-panel prompt. */
  prompt: string;
  /** Standing art direction rules, prepended to the prompt. */
  system: string;
  /** Character reference sheet(s) so faces and outfits stay consistent. */
  references?: { mimeType: string; data: Buffer }[];
  aspectRatio: "9:16" | "3:4" | "1:1" | "16:9";
}

export interface ImageResult {
  mimeType: string;
  data: Buffer;
  model: string;
}

export interface ValidationResult {
  ok: true;
  /** Model ids the key can see (used to confirm an image model exists). */
  models: string[];
}

export interface AIProvider {
  readonly name: ProviderName;
  /** Free check (lists models). Throws ProviderError on a bad key. */
  validateKey(): Promise<ValidationResult>;
  generateText(system: string, prompt: string, opts?: { maxOutputTokens?: number }): Promise<string>;
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
  /** Present only on providers that can make images. */
  generateImage?(req: ImageRequest): Promise<ImageResult>;
}
