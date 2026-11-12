"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, btnGhost, ErrorNote, waitForJob } from "@/components/ui";

interface Ch { id: string; number: number; title: string; summary: string | null; status: string }

export function ChapterList({ projectId, chapters, freeRemaining }: { projectId: string; chapters: Ch[]; freeRemaining: number }) {
  const router = useRouter();
  const [busyN, setBusyN] = useState<number | null>(null);
  const [failedN, setFailedN] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [isQuotaPaused, setIsQuotaPaused] = useState(false);
  const firstPending = chapters.find((c) => c.status !== "ready")?.number;

  async function generate(n: number, funding?: "byok" | "platform") {
    setError("");
    setNeedKey(false);
    setIsQuotaPaused(false);
    setBusyN(n);
    try {
      const r = await fetch(`/api/projects/${projectId}/chapters/${n}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(funding ? { funding } : {}),
      });
      const body = await r.json();
      if (!r.ok) {
        if (["free_limit_reached", "no_provider"].includes(body.code)) setNeedKey(true);
        if (body.code === "quota_exceeded" || body.code === "daily_limit") setIsQuotaPaused(true);
        setFailedN(n);
        throw new Error(body.error ?? "Could not start.");
      }
      const done = await waitForJob(body.jobId);
      if (done.status !== "succeeded") {
        setFailedN(n);
        if (done.status === "paused" || ["quota_exceeded", "daily_limit"].includes(done.error_code ?? "")) {
          setIsQuotaPaused(true);
        }
        if (["quota_exceeded", "billing_required", "invalid_key", "no_provider", "platform_paused"].includes(done.error_code ?? "")) {
          setNeedKey(true);
        }
        throw new Error(done.error_message ?? "That chapter did not finish.");
      }
      router.push(`/p/${projectId}/read/${n}`);
    } catch (e: any) {
      setFailedN(n);
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setError(msg);
      if (/quota|daily limit|resets daily/i.test(msg)) {
        setIsQuotaPaused(true);
      }
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
                {busyN === c.number ? "Writing…" : (c.status === "failed" || failedN === c.number) ? "Try again" : "Write it"}
              </button>
            ) : (
              <span className="pt-2 text-body-sm text-outline">Locked</span>
            )}
          </li>
        ))}
      </ol>
      {busyN !== null && <p className="mt-4 text-body-sm text-on-surface-variant">Writing and fact-checking your chapter. About a minute.</p>}

      {isQuotaPaused ? (
        <div className="mt-6 rounded-2xl border border-warning/40 bg-warning/5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-warning font-semibold">
              Generation Paused — Quota Limit
            </span>
          </div>
          <p className="text-body-md text-on-surface leading-relaxed">
            {error || "Your Gemini key's free daily limit is used up. It resets daily (around 12:30 pm IST), or you can enable billing, use another key, or try again later."}
          </p>
          <div className="rounded-xl bg-surface-container p-3 text-body-sm text-on-surface-variant space-y-1">
            <p className="font-semibold text-on-surface">Available options:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><strong>Wait:</strong> Free daily quota resets daily around 12:30 pm IST (midnight UTC).</li>
              <li><strong>Enable billing:</strong> Add a billing card on your Google AI Studio project.</li>
              <li><strong>Connect another key:</strong> Switch to Groq, Claude, or OpenAI in settings.</li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              className={btn}
              disabled={busyN !== null}
              onClick={() => generate(failedN ?? firstPending ?? 1)}
            >
              {busyN !== null ? "Writing…" : "Try again"}
            </button>
            <Link href="/settings" className={btnGhost}>
              Connect another AI key →
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <ErrorNote>{error}</ErrorNote>
          {needKey && <Link href="/settings" className="inline-block text-primary">Connect your own AI key →</Link>}
        </div>
      )}
    </div>
  );
}
