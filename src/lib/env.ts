import "server-only";
import type { ProviderName } from "./ai/types";

/**
 * Server-only environment access. Values are read lazily so a missing variable
 * only fails the code path that needs it (and never leaks into the client bundle).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get geminiPlatformKey() {
    return process.env.GEMINI_PLATFORM_KEY || "";
  },
  get groqPlatformKey() {
    return process.env.GROQ_PLATFORM_KEY || "";
  },
  getPlatformKey(provider: ProviderName): string {
    switch (provider) {
      case "gemini":
        return process.env.GEMINI_PLATFORM_KEY || "";
      case "groq":
        return process.env.GROQ_PLATFORM_KEY || "";
      case "openai":
        return process.env.OPENAI_PLATFORM_KEY || "";
      case "anthropic":
        return process.env.ANTHROPIC_PLATFORM_KEY || "";
      default:
        return "";
    }
  },
  get platformTextProviders(): ProviderName[] {
    const raw = process.env.PLATFORM_TEXT_PROVIDERS || "gemini,groq";
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((p): p is ProviderName => ["gemini", "groq", "openai", "anthropic"].includes(p as ProviderName));
  },
  isPlatformProviderDisabled(provider: ProviderName): boolean {
    if (process.env.PLATFORM_GENERATION_PAUSED === "true") return true;
    if (process.env[`PLATFORM_DISABLE_${provider.toUpperCase()}`] === "true") return true;
    return false;
  },
  get jobRunnerSecret() {
    return required("JOB_RUNNER_SECRET");
  },
  get appUrl() {
    return process.env.APP_URL || "http://localhost:3000";
  },
  /** When "true", all platform-funded (free tier) generation is paused. */
  get platformGenerationPaused() {
    return process.env.PLATFORM_GENERATION_PAUSED === "true";
  },
};
