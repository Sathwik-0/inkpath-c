import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Recall } from "./Recall";

export const dynamic = "force-dynamic";

interface Scene { heading: string; text: string; concepts_applied?: string[] }

export default async function Reader({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) notFound();
  const supabase = await createClient();
  const { data: ch } = await supabase
    .from("chapters").select("id,number,title,prose,hook,verified,status")
    .eq("project_id", id).eq("number", num).maybeSingle();
  if (!ch || ch.status !== "ready" || !ch.prose) notFound();

  // Ownership is proven above through RLS. Answers are stripped before anything reaches the browser.
  const { data: quiz } = await createAdminClient().from("quizzes").select("questions").eq("chapter_id", ch.id).maybeSingle();
  const questions = ((quiz?.questions ?? []) as { prompt: string; options: string[]; concept_name?: string }[]).map((q) => ({
    prompt: q.prompt, options: q.options, concept: q.concept_name ?? "",
  }));
  const { count: total } = await supabase.from("chapters").select("id", { count: "exact", head: true }).eq("project_id", id);
  const scenes = (ch.prose as { scenes: Scene[] }).scenes;

  return (
    <article className="mx-auto max-w-2xl">
      <Link href={`/p/${id}`} className="text-body-sm text-on-surface-variant hover:text-on-surface">← All chapters</Link>
      <p className="mt-6 font-label-sm text-label-sm uppercase text-tertiary">Chapter {ch.number}</p>
      <h1 className="mt-1 font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">{ch.title}</h1>
      <div className="mt-8 space-y-10">
        {scenes.map((s, i) => (
          <section key={i}>
            <h2 className="font-label-md text-label-md uppercase tracking-widest text-on-surface-variant">{s.heading}</h2>
            <div className="mt-3 space-y-4 text-body-lg leading-8">
              {s.text.split(/\n{2,}/).map((p, j) => <p key={j}>{p}</p>)}
            </div>
          </section>
        ))}
      </div>
      {ch.hook && (
        <p className="mt-12 border-l-2 border-primary pl-4 font-title-md text-title-md italic text-primary">{ch.hook}</p>
      )}
      {!ch.verified && (
        <p className="mt-8 rounded-xl border border-outline-variant px-4 py-3 text-body-sm text-on-surface-variant">
          Our fact-check flagged this chapter. Double-check key claims against your source before relying on it.
        </p>
      )}
      <Recall chapterId={ch.id} questions={questions} projectId={id} next={num < (total ?? 0) ? num + 1 : null} />
    </article>
  );
}
