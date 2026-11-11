import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { GroqProvider } from "./groq";
import type { AIProvider, ProviderName } from "./types";

export function createProvider(name: ProviderName, key: string): AIProvider {
  switch (name) {
    case "gemini":
      return new GeminiProvider(key);
    case "openai":
      return new OpenAIProvider(key);
    case "anthropic":
      return new AnthropicProvider(key);
    case "groq":
      return new GroqProvider(key);
  }
}

export * from "./types";
export * from "./errors";
export * from "./groq";
