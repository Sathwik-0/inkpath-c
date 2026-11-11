"use client";
import React, { useState } from "react";
import type { ConceptCitation } from "@/lib/engine/citations";

export interface ConceptSourceItem {
  id: string;
  name: string;
  explanation?: string;
  citations: ConceptCitation[];
  isUnsourced: boolean;
  statusLabel?: string;
}

interface Props {
  concepts: ConceptSourceItem[];
}

export function ChapterSources({ concepts }: Props) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  if (!concepts || concepts.length === 0) return null;

  const toggle = (id: string) => {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="mt-12 rounded-2xl border border-outline-variant bg-surface p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-outline-variant pb-4">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface">Chapter Sources & Citations</h3>
          <p className="text-body-sm text-on-surface-variant">
            Every concept taught in this chapter is verified against source material.
          </p>
        </div>
        <span className="rounded-full bg-surface-container-high px-3 py-1 font-label-sm text-label-sm text-on-surface-variant self-start">
          {concepts.length} {concepts.length === 1 ? "Concept" : "Concepts"}
        </span>
      </div>

      <div className="space-y-4">
        {concepts.map((c) => {
          const isOpen = openMap[c.id] ?? true;
          return (
            <div key={c.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface">{c.name}</h4>
                  {c.explanation && (
                    <p className="mt-1 text-body-sm text-on-surface-variant">{c.explanation}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="text-body-sm text-primary hover:underline shrink-0"
                >
                  {isOpen ? "Hide citations" : "Show citations"}
                </button>
              </div>

              {isOpen && (
                <div className="mt-4 pt-3 border-t border-outline-variant/60 space-y-3">
                  {c.citations && c.citations.length > 0 ? (
                    c.citations.map((cit, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-surface-container-high/60 p-3 text-body-sm text-on-surface-variant space-y-2 border-l-2 border-primary"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-on-surface">
                            {cit.sourceTitle || "Source document"}
                          </span>
                          <span className="rounded bg-surface-container-highest px-2 py-0.5 text-xs text-on-surface">
                            {cit.location || "Location recorded"}
                          </span>
                        </div>
                        <blockquote className="italic text-on-surface font-sans">
                          “{cit.quote}”
                        </blockquote>
                        {cit.sourceUrl ? (
                          <a
                            href={cit.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-xs text-primary hover:underline"
                          >
                            Open source at {cit.location} →
                          </a>
                        ) : (
                          <span className="text-xs text-outline">
                            Verified excerpt from {cit.location}
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-surface-container-high/40 p-3 text-body-sm text-on-surface-variant flex items-center justify-between">
                      <span>{c.statusLabel || "from general knowledge, not independently sourced"}</span>
                      <span className="text-xs text-outline">unsourced</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

