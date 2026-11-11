import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { card } from "@/components/ui";
import { ChapterList } from "./ChapterList";
import { SummaryScreen } from "./SummaryScreen";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id,title,synopsis,genre,settings")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const [{ data: chapters }, { data: concepts }, { data: free }] = await Promise.all([
    supabase.from("chapters").select("id,number,title,summary,status").eq("project_id", id).order("number"),
    supabase.from("concepts").select("id").eq("project_id", id),
    supabase.rpc("free_status"),
  ]);

  const hasReadyChapter = (chapters ?? []).some((c) => c.status === "ready");

  return (
    <div className="pb-12">
      <p className="font-label-sm text-label-sm uppercase text-tertiary">{project.genre}</p>
      <h1 className="mt-1 font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">
        {project.title}
      </h1>
      {project.synopsis && <p className="mt-3 max-w-2xl text-body-lg text-on-surface-variant">{project.synopsis}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href={`/p/${id}/system`}
          className="rounded-xl border border-outline-variant px-4 py-2 font-label-md text-label-md hover:bg-surface-container-high"
        >
          System window · {concepts?.length ?? 0} skills
        </Link>
      </div>

      {/* Part B.11: Spaced review session (optional, ≤ 2 minutes) */}
      {hasReadyChapter && (
        <div className="mt-6 rounded-2xl border border-tertiary/40 bg-tertiary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-tertiary">
                Spaced Review Session
              </span>
              <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
                Optional · ≤ 2 min
              </span>
            </div>
            <p className="mt-1 text-body-md text-on-surface">
              Quick 2-minute memory reinforcement. Does not count against your study budget.
            </p>
          </div>
          <Link
            href={`/p/${id}/system`}
            className="rounded-xl bg-tertiary px-4 py-2 font-label-md text-label-md text-on-tertiary hover:opacity-90 shrink-0"
          >
            Review skills (2m)
          </Link>
        </div>
      )}

      {/* Part A.3 & Part B.10: Summary screen */}
      <div className="mt-8">
        <SummaryScreen
          projectId={id}
          initialSettings={project.settings}
          chapterCount={chapters?.length ?? 1}
          hasReadyChapter={hasReadyChapter}
        />
      </div>

      <div className={`${card} mt-8`}>
        <ChapterList
          projectId={id}
          chapters={chapters ?? []}
          freeRemaining={(free as { remaining: number } | null)?.remaining ?? 0}
        />
      </div>
    </div>
  );
}
