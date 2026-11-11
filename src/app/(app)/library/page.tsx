import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { card } from "@/components/ui";

export const metadata = { title: "Library" };
export const dynamic = "force-dynamic";

const label: Record<string, string> = {
  draft: "Setting up", analyzed: "Concepts ready", previewed: "Story ready", ready: "Reading", generating: "Writing", failed: "Needs attention", approved: "Reading",
};

export default async function Library() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects").select("id,title,genre,synopsis,status,estimated_chapters").order("created_at", { ascending: false });
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">Your stories</h1>
        <Link href="/create" className="rounded-xl bg-primary-container px-5 py-3 font-label-md text-label-md text-on-primary-container">New story</Link>
      </div>
      {!projects?.length ? (
        <div className={`${card} mt-8 text-center`}>
          <p className="text-body-lg text-on-surface-variant">Nothing here yet. Give Inkpath a topic and read it as a story.</p>
          <Link href="/create" className="mt-4 inline-block text-primary">Start your first story →</Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-gutter-mobile md:grid-cols-2 md:gap-gutter">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.id}`} className={`${card} block transition hover:border-primary`}>
                <p className="font-label-sm text-label-sm uppercase text-tertiary">{p.genre ?? "story"} · {label[p.status] ?? p.status}</p>
                <h2 className="mt-2 font-headline-sm text-headline-sm">{p.title}</h2>
                {p.synopsis && <p className="mt-2 line-clamp-3 text-body-md text-on-surface-variant">{p.synopsis}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
