import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (user) redirect("/library");
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-margin-mobile text-center">
      <p className="font-label-md text-label-md uppercase tracking-widest text-tertiary">Study like you read</p>
      <h1 className="mt-4 font-display-xl-mobile text-display-xl-mobile text-primary md:font-display-xl md:text-display-xl">Inkpath</h1>
      <p className="mx-auto mt-6 max-w-xl text-body-lg text-on-surface-variant">
        Give it a topic, a PDF or a video. It writes a serial story where every plot problem is a concept you have to use, then brings back what you are about to forget.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link href="/signup" className="rounded-xl bg-primary-container px-6 py-3 font-label-md text-label-md text-on-primary-container">Start free: 3 chapters</Link>
        <Link href="/login" className="rounded-xl border border-outline-variant px-6 py-3 font-label-md text-label-md">Sign in</Link>
      </div>
    </div>
  );
}
