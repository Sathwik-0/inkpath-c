import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveProvider, getPlatformTextCandidates, type Funding } from "./credentials";
import { stageAnalyze, stageBible, stageChapter } from "./stages";
import { publicError } from "@/lib/api";
import { ProviderError, type ProviderName } from "@/lib/ai";
import { MODELS } from "@/lib/ai/config";

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
 * Checks whether an error is eligible for platform provider failover.
 * Only fail over on: rate limited, quota exceeded, server error (5xx), network error,
 * timeout, and bad_response (schema failure after retries).
 * Never fail over on invalid key (alert instead) or content blocked.
 */
export function isFailoverEligible(err: unknown): boolean {
  if (err instanceof ProviderError) {
    if (
      err.code === "rate_limited" ||
      err.code === "quota_exceeded" ||
      err.code === "network" ||
      err.code === "bad_response"
    ) {
      return true;
    }
    return false;
  }
  if (err instanceof Error) {
    if (/timed?\s*out|timeout|network|econnrefused|econnreset|fetch failed|socket|5\d\d/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

/**
 * Looks up the provider that generated Chapter 1 (or the earliest chapter)
 * so subsequent chapters can prefer the same provider for story continuity.
 */
async function getOriginalStoryProvider(admin: any, projectId: string): Promise<ProviderName | null> {
  const { data: ch } = await admin
    .from("chapters")
    .select("brief")
    .eq("project_id", projectId)
    .eq("number", 1)
    .maybeSingle();
  if (ch?.brief && typeof ch.brief === "object" && (ch.brief as any).provider) {
    return (ch.brief as any).provider as ProviderName;
  }
  return null;
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
    .in("status", ["queued", "running", "paused"])
    .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString());

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

  // Clear any existing paused/stale job for this chapter or project so retry works immediately
  const existingJobQuery = admin
    .from("generation_jobs")
    .update({ status: "failed" })
    .eq("project_id", a.projectId)
    .eq("user_id", a.userId)
    .eq("status", "paused");
  if (chapterId) {
    await existingJobQuery.eq("chapter_id", chapterId);
  } else {
    await existingJobQuery.eq("type", a.type);
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
    const telemetryEntries: any[] = [];

    try {
      await set({ status: "running", step: a.type, progress: 10 });

      if (a.funding === "byok") {
        // BYOK: single provider resolved from user's keys. NEVER falls back to platform.
        const { provider, name } = await resolveProvider(
          admin,
          a.userId,
          "byok",
          a.type === "chapter" ? "story" : "analysis",
        );
        await set({ provider: name });

        const start = Date.now();
        let stepRes: any = null;
        if (a.type === "analyze") stepRes = await stageAnalyze(admin, provider, a.userId, a.projectId);
        else if (a.type === "bible") stepRes = await stageBible(admin, provider, a.userId, a.projectId);
        else stepRes = await stageChapter(admin, provider, a.userId, a.projectId, a.chapterNumber!);

        const durationMs = Date.now() - start;
        const usedModel = (provider as any).lastModelUsed || (name === "gemini" ? MODELS.gemini.text : undefined);
        telemetryEntries.push({
          step: a.type,
          provider: name,
          model: usedModel,
          durationMs,
          callsCount: stepRes?.callsCount ?? 1,
          failoverCount: 0,
        });

        await set({
          status: "succeeded",
          progress: 100,
          step: "done",
          payload: { chapterNumber: a.chapterNumber ?? null, telemetry: telemetryEntries },
        });
      } else {
        // PLATFORM: fallback chain
        const originalProvider = await getOriginalStoryProvider(admin, a.projectId);
        const candidates = getPlatformTextCandidates(originalProvider);

        let lastErr: unknown = null;
        let successfulProvider: ProviderName | null = null;
        const failovers: { from: ProviderName; to: ProviderName; reason: string }[] = [];

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          const name = candidate.name;
          const provider = candidate.provider;

          if (i > 0) {
            console.warn(
              `[platform fallback] Step "${a.type}" failed on previous provider. Retrying on fallback provider: ${name} (error: ${
                lastErr instanceof ProviderError ? lastErr.code : lastErr instanceof Error ? lastErr.message : "error"
              })`,
            );
          } else {
            console.log(`[platform execution] Step "${a.type}" running on provider: ${name}`);
          }

          await set({ provider: name });
          const start = Date.now();

          try {
            let stepRes: any = null;
            if (a.type === "analyze") stepRes = await stageAnalyze(admin, provider, a.userId, a.projectId);
            else if (a.type === "bible") stepRes = await stageBible(admin, provider, a.userId, a.projectId);
            else stepRes = await stageChapter(admin, provider, a.userId, a.projectId, a.chapterNumber!);

            const durationMs = Date.now() - start;
            successfulProvider = name;
            const usedModel = (provider as any).lastModelUsed || (name === "gemini" ? MODELS.gemini.text : undefined);

            telemetryEntries.push({
              step: a.type,
              provider: name,
              model: usedModel,
              durationMs,
              callsCount: stepRes?.callsCount ?? 1,
              failoverCount: i,
              failovers,
            });

            break; // Succeeded!
          } catch (stepErr: any) {
            lastErr = stepErr;

            if (stepErr instanceof ProviderError && stepErr.code === "invalid_key") {
              console.error(`[ALERT] Platform key for provider "${name}" rejected as invalid! Do not failover on bad credentials.`);
              throw stepErr;
            }
            if (stepErr instanceof ProviderError && stepErr.code === "content_blocked") {
              // Do not fail over on content blocked
              throw stepErr;
            }

            const canFailover = isFailoverEligible(stepErr) && i < candidates.length - 1;
            if (canFailover) {
              const nextName = candidates[i + 1].name;
              failovers.push({
                from: name,
                to: nextName,
                reason: stepErr instanceof ProviderError ? stepErr.code : stepErr instanceof Error ? stepErr.message : "error",
              });
              continue;
            }

            // Not eligible or all candidates exhausted
            throw stepErr;
          }
        }

        if (!successfulProvider) {
          throw lastErr || new Error("All platform providers failed.");
        }

        await set({
          status: "succeeded",
          progress: 100,
          step: "done",
          provider: successfulProvider,
          payload: { chapterNumber: a.chapterNumber ?? null, telemetry: telemetryEntries },
        });
      }
    } catch (e: any) {
      const { code, message } = publicError(e, "text");
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
