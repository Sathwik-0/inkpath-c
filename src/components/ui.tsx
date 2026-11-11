"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export const card = "rounded-xl border border-outline-variant bg-surface-container p-6";
export const btn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary-container px-5 py-3 font-label-md text-label-md text-on-primary-container transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant px-5 py-3 font-label-md text-label-md text-on-surface transition hover:bg-surface-container-high disabled:opacity-50";
export const input =
  "w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none";

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const nav = [
    { href: "/library", label: "Library" },
    { href: "/create", label: "New story" },
    { href: "/settings", label: "AI keys" },
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-outline-variant bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-margin-mobile py-3 md:px-margin">
          <Link href="/library" className="font-headline-sm text-headline-sm text-primary">Inkpath</Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href}
                className={`rounded-xl px-3 py-2 font-label-md text-label-md ${path.startsWith(n.href) ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:text-on-surface"}`}>
                {n.label}
              </Link>
            ))}
            <button
              className="rounded-xl px-3 py-2 font-label-md text-label-md text-on-surface-variant hover:text-on-surface"
              onClick={async () => { await createClient().auth.signOut(); router.push("/login"); router.refresh(); }}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-margin-mobile py-8 md:px-margin">{children}</main>
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-xl border border-error/40 bg-error-container/30 px-4 py-3 text-body-md text-error">{children}</p>;
}

/** Polls a job until it finishes. Calls onDone with the final job row. */
export async function waitForJob(jobId: string, onTick?: (j: { status: string; step: string | null }) => void) {
  for (let i = 0; i < 200; i++) {
    const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
    const j = await r.json();
    onTick?.(j);
    if (["succeeded", "failed", "paused"].includes(j.status)) return j as { status: string; error_message?: string; error_code?: string };
    await new Promise((res) => setTimeout(res, 2500));
  }
  return { status: "failed", error_message: "This is taking longer than expected. Refresh to check again." };
}
