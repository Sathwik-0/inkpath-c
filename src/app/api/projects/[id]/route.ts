import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser, fail, isUuid, json } from "@/lib/api";
import { parseStorySettings } from "@/lib/engine/settings";
import { stageBible } from "@/lib/engine/stages";
import { resolveProvider } from "@/lib/engine/credentials";

export const maxDuration = 120;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!isUuid(id)) return fail("Not found", 404);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id,title,subject,genre,synopsis,status,settings,estimated_chapters,created_at")
    .eq("id", id)
    .maybeSingle();

  if (!project) return fail("Project not found", 404);
  return json({ project });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  if (!isUuid(id)) return fail("Not found", 404);

  const admin = createAdminClient();

  // Verify project ownership and check if chapter 1 is already written
  const { data: project } = await admin
    .from("projects")
    .select("id,settings")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!project) return fail("Project not found", 404);

  const { data: chapters } = await admin
    .from("chapters")
    .select("id,number,status")
    .eq("project_id", id)
    .eq("user_id", auth.user.id);

  const isLocked = (chapters ?? []).some((c) => c.status === "ready");

  const body = (await req.json().catch(() => ({}))) as {
    settings?: unknown;
    regenerateOutline?: boolean;
    tooLongClicked?: boolean;
    readingTime?: { chapterNumber: number; actualSeconds: number; estimatedMinutes: number };
  };

  const currentSettings = parseStorySettings(project.settings);

  // If this is a feedback / too-long update, allow even if locked
  if (body.tooLongClicked || body.readingTime) {
    let reductionFactor = currentSettings.reductionFactor ?? 1;
    if (body.tooLongClicked) {
      // Rule 12: reduces the word target of future chapters by 20% (minimum 400 words / min factor ~0.4)
      reductionFactor = Math.max(0.4, Math.round(reductionFactor * 0.8 * 100) / 100);
    }
    const feedbackList = [...(currentSettings.readingTimeFeedback ?? [])];
    if (body.readingTime) {
      feedbackList.push({
        chapterNumber: body.readingTime.chapterNumber,
        actualSeconds: body.readingTime.actualSeconds,
        estimatedMinutes: body.readingTime.estimatedMinutes,
        tooLongClicked: !!body.tooLongClicked,
      });
    }

    const updatedSettings = {
      ...currentSettings,
      reductionFactor,
      readingTimeFeedback: feedbackList,
    };

    await admin.from("projects").update({ settings: updatedSettings }).eq("id", id);
    return json({ ok: true, reductionFactor, settings: updatedSettings });
  }

  // If user wants to edit story settings:
  if (isLocked) {
    return fail("Settings are locked once Chapter 1 has been generated.", 400);
  }

  const updatedSettings = parseStorySettings(body.settings ?? currentSettings);

  await admin
    .from("projects")
    .update({
      genre: updatedSettings.genre !== "auto" ? updatedSettings.genre : undefined,
      settings: updatedSettings,
    })
    .eq("id", id);

  // If user asked to regenerate outline with the new settings
  if (body.regenerateOutline) {
    const { provider } = await resolveProvider(admin, auth.user.id, "byok", "analysis");
    await stageBible(admin, provider, auth.user.id, id);
  }

  return json({ ok: true, settings: updatedSettings });
}
