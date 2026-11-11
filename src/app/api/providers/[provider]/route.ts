import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser, fail, json } from "@/lib/api";
import { PROVIDERS } from "@/lib/ai";

export async function DELETE(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!(PROVIDERS as string[]).includes(provider)) return fail("Not found", 404);
  await createAdminClient().from("provider_connections").delete().eq("user_id", auth.user.id).eq("provider", provider);
  return json({ ok: true });
}
