import { z } from "zod";

/** Structured shapes the model must return. Lenient where models are sloppy. */

export const GENRES = [
  "action",
  "fantasy",
  "sci-fi",
  "mystery",
  "thriller",
  "slice-of-life",
  "historical",
  "adventure",
] as const;
export type Genre = (typeof GENRES)[number];

export function normalizeGenre(value: string): Genre {
  const v = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if ((GENRES as readonly string[]).includes(v)) return v as Genre;
  if (v.includes("sci")) return "sci-fi";
  if (v.includes("slice")) return "slice-of-life";
  if (v.includes("histor")) return "historical";
  return "adventure";
}

const genre = z.string().transform(normalizeGenre);
const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const optText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s ? s.trim().slice(0, max) : null));
const num = z.coerce.number().int();
const names = z.array(z.string()).default([]);

export const AnalysisSchema = z.object({
  title: text(160),
  summary: text(1500),
  recommended_genre: genre,
  estimated_chapters: num.min(1).max(12),
  concepts: z
    .array(
      z.object({
        name: text(120),
        explanation: text(800),
        objective: text(300),
        source_ref: optText(120),
      }),
    )
    .min(1)
    .max(30),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const StoryPlanSchema = z.object({
  title: text(160),
  synopsis: text(1200),
  genre,
  art_direction: text(600),
  characters: z
    .array(
      z.object({
        name: text(60),
        role: text(120),
        age_range: optText(40),
        appearance: text(500),
        hair: text(200),
        eyes: text(120),
        clothing: text(300),
        personality: text(300),
        relationships: optText(300),
        visual_tag: text(300),
      }),
    )
    .min(1)
    .max(6),
  chapters: z
    .array(
      z.object({
        number: num.min(1),
        title: text(160),
        summary: text(800),
        objectives: z.array(z.string()).default([]),
        concept_names: names,
      }),
    )
    .min(1)
    .max(12),
});
export type StoryPlan = z.infer<typeof StoryPlanSchema>;

export const PALETTES = ["violet", "cyan", "gold", "crimson", "emerald", "mono"] as const;
export const EFFECTS = ["particles", "speedlines", "rain", "glow", "none"] as const;

export const StoryboardSchema = z.object({
  panels: z
    .array(
      z.object({
        scene: text(700),
        camera: text(200).default(""),
        mood: text(120).default(""),
        palette: z
          .string()
          .transform((s) => ((PALETTES as readonly string[]).includes(s) ? s : "violet")),
        effect: z
          .string()
          .transform((s) => ((EFFECTS as readonly string[]).includes(s) ? s : "none")),
        characters: names,
        narration: optText(400),
        dialogue: z
          .array(
            z.object({
              character: text(60),
              text: text(220),
              type: z
                .string()
                .default("speech")
                .transform((s) => (["speech", "thought", "shout"].includes(s) ? s : "speech")),
            }),
          )
          .default([]),
        concept_names: names,
        source_ref: optText(120),
        bubble_hint: z
          .string()
          .default("top")
          .transform((s) => (["top", "top-left", "top-right", "bottom"].includes(s) ? s : "top")),
      }),
    )
    .min(3)
    .max(12),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const QuizSchema = z.object({
  questions: z
    .array(
      z.object({
        prompt: text(400),
        options: z.array(z.string().transform((s) => s.trim().slice(0, 200))).min(2).max(5),
        correct_index: num.min(0),
        explanation: text(500),
        concept_name: optText(120),
      }),
    )
    .min(2)
    .max(8)
    .refine((qs) => qs.every((q) => q.correct_index < q.options.length), {
      message: "correct_index out of range",
    }),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const ExplanationSchema = z.object({
  what_is_happening: text(500),
  concept: text(200),
  simple_explanation: text(900),
  related_concept: optText(200),
});
