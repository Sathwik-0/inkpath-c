import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser, fail, isUuid, json } from "@/lib/api";
import { recordRecall } from "@/lib/engine/stages";

const Body = z.object({ answers: z.array(z.number().int().min(0).max(10)).min(1).max(12) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!isUuid(id)) return fail("Not found", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Send your answers as a list of option numbers.", 400);
  // RLS check that the chapter is the caller's.
  const { data: ch } = await auth.supabase.from("chapters").select("id").eq("id", id).maybeSingle();
  if (!ch) return fail("Not found", 404);
  try {
    return json(await recordRecall(createAdminClient(), auth.user.id, id, parsed.data.answers));
  } catch {
    return fail("Could not record your answers.", 500);
  }
}
