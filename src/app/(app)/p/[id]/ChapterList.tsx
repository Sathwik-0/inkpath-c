"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, btnGhost, ErrorNote, waitForJob } from "@/components/ui";

interface Ch { id: string; number: number; title: string; summary: string | null; status: string }

export function ChapterList({ projectId, chapters, freeRemaining }: { projectId: string; chapters: Ch[]; freeRemaining: number }) {
  const router = useRouter();
  const [busyN, setBusyN] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const firstPending = chapters.find((c) => c.status !== "ready")?.number;

  async function generate(n: number, funding?: "byok" | "platform") {
    setError(""); setNeedKey(false); setBusyN(n);
    try {
      const r = await fetch(`/api/projects/${projectId}/chapters/${n}/generate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(funding ? { funding } : {}),
      });
      const body = await r.json();
      if (!r.ok) {
        if (["free_limit_reached", "no_provider"].includes(body.code)) setNeedKey(true);
        throw new Error(body.error ?? "Could not start.");
      }
      const done = await waitForJob(body.jobId);
      if (done.status !== "succeeded") {
        if (["quota_exceeded", "billing_required", "invalid_key", "no_provider", "platform_paused"].includes(done.error_code ?? "")) setNeedKey(true);
        throw new Error(done.error_message ?? "That chapter did not finish.");
      }
      router.push(`/p/${projectId}/read/${n}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusyN(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-headline-sm text-headline-sm">Chapters</h2>
        <span className="text-body-sm text-on-surface-variant">{freeRemaining} free chapter{freeRemaining === 1 ? "" : "s"} left</span>
      </div>
      <ol className="mt-4 divide-y divide-outline-variant">
        {chapters.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-4 py-4">
            <div>
              <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Chapter {c.number}</p>
              <p className="font-title-md text-title-md">{c.title}</p>
              {c.summary && c.status !== "ready" && <p className="mt-1 text-body-md text-on-surface-variant">{c.summary}</p>}
            </div>
            {c.status === "ready" ? (
              <Link href={`/p/${projectId}/read/${c.number}`} className={btnGhost}>Read</Link>
            ) : c.number === firstPending ? (
              <button className={btn} disabled={busyN !== null} onClick={() => generate(c.number)}>
                {busyN === c.number ? "Writing…" : c.status === "failed" ? "Try again" : "Write it"}
              </button>
            ) : (
              <span className="pt-2 text-body-sm text-outline">Locked</span>
            )}
          </li>
        ))}
      </ol>
      {busyN !== null && <p className="mt-4 text-body-sm text-on-surface-variant">Writing and fact-checking your chapter. About a minute.</p>}
      <div className="mt-4 space-y-3">
        <ErrorNote>{error}</ErrorNote>
        {needKey && <Link href="/settings" className="inline-block text-primary">Connect your own AI key →</Link>}
      </div>
    </div>
  );
}
