"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, card, input, ErrorNote, waitForJob } from "@/components/ui";
import { StorySettingsPanel } from "@/components/StorySettingsPanel";
import { DEFAULT_STORY_SETTINGS, type StorySettings } from "@/lib/engine/settings";

type Mode = "topic" | "text" | "file" | "youtube";
const tabs: { id: Mode; label: string }[] = [
  { id: "topic", label: "Topic" },
  { id: "text", label: "Paste text" },
  { id: "file", label: "PDF / DOCX" },
  { id: "youtube", label: "YouTube" },
];

export default function Create() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("topic");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [youtube, setYoutube] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<StorySettings>(DEFAULT_STORY_SETTINGS);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const busy = !!step;

  async function run(url: string, label: string, projectId: string) {
    setStep(label);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? "Something went wrong.");
    const done = await waitForJob(body.jobId);
    if (done.status !== "succeeded") throw new Error(done.error_message ?? "That step did not finish.");
    return projectId;
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStep("Saving your material and settings…");
    try {
      const form = new FormData();
      if (mode === "topic") form.set("topic", topic);
      if (mode === "text") form.set("text", text);
      if (mode === "youtube") form.set("youtube", youtube);
      if (mode === "file" && file) form.set("file", file);
      form.set("settings", JSON.stringify(settings));

      const r = await fetch("/api/projects", { method: "POST", body: form });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Could not save that.");
      await run(`/api/projects/${body.id}/analyze`, "Finding the ideas you need to learn…", body.id);
      await run(`/api/projects/${body.id}/bible`, "Designing your story world…", body.id);
      router.push(`/p/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep("");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">
        What do you need to learn?
      </h1>
      <p className="mt-2 text-body-lg text-on-surface-variant">
        Inkpath turns it into a serial story where every problem needs the idea to solve.
      </p>
      <form onSubmit={start} className={`${card} mt-8 space-y-6`}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                type="button"
                key={t.id}
                disabled={busy}
                onClick={() => setMode(t.id)}
                className={`rounded-xl px-4 py-2 font-label-md text-label-md ${
                  mode === t.id
                    ? "bg-primary-container text-on-primary-container"
                    : "border border-outline-variant text-on-surface-variant"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {mode === "topic" && (
            <input
              className={input}
              required
              maxLength={300}
              placeholder="e.g. How recursion works"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={busy}
            />
          )}
          {mode === "text" && (
            <textarea
              className={`${input} min-h-48`}
              required
              placeholder="Paste your notes or chapter text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
          )}
          {mode === "youtube" && (
            <>
              <input
                className={input}
                required
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={youtube}
                onChange={(e) => setYoutube(e.target.value)}
                disabled={busy}
              />
              <p className="text-body-sm text-on-surface-variant">Video links need a Google Gemini key in AI keys.</p>
            </>
          )}
          {mode === "file" && (
            <input
              className={input}
              required
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          )}
        </div>

        {/* Story Settings Panel (Part A.1) */}
        <StorySettingsPanel settings={settings} onChange={setSettings} disabled={busy} />

        <ErrorNote>{error}</ErrorNote>
        <button className={`${btn} w-full`} disabled={busy}>
          {busy ? step : "Create my story"}
        </button>
        {busy && (
          <p className="text-center text-body-sm text-on-surface-variant">
            This takes about a minute. You can keep this tab open.
          </p>
        )}
      </form>
    </div>
  );
}
