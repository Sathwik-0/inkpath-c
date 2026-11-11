import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keyAad, openSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { createProvider, type AIProvider, type ProviderName } from "@/lib/ai";

export type Funding = "platform" | "byok";
export type Task = "analysis" | "story" | "storyboard" | "explanations" | "images";

export class NoProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoProviderError";
  }
}

export class PlatformPausedError extends Error {
  constructor() {
    super("Free generation is temporarily paused. Please try again later or connect your own key.");
    this.name = "PlatformPausedError";
  }
}

export interface ResolvedProvider {
  provider: AIProvider;
  name: ProviderName;
  funding: Funding;
}

const TEXT_FALLBACK_ORDER: ProviderName[] = ["gemini", "anthropic", "openai", "groq"];

/**
 * Returns the list of active, configured platform providers for text generation,
 * honoring PLATFORM_TEXT_PROVIDERS, per-provider disable flags, and story preference.
 */
export function getPlatformTextCandidates(preferred?: ProviderName | null): { name: ProviderName; provider: AIProvider }[] {
  if (serverEnv.platformGenerationPaused) throw new PlatformPausedError();

  const configuredOrder = serverEnv.platformTextProviders;
  const orderedNames: ProviderName[] = [];

  // Prefer original story provider if specified and configured
  if (preferred && configuredOrder.includes(preferred)) {
    orderedNames.push(preferred);
    for (const p of configuredOrder) {
      if (p !== preferred) orderedNames.push(p);
    }
  } else {
    orderedNames.push(...configuredOrder);
  }

  const result: { name: ProviderName; provider: AIProvider }[] = [];
  for (const name of orderedNames) {
    if (serverEnv.isPlatformProviderDisabled(name)) continue;
    const key = serverEnv.getPlatformKey(name);
    if (!key) continue;
    result.push({ name, provider: createProvider(name, key) });
  }

  if (result.length === 0) {
    throw new NoProviderError("Free generation is not configured on this server yet or all platform providers are disabled.");
  }

  return result;
}

/**
 * Picks the key that pays for a job. The funding source is decided once when
 * the job is created and never changes: if a user's own key fails we stop and
 * ask, we do NOT quietly switch to the platform key (or the reverse).
 */
export async function resolveProvider(
  admin: SupabaseClient,
  userId: string,
  funding: Funding,
  task: Task,
  preferred?: ProviderName | null,
): Promise<ResolvedProvider> {
  if (funding === "platform") {
    if (serverEnv.platformGenerationPaused) throw new PlatformPausedError();
    if (task === "images") {
      const key = serverEnv.geminiPlatformKey;
      if (!key) throw new NoProviderError("Free generation is not configured on this server yet.");
      return { provider: createProvider("gemini", key), name: "gemini", funding };
    }
    const candidates = getPlatformTextCandidates(preferred);
    const primary = candidates[0];
    return { provider: primary.provider, name: primary.name, funding };
  }

  const [{ data: rows }, { data: profile }] = await Promise.all([
    admin
      .from("provider_connections")
      .select("provider,key_ciphertext,key_iv,key_tag,status,capabilities")
      .eq("user_id", userId),
    admin.from("profiles").select("ai_routing").eq("id", userId).maybeSingle(),
  ]);

  const usable = (rows ?? []).filter((r) => r.status === "connected");
  const routing = (profile?.ai_routing ?? {}) as Partial<Record<Task, ProviderName>>;

  const order: ProviderName[] =
    task === "images"
      ? ["gemini"]
      : [routing[task], ...TEXT_FALLBACK_ORDER].filter((p): p is ProviderName => !!p);

  for (const name of order) {
    const row = usable.find((r) => r.provider === name);
    if (!row) continue;
    const key = openSecret(
      { ciphertext: row.key_ciphertext, iv: row.key_iv, tag: row.key_tag },
      keyAad(userId, name),
    );
    return { provider: createProvider(name, key), name, funding };
  }

  throw new NoProviderError(
    task === "images"
      ? "Connect a Google Gemini key with image access to draw illustrated panels."
      : "Connect an AI provider key in Settings to continue.",
  );
}

/** Whether this user's own Gemini key may be used for images (null = never tested). */
export async function byokCanDrawImages(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("provider_connections")
    .select("status,capabilities")
    .eq("user_id", userId)
    .eq("provider", "gemini")
    .maybeSingle();
  if (!data || data.status !== "connected") return false;
  return (data.capabilities as { image?: boolean | null } | null)?.image !== false;
}
