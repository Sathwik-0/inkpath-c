import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { card } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "System window" };

export default async function System({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const [{ data: concepts }, { data: learner }] = await Promise.all([
    supabase.from("concepts").select("id,name,objective,world_rule,position").eq("project_id", id).order("position"),
    supabase.from("learner_concepts").select("concept_id,level,next_review_at,lapses").eq("project_id", id),
  ]);
  const byId = new Map((learner ?? []).map((l) => [l.concept_id, l]));
  const now = Date.now();
  return (
    <div>
      <Link href={`/p/${id}`} className="text-body-sm text-on-surface-variant hover:text-on-surface">← {project.title}</Link>
      <h1 className="mt-4 font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">System window</h1>
      <p className="mt-2 max-w-2xl text-body-lg text-on-surface-variant">
        Each concept is a skill. A level only rises when you recall it correctly after longer and longer gaps, and it drops if you forget.
      </p>
      <ul className="mt-8 space-y-gutter-mobile">
        {(concepts ?? []).map((c) => {
          const l = byId.get(c.id);
          const level = l?.level ?? 0;
          const due = !!l?.next_review_at && new Date(l.next_review_at).getTime() <= now;
          return (
            <li key={c.id} className={card}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-title-md text-title-md">{c.name}</h2>
                  {c.objective && <p className="mt-1 text-body-md text-on-surface-variant">{c.objective}</p>}
                </div>
                <span className="shrink-0 font-label-md text-label-md text-primary">Lv {level}/10</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container-lowest" aria-hidden>
                <div className="h-full rounded-full bg-primary-container" style={{ width: `${level * 10}%` }} />
              </div>
              <p className="mt-3 text-body-sm text-on-surface-variant">
                {!l ? "Not met yet" : due ? "Due for review: it returns in your next chapter" : l.next_review_at ? `Next review ${new Date(l.next_review_at).toLocaleDateString()}` : "Take the recall questions to start the clock"}
                {l && l.lapses > 0 ? ` · forgotten ${l.lapses}×` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
