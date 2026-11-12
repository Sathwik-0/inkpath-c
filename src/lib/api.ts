import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProviderError, userMessage } from "@/lib/ai";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, status);
}

/** Returns the signed-in user or null. Always verifies with the auth server. */
export async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { user, supabase } : null;
}

export function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Safe text for the UI from any thrown error. Never includes key material. */
export function publicError(e: unknown, task: "text" | "image" = "text"): { code: string; message: string } {
  if (e instanceof ProviderError) {
    const isGenericError = /returned an error \(\d+\)|returned an unreadable response|returned no text/i.test(e.message);
    const message = e.message && !isGenericError ? e.message : userMessage(e.code, "the provider", task);
    return { code: e.code, message };
  }
  if (e instanceof Error && ["NoProviderError", "PlatformPausedError"].includes(e.name))
    return { code: e.name === "PlatformPausedError" ? "platform_paused" : "no_provider", message: e.message };
  return { code: "internal", message: "Something went wrong. Please try again." };
}
