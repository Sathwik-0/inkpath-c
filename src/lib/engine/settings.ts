import { z } from "zod";

export const GENRE_OPTIONS = [
  "auto",
  "sci-fi",
  "fantasy",
  "mystery",
  "thriller",
  "adventure",
  "historical",
  "slice-of-life",
  "sports",
  "school drama",
] as const;
export type GenreOption = (typeof GENRE_OPTIONS)[number];

export const TONE_OPTIONS = ["auto", "serious", "light and funny", "dark", "hopeful"] as const;
export type ToneOption = (typeof TONE_OPTIONS)[number];

export const WORLD_SETTING_OPTIONS = [
  "auto",
  "futuristic city",
  "modern day",
  "fantasy kingdom",
  "historical era",
  "school",
  "space station",
  "small town",
] as const;
export type WorldSettingOption = (typeof WORLD_SETTING_OPTIONS)[number];

export const NARRATION_OPTIONS = ["third person", "first person"] as const;
export type NarrationOption = (typeof NARRATION_OPTIONS)[number];

export const STORY_INTENSITY_OPTIONS = ["lean", "balanced", "immersive"] as const;
export type StoryIntensityOption = (typeof STORY_INTENSITY_OPTIONS)[number];

export const DEPTH_OPTIONS = ["quick", "standard", "deep"] as const;
export type DepthOption = (typeof DEPTH_OPTIONS)[number];

export const LEARNER_LEVEL_OPTIONS = ["beginner", "intermediate", "advanced"] as const;
export type LearnerLevelOption = (typeof LEARNER_LEVEL_OPTIONS)[number];

export const StorySettingsSchema = z.object({
  genre: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase().replace(/[_\s]+/g, " ");
        if (s.includes("sci")) return "sci-fi";
        if (s.includes("slice")) return "slice-of-life";
        if (s.includes("school")) return "school drama";
        if ((GENRE_OPTIONS as readonly string[]).includes(s)) return s as GenreOption;
      }
      return "auto";
    }),
  tone: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if ((TONE_OPTIONS as readonly string[]).includes(s)) return s as ToneOption;
        if (s.includes("light") || s.includes("funny")) return "light and funny";
      }
      return "auto";
    }),
  worldSetting: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if ((WORLD_SETTING_OPTIONS as readonly string[]).includes(s)) return s as WorldSettingOption;
        if (s.includes("futur") || s.includes("cyber")) return "futuristic city";
        if (s.includes("fantasy")) return "fantasy kingdom";
        if (s.includes("space")) return "space station";
      }
      return "auto";
    }),
  mainCharacter: z
    .unknown()
    .transform((v) => {
      if (v && typeof v === "object") {
        const obj = v as Record<string, unknown>;
        const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 100) : "";
        const description = typeof obj.description === "string" ? obj.description.trim().slice(0, 300) : "";
        const mode = obj.mode === "custom" || (name && name.length > 0) ? "custom" : "auto";
        return {
          mode: mode as "auto" | "custom",
          name: name || undefined,
          description: description || undefined,
        };
      }
      if (typeof v === "string" && v.trim().length > 0 && v.trim().toLowerCase() !== "auto") {
        return {
          mode: "custom" as const,
          name: v.trim().slice(0, 100),
        };
      }
      return { mode: "auto" as const };
    }),
  narration: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s.includes("first")) return "first person";
        if (s.includes("third")) return "third person";
      }
      return "third person";
    }),
  intensity: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if ((STORY_INTENSITY_OPTIONS as readonly string[]).includes(s)) return s as StoryIntensityOption;
        if (s.includes("lean")) return "lean";
        if (s.includes("immers")) return "immersive";
      }
      return "balanced";
    }),
  depth: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if ((DEPTH_OPTIONS as readonly string[]).includes(s)) return s as DepthOption;
        if (s.includes("quick") || s.includes("short")) return "quick";
        if (s.includes("deep") || s.includes("long")) return "deep";
      }
      return "standard";
    }),
  learnerLevel: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if ((LEARNER_LEVEL_OPTIONS as readonly string[]).includes(s)) return s as LearnerLevelOption;
        if (s.includes("inter")) return "intermediate";
        if (s.includes("adv")) return "advanced";
      }
      return "beginner";
    }),
  language: z
    .unknown()
    .transform((v) => {
      if (typeof v === "string" && v.trim().length > 0) {
        return v.trim().slice(0, 50);
      }
      return "English";
    }),
  // Tracking feedback and reading time
  reductionFactor: z.number().min(0.2).max(1).default(1),
  readingTimeFeedback: z
    .array(
      z.object({
        chapterNumber: z.number(),
        estimatedMinutes: z.number(),
        actualSeconds: z.number(),
        tooLongClicked: z.boolean().default(false),
      }),
    )
    .default([]),
});

export type StorySettings = z.infer<typeof StorySettingsSchema>;

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  genre: "auto",
  tone: "auto",
  worldSetting: "auto",
  mainCharacter: { mode: "auto" },
  narration: "third person",
  intensity: "balanced",
  depth: "standard",
  learnerLevel: "beginner",
  language: "English",
  reductionFactor: 1,
  readingTimeFeedback: [],
};

/**
 * Safely parses any arbitrary JSON or object into a valid StorySettings object.
 * Missing, null, or invalid values will fall back cleanly to defaults or 'auto'.
 */
export function parseStorySettings(input: unknown): StorySettings {
  const result = StorySettingsSchema.safeParse(input ?? {});
  if (result.success) return result.data;
  return { ...DEFAULT_STORY_SETTINGS };
}

