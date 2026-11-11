import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser, fail, json } from "@/lib/api";
import { MAX_UPLOAD_BYTES, chunkText, extractText, kindFromName } from "@/lib/engine/ingest";
import { parseStorySettings } from "@/lib/engine/settings";

export const maxDuration = 60;

const MAX_PROJECTS_PER_USER = 30;
const Body = z.object({
  title: z.string().trim().max(160).optional(),
  topic: z.string().trim().max(300).optional(),
  text: z.string().trim().max(200_000).optional(),
  youtube: z.string().trim().url().max(300).optional(),
  settings: z.unknown().optional(),
});

export async function GET() {
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  const { data } = await auth.supabase
    .from("projects")
    .select("id,title,genre,synopsis,status,estimated_chapters,created_at")
    .order("created_at", { ascending: false });
  return json({ projects: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  const admin = createAdminClient();

  const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  if ((count ?? 0) >= MAX_PROJECTS_PER_USER) return fail("You have reached the project limit. Delete one to start another.", 429);

  let fields: z.infer<typeof Body> = {};
  let file: File | null = null;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    let rawSettings: unknown = undefined;
    const settingsStr = form.get("settings");
    if (typeof settingsStr === "string") {
      try {
        rawSettings = JSON.parse(settingsStr);
      } catch {
        rawSettings = undefined;
      }
    }
    fields = Body.parse({
      title: (form.get("title") as string) || undefined,
      topic: (form.get("topic") as string) || undefined,
      text: (form.get("text") as string) || undefined,
      youtube: (form.get("youtube") as string) || undefined,
      settings: rawSettings,
    });
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
  } else {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("Check the topic, text or link you entered.", 400);
    fields = parsed.data;
  }

  const validatedSettings = parseStorySettings(fields.settings);

  let extracted = "";
  let kind: "pdf" | "docx" | "txt" | "text" | "youtube" | "topic";
  let sourceTitle = fields.title || fields.topic || "Untitled";
  if (file) {
    const k = kindFromName(file.name);
    if (!k) return fail("Upload a PDF, DOCX or TXT file.", 400);
    if (file.size > MAX_UPLOAD_BYTES) return fail("That file is larger than 20 MB.", 413);
    kind = k;
    sourceTitle = fields.title || file.name.replace(/\.[^.]+$/, "");
    try {
      extracted = (await extractText(k, Buffer.from(await file.arrayBuffer()))).trim();
    } catch {
      return fail("We could not read that file. Try a different export or paste the text.", 422);
    }
    if (extracted.length < 200) return fail("That file has almost no readable text (it may be scanned images).", 422);
  } else if (fields.text) {
    kind = "text";
    extracted = fields.text;
  } else if (fields.youtube) {
    if (!/^https?:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\//i.test(fields.youtube)) return fail("That is not a YouTube link.", 400);
    kind = "youtube";
  } else if (fields.topic) {
    kind = "topic";
  } else {
    return fail("Add a topic, some text, a YouTube link or a file.", 400);
  }

  const { data: project, error } = await admin
    .from("projects")
    .insert({
      user_id: auth.user.id,
      title: sourceTitle,
      subject: fields.topic ?? sourceTitle,
      genre: validatedSettings.genre !== "auto" ? validatedSettings.genre : undefined,
      settings: validatedSettings,
    })
    .select("id").single();
  if (error || !project) return fail("Could not create the project.", 500);

  const { data: source } = await admin
    .from("source_documents")
    .insert({
      user_id: auth.user.id, project_id: project.id, kind, title: sourceTitle,
      url: fields.youtube ?? null, status: "ready",
    })
    .select("id").single();
  if (source && extracted) {
    const chunks = chunkText(extracted);
    await admin.from("extracted_content").insert(
      chunks.map((content, i) => ({
        user_id: auth.user.id, project_id: project.id, source_id: source.id, chunk_index: i, content,
      })),
    );
  }
  return json({ id: project.id }, 201);
}
