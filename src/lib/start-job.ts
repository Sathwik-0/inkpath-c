import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser, fail, isUuid, json } from "@/lib/api";
import { JobRejected, createJob, type JobType } from "@/lib/engine/runner";
import type { Funding } from "@/lib/engine/credentials";

const PLATFORM_NON_CHAPTER_PER_DAY = 10;

/** Shared handler for the three generation routes. */
export async function startJobResponse(
  req: Request,
  projectId: string,
  type: JobType,
  chapterNumber?: number,
) {
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!isUuid(projectId)) return fail("Not found", 404);

  // RLS: the user client can only see their own projects.
  const { data: project } = await auth.supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return fail("Not found", 404);

  const admin = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as { funding?: string };
  const { count: keys } = await admin
    .from("provider_connections").select("provider", { count: "exact", head: true })
    .eq("user_id", auth.user.id).eq("status", "connected");
  const requested = body.funding === "byok" || body.funding === "platform" ? body.funding : null;
  const funding: Funding = requested ?? ((keys ?? 0) > 0 ? "byok" : "platform");
  if (funding === "byok" && !keys) return fail("Connect an AI provider key first.", 402, { code: "no_provider" });

  if (funding === "platform" && type !== "chapter") {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin
      .from("generation_jobs").select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id).eq("funding", "platform").neq("type", "chapter").gte("created_at", since);
    if ((count ?? 0) >= PLATFORM_NON_CHAPTER_PER_DAY)
      return fail("Free setup limit reached for today. Try again tomorrow or connect your own key.", 429, { code: "daily_limit" });
  }

  try {
    const { jobId, run } = await createJob({ userId: auth.user.id, projectId, type, chapterNumber, funding });
    after(run);
    return json({ jobId, funding }, 202);
  } catch (e) {
    if (e instanceof JobRejected) {
      const status = e.reason === "not_found" ? 404 : e.reason === "already_running" ? 409 : 402;
      return fail(e.message, status, { code: e.reason });
    }
    console.error("start job failed", e instanceof Error ? e.name : "error");
    return fail("Could not start generation.", 500);
  }
}
