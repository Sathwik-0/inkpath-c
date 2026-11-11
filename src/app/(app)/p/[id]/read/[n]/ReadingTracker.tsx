"use client";
import React, { useEffect, useState, useRef } from "react";

interface Props {
  projectId: string;
  chapterNumber: number;
  estimatedMinutes: number;
  wordCount: number;
}

export function ReadingTracker({ projectId, chapterNumber, estimatedMinutes, wordCount }: Props) {
  const [seconds, setSeconds] = useState(0);
  const [tooLongFeedback, setTooLongFeedback] = useState(false);
  const [busy, setBusy] = useState(false);
  const loggedRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMinutes = Math.round((seconds / 60) * 10) / 10;

  async function handleTooLong() {
    if (tooLongFeedback || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tooLongClicked: true,
          readingTime: {
            chapterNumber,
            actualSeconds: seconds,
            estimatedMinutes,
          },
        }),
      });
      if (res.ok) {
        setTooLongFeedback(true);
        loggedRef.current = true;
      }
    } catch {
      // silent
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-high/40 px-4 py-2.5 text-body-sm text-on-surface-variant">
      <div className="flex items-center gap-3">
        <span>
          <strong className="text-on-surface">Estimated:</strong> ~{estimatedMinutes} min ({wordCount} words)
        </span>
        <span className="text-outline">·</span>
        <span>
          <strong className="text-on-surface">Actual on page:</strong> {elapsedMinutes} min
        </span>
      </div>

      <div>
        {tooLongFeedback ? (
          <span className="text-primary font-medium">✓ Reduced next chapters by 20%</span>
        ) : (
          <button
            type="button"
            onClick={handleTooLong}
            disabled={busy}
            className="rounded-lg border border-outline-variant px-3 py-1 font-label-sm text-label-sm text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            {busy ? "Saving…" : "Too long?"}
          </button>
        )}
      </div>
    </div>
  );
}
