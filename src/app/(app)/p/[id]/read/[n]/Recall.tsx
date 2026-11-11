"use client";
import Link from "next/link";
import { useState } from "react";
import { btn, card, ErrorNote } from "@/components/ui";

interface Q { prompt: string; options: string[]; concept: string }
interface Result {
  score: number; total: number;
  concepts: { name: string; correct: boolean; level: number }[];
  review: { correct: boolean; correctIndex: number; explanation: string; evidence?: string; sourceQuote?: string }[];
}

export function Recall({ chapterId, questions, projectId, next }: { chapterId: string; questions: Q[]; projectId: string; next: number | null }) {
  const [answers, setAnswers] = useState<(number | null)[]>(questions.map(() => null));
  const [result, setResult] = useState<Result | null>(null);
  const [showSource, setShowSource] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!questions.length) return null;
  const ready = answers.every((a) => a !== null);

  const toggleSource = (idx: number) => {
    setShowSource((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  async function submit() {
    setBusy(true); setError("");
    const r = await fetch(`/api/chapters/${chapterId}/recall`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }),
    });
    const body = await r.json();
    if (!r.ok) setError(body.error ?? "Could not record your answers.");
    else setResult(body);
    setBusy(false);
  }

  return (
    <section className={`${card} mt-12`}>
      <h2 className="font-headline-sm text-headline-sm">Lock it in</h2>
      <p className="mt-1 text-body-md text-on-surface-variant">Answer from memory. This is what makes it stick, and it decides what returns in later chapters.</p>
      <div className="mt-6 space-y-8">
        {questions.map((q, i) => (
          <div key={i}>
            <p className="font-title-md text-title-md">{q.prompt}</p>
            <div className="mt-3 space-y-2">
              {q.options.map((o, j) => {
                const rv = result?.review[i];
                const state = rv ? (j === rv.correctIndex ? "border-tertiary bg-tertiary/10" : answers[i] === j ? "border-error bg-error-container/30" : "border-outline-variant") : answers[i] === j ? "border-primary bg-primary/10" : "border-outline-variant hover:bg-surface-container-high";
                return (
                  <button key={j} disabled={!!result} onClick={() => setAnswers((a) => a.map((x, k) => (k === i ? j : x)))}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-body-md ${state}`}>{o}</button>
                );
              })}
            </div>
            {result && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body-md text-on-surface-variant flex-1">{result.review[i].explanation}</p>
                  {(result.review[i].sourceQuote || result.review[i].evidence) && (
                    <button
                      type="button"
                      onClick={() => toggleSource(i)}
                      className="rounded border border-outline-variant px-2 py-0.5 text-xs text-primary hover:bg-surface-container-high transition"
                    >
                      {showSource[i] ? "Hide Source" : "Source"}
                    </button>
                  )}
                </div>
                {showSource[i] && (result.review[i].sourceQuote || result.review[i].evidence) && (
                  <div className="rounded-lg bg-surface-container-high p-3 text-body-sm border-l-2 border-primary">
                    <p className="text-xs font-semibold uppercase text-tertiary">Source Quote</p>
                    <blockquote className="mt-1 italic text-on-surface">
                      “{result.review[i].sourceQuote || result.review[i].evidence}”
                    </blockquote>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-4">
        <ErrorNote>{error}</ErrorNote>
        {!result ? (
          <button className={btn} disabled={!ready || busy} onClick={submit}>{busy ? "Checking…" : "Check my answers"}</button>
        ) : (
          <div>
            <p className="font-title-md text-title-md">{result.score} of {result.total} correct</p>
            <ul className="mt-2 text-body-md text-on-surface-variant">
              {result.concepts.map((c) => <li key={c.name}>{c.name}: level {c.level}/10 {c.correct ? "" : "· will come back soon"}</li>)}
            </ul>
            <div className="mt-4 flex gap-3">
              {next ? <Link className={btn} href={`/p/${projectId}`}>Continue to chapter {next}</Link> : <Link className={btn} href={`/p/${projectId}/system`}>See your System window</Link>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
