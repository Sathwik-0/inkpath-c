import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/library";
  if (code) await (await createClient()).auth.exchangeCodeForSession(code);
  // Only allow same-site relative redirects.
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/library";
  return NextResponse.redirect(new URL(safe, url.origin));
}
