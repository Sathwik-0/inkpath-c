import { currentUser, fail, isUuid, json } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!isUuid(id)) return fail("Not found", 404);
  const { data } = await auth.supabase
    .from("generation_jobs")
    .select("id,type,status,step,progress,error_code,error_message,project_id,chapter_id")
    .eq("id", id).maybeSingle();
  if (!data) return fail("Not found", 404);
  return json(data);
}
