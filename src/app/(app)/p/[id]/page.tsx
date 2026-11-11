import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { card } from "@/components/ui";
import { ChapterList } from "./ChapterList";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id,title,synopsis,genre").eq("id", id).maybeSingle();
  if (!project) notFound();
  const [{ data: chapters }, { data: concepts }, { data: free }] = await Promise.all([
    supabase.from("chapters").select("id,number,title,summary,status").eq("project_id", id).order("number"),
    supabase.from("concepts").select("id").eq("project_id", id),
    supabase.rpc("free_status"),
  ]);
  return (
    <div>
      <p className="font-label-sm text-label-sm uppercase text-tertiary">{project.genre}</p>
      <h1 className="mt-1 font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">{project.title}</h1>
      {project.synopsis && <p className="mt-3 max-w-2xl text-body-lg text-on-surface-variant">{project.synopsis}</p>}
      <div className="mt-4 flex gap-3">
        <Link href={`/p/${id}/system`} className="rounded-xl border border-outline-variant px-4 py-2 font-label-md text-label-md hover:bg-surface-container-high">
          System window · {concepts?.length ?? 0} skills
        </Link>
      </div>
      <div className={`${card} mt-8`}>
        <ChapterList projectId={id} chapters={chapters ?? []} freeRemaining={(free as { remaining: number } | null)?.remaining ?? 0} />
      </div>
    </div>
  );
}
