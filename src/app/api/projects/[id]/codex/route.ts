import { currentUser, fail, isUuid, json } from "@/lib/api";

/** The "System window": every concept as a skill with a level driven by recall. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!isUuid(id)) return fail("Not found", 404);
  const [{ data: concepts }, { data: learner }] = await Promise.all([
    auth.supabase.from("concepts").select("id,name,objective,world_rule,position").eq("project_id", id).order("position"),
    auth.supabase.from("learner_concepts").select("concept_id,level,next_review_at,lapses,introduced_in,last_seen_at").eq("project_id", id),
  ]);
  const byId = new Map((learner ?? []).map((l) => [l.concept_id, l]));
  const now = Date.now();
  return json({
    skills: (concepts ?? []).map((c) => {
      const l = byId.get(c.id);
      return {
        id: c.id, name: c.name, objective: c.objective, worldRule: c.world_rule,
        met: !!l, level: l?.level ?? 0, maxLevel: 10, lapses: l?.lapses ?? 0,
        due: !!l?.next_review_at && new Date(l.next_review_at).getTime() <= now,
        nextReviewAt: l?.next_review_at ?? null,
      };
    }),
  });
}
