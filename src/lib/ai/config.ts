/**
 * Every model name lives here so a provider rename is a one-line change.
 * Each can be overridden by an environment variable without touching code.
 *
 * Gemini ids below come from Google's published model list (Firebase AI Logic
 * docs, Nov 2026): image models gemini-3.1-flash-image (Nano Banana 2),
 * gemini-3.1-flash-lite-image, gemini-nano-banana-2.1, gemini-3-pro-image.
 * Those docs state image models need a paid plan. Confirm names on
 * https://ai.google.dev before launch; OpenAI and Claude defaults are untested.
 */
export const MODELS = {
  gemini: {
    get text() {
      return process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash";
    },
    get image() {
      return process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
    },
  },
  openai: {
    get text() {
      return process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
    },
  },
  anthropic: {
    get text() {
      return process.env.ANTHROPIC_TEXT_MODEL || "claude-sonnet-5-5";
    },
  },
} as const;
