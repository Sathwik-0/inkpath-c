import "server-only";

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
