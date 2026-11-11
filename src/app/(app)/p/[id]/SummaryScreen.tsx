"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, btnGhost, card, ErrorNote } from "@/components/ui";
import { StorySettingsPanel } from "@/components/StorySettingsPanel";
import { parseStorySettings, type StorySettings } from "@/lib/engine/settings";
import type { TimeBudget } from "@/lib/engine/budget";

interface Props {
  projectId: string;
  initialSettings: any;
  chapterCount: number;
  hasReadyChapter: boolean;
  onOutlineRegenerated?: () => void;
}

export function SummaryScreen({
  projectId,
  initialSettings,
  chapterCount,
  hasReadyChapter,
}: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<StorySettings>(parseStorySettings(initialSettings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const budget: TimeBudget | undefined = initialSettings?.budget;
  const comparisonText =
    budget?.comparisonText ||
    `Studying this directly: about ${chapterCount * 12} min. Inkpath story plus recall: about ${Math.round(chapterCount * 9)} min.`;

  async function handleSaveSettings(regenerate: boolean) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings,
          regenerateOutline: regenerate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings.");
      setSuccess(regenerate ? "Outline regenerated with new settings!" : "Settings saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} space-y-6 mb-8`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-outline-variant pb-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">
            {hasReadyChapter ? "Story & Time Overview" : "Story Summary & Outline"}
          </h2>
          <p className="text-body-md text-on-surface-variant">
            {hasReadyChapter
              ? "Settings are locked for consistency across this serial."
              : "Review your pacing and settings before writing Chapter 1."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary-container px-3 py-1 font-label-md text-label-md text-on-primary-container">
            {chapterCount} {chapterCount === 1 ? "Chapter" : "Chapters"}
          </span>
          {budget?.isMicroChapter && (
            <span className="rounded-full bg-tertiary/20 px-3 py-1 font-label-md text-label-md text-tertiary">
              Micro-session
            </span>
          )}
        </div>
      </div>

      {/* Part B.10: Time comparison banner */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <p className="font-label-sm text-label-sm uppercase tracking-wider text-primary">
            Time Efficiency Budget
          </p>
          <p className="mt-1 font-title-md text-title-md text-on-surface">
            {comparisonText}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            Inkpath is capped to guarantee you learn more in equal or less time than direct study.
          </p>
        </div>
        {budget && (
          <div className="text-right text-body-sm text-on-surface-variant shrink-0">
            <div>Reading: ~{budget.totalReadingMinutes} min</div>
            <div>Recall: ~{budget.totalRecallMinutes} min</div>
          </div>
        )}
      </div>

      {/* Part B.7: Omitted concepts if source is long */}
      {budget?.omittedConcepts && budget.omittedConcepts.length > 0 && (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-high/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-title-sm text-title-sm text-on-surface">
              Concepts Saved for Later ({budget.omittedConcepts.length})
            </h4>
            <span className="text-body-sm text-tertiary">Add the rest later</span>
          </div>
          <p className="text-body-sm text-on-surface-variant">
            To prevent story sprawl and honor the strict 12-chapter limit, only the most fundamental concepts were included:
          </p>
          <ul className="list-disc list-inside text-body-sm text-on-surface-variant space-y-1">
            {budget.omittedConcepts.map((c, i) => (
              <li key={i}>
                <span className="font-medium text-on-surface">{c.name}</span>: {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Part A: Settings display (editable before Chapter 1, read-only after) */}
      <StorySettingsPanel
        settings={settings}
        onChange={setSettings}
        disabled={busy}
        readOnly={hasReadyChapter}
      />

      <ErrorNote>{error}</ErrorNote>
      {success && <p className="text-body-md text-primary font-medium">{success}</p>}

      {!hasReadyChapter && (
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => handleSaveSettings(true)}
          >
            {busy ? "Updating…" : "Regenerate outline with settings"}
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={busy}
            onClick={() => handleSaveSettings(false)}
          >
            Save settings without regenerating
          </button>
        </div>
      )}
    </div>
  );
}

