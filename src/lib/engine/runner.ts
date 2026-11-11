import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveProvider, type Funding } from "./credentials";
import { stageAnalyze, stageBible, stageChapter } from "./stages";
import { publicError } from "@/lib/api";

export type JobType = "analyze" | "bible" | "chapter";

interface StartArgs {
  userId: string;
  projectId: string;
  type: JobType;
  chapterNumber?: number;
  funding: Funding;
}

export class JobRejected extends Error {
  constructor(public reason: string, message: string) {
    super(message);
  }
}

/**
 * Creates a job row (state lives in the database, not in memory) and returns
 * a function that runs it. Call the returned function inside `after()` so the
 * HTTP response is not held open.
 */
export async function createJob(a: StartArgs): Promise<{ jobId: string; run: () => Promise<void> }> {
  const admin = createAdminClient();

  // A function that died mid-job leaves a 'running' row; expire those so the user is never stuck.
  await admin
    .from("generation_jobs")
    .update({ status: "failed", error_code: "timeout", error_message: "That took too long and was stopped. Please try again." })
    .eq("project_id", a.projectId)
    .eq("user_id", a.userId)
    .in("status", ["queued", "running"])
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

  let chapterId: string | null = null;
  if (a.type === "chapter") {
    if (!a.chapterNumber) throw new JobRejected("bad_request", "Missing chapter number");
    const { data: ch } = await admin
      .from("chapters").select("id,status")
      .eq("project_id", a.projectId).eq("user_id", a.userId).eq("number", a.chapterNumber).maybeSingle();
    if (!ch) throw new JobRejected("not_found", "Chapter not found");
    chapterId = ch.id;

    // The previous chapter must exist before the next is written: the story is a serial.
    if (a.chapterNumber > 1) {
      const { data: prev } = await admin
        .from("chapters").select("status")
        .eq("project_id", a.projectId).eq("number", a.chapterNumber - 1).maybeSingle();
      if (prev?.status !== "ready") throw new JobRejected("previous_missing", "Read the previous chapter first");
    }

    if (a.funding === "platform") {
      const { data: r } = await admin.rpc("reserve_free_chapter", { p_user: a.userId, p_chapter: chapterId });
      if (!r?.ok) {
        const reason = (r?.reason as string) ?? "free_limit_reached";
        throw new JobRejected(
          reason,
          reason === "quiz_required"
            ? "Answer the recall questions for your last chapter to unlock the next free one."
            : "You have used your free chapters. Connect your own AI key to keep reading.",
        );
      }
    }
  }

  const { data: job, error } = await admin
    .from("generation_jobs")
    .insert({
      user_id: a.userId, project_id: a.projectId, chapter_id: chapterId, type: a.type,
      status: "queued", funding: a.funding, payload: { chapterNumber: a.chapterNumber ?? null },
    })
    .select("id").single();
  if (error || !job) {
    if (chapterId && a.funding === "platform") await admin.rpc("release_free_chapter", { p_user: a.userId, p_chapter: chapterId });
    throw new JobRejected("already_running", "That is already being generated.");
  }

  const run = async () => {
    const set = (v: Record<string, unknown>) => admin.from("generation_jobs").update(v).eq("id", job.id);
    try {
      await set({ status: "running", step: a.type, progress: 10 });
      const { provider, name } = await resolveProvider(admin, a.userId, a.funding, a.type === "chapter" ? "story" : "analysis");
      await set({ provider: name });
      if (a.type === "analyze") await stageAnalyze(admin, provider, a.userId, a.projectId);
      else if (a.type === "bible") await stageBible(admin, provider, a.userId, a.projectId);
      else await stageChapter(admin, provider, a.userId, a.projectId, a.chapterNumber!);
      await set({ status: "succeeded", progress: 100, step: "done" });
    } catch (e: any) {
      const { code, message } = publicError(e);
      console.error("job failed", job.id, a.type, code, e?.message || e);
      if (e?.stack) console.error(e.stack);
      // A failed free chapter must not use up the allowance.
      if (chapterId && a.funding === "platform") await admin.rpc("release_free_chapter", { p_user: a.userId, p_chapter: chapterId });
      if (chapterId) await admin.from("chapters").update({ status: "failed" }).eq("id", chapterId).neq("status", "ready");
      await set({ status: code === "quota_exceeded" || code === "billing_required" ? "paused" : "failed", error_code: code, error_message: message });
    }
  };
  return { jobId: job.id, run };
}
