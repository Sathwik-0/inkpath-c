import { z } from "zod";
import { normalizeGenre } from "./schemas";

const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const optText = (max: number) =>
  z.string().nullish().transform((s) => (s ? s.trim().slice(0, max) : null));
const num = z.coerce.number().int();
const list = z.array(z.string()).default([]);

/** Step 1: source -> concept graph. */
export const ConceptGraphSchema = z.object({
  title: text(160),
  summary: text(1500),
  recommended_genre: z.string().transform(normalizeGenre),
  estimated_chapters: num.min(1).max(12),
  concepts: z
    .array(
      z.object({
        name: text(120),
        explanation: text(800),
        objective: text(300),
        kind: z
          .string()
          .default("idea")
          .transform((s) => (["idea", "fact", "procedure", "relationship"].includes(s) ? s : "idea")),
        complexity: z
          .coerce.number().int().min(1).max(3).default(2)
          .transform((v) => (v === 1 || v === 3 ? v : 2)),
        importance: z.coerce.number().int().min(1).max(100).default(50),
        misconceptions: list.transform((a) => a.slice(0, 3).map((s) => s.trim().slice(0, 200))),
        prerequisites: list, // names of other concepts in this list
        source_ref: optText(120),
        citations: z
          .array(
            z.object({
              source_id: z.string().default("S1"),
              location: z.string().default(""),
              quote: z.string().max(300).default(""),
            }),
          )
          .default([]),
      }),
    )
    .min(1)
    .max(30),
});
export type ConceptGraph = z.infer<typeof ConceptGraphSchema>;

/** Step 2: story bible, written once and reused by every chapter. */
export const BibleSchema = z.object({
  title: text(160),
  logline: text(400),
  genre: z.string().transform(normalizeGenre),
  voice: text(600), // narration style, POV, tense, tone
  world: text(1200),
  /** Every world rule embodies one concept; this is the memory palace. */
  rules: z
    .array(z.object({ concept_name: text(120), rule: text(400), visual_anchor: text(200) }))
    .min(1)
    .max(30),
  cast: z
    .array(
      z.object({
        name: text(60),
        role: text(120),
        want: text(240),
        flaw: text(240),
        speech: text(200),
      }),
    )
    .min(2)
    .max(6),
  central_question: text(300),
  ending: text(500),
  chapter_plan: z
    .array(z.object({ number: num.min(1), title: text(160), beat: text(400) }))
    .min(1)
    .max(12),
});
export type Bible = z.infer<typeof BibleSchema>;

/** Step 3: one chapter of prose. */
export const ChapterSchema = z.object({
  title: text(160),
  scenes: z
    .array(
      z.object({
        heading: text(120),
        text: text(4000),
        /** Concepts this scene carries and teaches. */
        teaches: list,
        /** Concepts the character must ACT on in this scene. */
        concepts_applied: list,
        /** How the concept changes what happens (not a restatement). */
        concept_action: optText(300),
      }),
    )
    .min(2)
    .max(8),
  hook: optText(300),
  summary: optText(600).transform((s) => s ?? ""), // appended to the rolling summary
  new_threads: z
    .array(z.object({ label: text(200), concept_name: optText(120), due_by: num.min(1).nullish() }))
    .default([]),
  paid_off_threads: list,
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const VerifySchema = z.object({
  accurate: z.boolean(),
  every_concept_acted_on: z.boolean(),
  continuity_clean: z.boolean().default(true),
  fact_boundaries_clean: z.boolean().default(true),
  no_in_text_citations: z.boolean().default(true),
  unsupported_facts: z.array(text(300)).default([]),
  problems: z.array(z.object({ concept_name: optText(120), issue: text(400) })).default([]),
  fix_instructions: optText(800),
});
export type Verification = z.infer<typeof VerifySchema>;

export const RecallSchema = z.object({
  questions: z
    .array(
      z.object({
        prompt: text(400),
        options: z.array(z.string().transform((s) => s.trim().slice(0, 200))).min(2).max(5),
        correct_index: num.min(0),
        explanation: text(500),
        concept_name: text(120),
        evidence: text(400).default(""),
        source_quote: optText(400),
      }),
    )
    .min(1)
    .max(8)
    .refine((qs) => qs.every((q) => q.correct_index < q.options.length), {
      message: "correct_index out of range",
    }),
});
export type Recall = z.infer<typeof RecallSchema>;
