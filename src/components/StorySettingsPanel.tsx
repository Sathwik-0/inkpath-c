"use client";
import React from "react";
import { input } from "@/components/ui";
import {
  type StorySettings,
  GENRE_OPTIONS,
  TONE_OPTIONS,
  WORLD_SETTING_OPTIONS,
  NARRATION_OPTIONS,
  STORY_INTENSITY_OPTIONS,
  DEPTH_OPTIONS,
  LEARNER_LEVEL_OPTIONS,
} from "@/lib/engine/settings";

interface Props {
  settings: StorySettings;
  onChange: (s: StorySettings) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export function StorySettingsPanel({ settings, onChange, disabled = false, readOnly = false }: Props) {
  const update = <K extends keyof StorySettings>(key: K, value: StorySettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const isCustomChar = settings.mainCharacter?.mode === "custom";

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-title-md text-title-md text-on-surface">Story settings</h3>
        <span className="text-body-sm text-on-surface-variant">
          {readOnly ? "Locked (Chapter 1 exists)" : "Defaults to Auto"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Genre */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Genre
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.genre}
            onChange={(e) => update("genre", e.target.value as any)}
          >
            {GENRE_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g === "auto" ? "Auto (model chooses)" : capitalize(g)}
              </option>
            ))}
          </select>
        </div>

        {/* Tone */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Tone
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.tone}
            onChange={(e) => update("tone", e.target.value as any)}
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "auto" ? "Auto (model chooses)" : capitalize(t)}
              </option>
            ))}
          </select>
        </div>

        {/* World Setting */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            World setting
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.worldSetting}
            onChange={(e) => update("worldSetting", e.target.value as any)}
          >
            {WORLD_SETTING_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w === "auto" ? "Auto (model chooses)" : capitalize(w)}
              </option>
            ))}
          </select>
        </div>

        {/* Narration */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Narration
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.narration}
            onChange={(e) => update("narration", e.target.value as any)}
          >
            {NARRATION_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === "third person" ? "Third person (default)" : "First person (I / me)"}
              </option>
            ))}
          </select>
        </div>

        {/* Story Intensity */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Story intensity
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.intensity}
            onChange={(e) => update("intensity", e.target.value as any)}
          >
            {STORY_INTENSITY_OPTIONS.map((i) => (
              <option key={i} value={i}>
                {i === "lean"
                  ? "Lean (focus on the lesson, minimal scenery)"
                  : i === "balanced"
                    ? "Balanced (default)"
                    : "Immersive (rich world & atmospheric pacing)"}
              </option>
            ))}
          </select>
        </div>

        {/* Depth (time budget factor) */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Depth & Time Budget
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.depth}
            onChange={(e) => update("depth", e.target.value as any)}
          >
            {DEPTH_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d === "quick"
                  ? "Quick (0.5× time budget)"
                  : d === "standard"
                    ? "Standard (0.8× time budget, default)"
                    : "Deep (1.0× time budget)"}
              </option>
            ))}
          </select>
        </div>

        {/* Learner Level */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Learner level
          </label>
          <select
            className={input}
            disabled={disabled || readOnly}
            value={settings.learnerLevel}
            onChange={(e) => update("learnerLevel", e.target.value as any)}
          >
            {LEARNER_LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l === "beginner"
                  ? "Beginner (analogy first, no unexplained jargon)"
                  : l === "intermediate"
                    ? "Intermediate (balanced depth)"
                    : "Advanced (edge cases & trade-offs)"}
              </option>
            ))}
          </select>
        </div>

        {/* Language */}
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1">
            Language
          </label>
          <input
            className={input}
            disabled={disabled || readOnly}
            value={settings.language}
            onChange={(e) => update("language", e.target.value)}
            placeholder="e.g. English"
          />
        </div>
      </div>

      {/* Main Character */}
      <div className="pt-2 border-t border-outline-variant space-y-2">
        <label className="block font-label-md text-label-md text-on-surface-variant">
          Main character
        </label>
        <div className="flex gap-4">
          <label className="inline-flex items-center gap-2 text-body-md">
            <input
              type="radio"
              name="mc-mode"
              disabled={disabled || readOnly}
              checked={!isCustomChar}
              onChange={() => update("mainCharacter", { mode: "auto" })}
            />
            Auto (original protagonist)
          </label>
          <label className="inline-flex items-center gap-2 text-body-md">
            <input
              type="radio"
              name="mc-mode"
              disabled={disabled || readOnly}
              checked={isCustomChar}
              onChange={() =>
                update("mainCharacter", {
                  mode: "custom",
                  name: settings.mainCharacter?.name || "",
                  description: settings.mainCharacter?.description || "",
                })
              }
            />
            Custom protagonist
          </label>
        </div>
        {isCustomChar && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <input
              className={input}
              disabled={disabled || readOnly}
              placeholder="Character name (e.g. Kai)"
              value={settings.mainCharacter?.name || ""}
              onChange={(e) =>
                update("mainCharacter", {
                  mode: "custom",
                  name: e.target.value,
                  description: settings.mainCharacter?.description,
                })
              }
            />
            <input
              className={input}
              disabled={disabled || readOnly}
              placeholder="One-line description (e.g. apprentice pilot who questions rules)"
              value={settings.mainCharacter?.description || ""}
              onChange={(e) =>
                update("mainCharacter", {
                  mode: "custom",
                  name: settings.mainCharacter?.name || "",
                  description: e.target.value,
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

