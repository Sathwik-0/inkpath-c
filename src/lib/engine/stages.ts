import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider } from "@/lib/ai";
import { NEW_STATE, applyReview, levelFor, type MemoryState } from "@/lib/learning/scheduler";
import { planChapter, type ChapterBrief } from "@/lib/learning/planner";
import { sourceBlock } from "./prompts";
import { parseStorySettings, type StorySettings } from "./settings";
import { calculateTimeBudget, type TimeBudget } from "./budget";
import {
  validateConceptCitations,
  parseStoredCitations,
  type SourceMapping,
  type ConceptCitation,
} from "./citations";
import {
  BibleSchema,
  ChapterSchema,
  ConceptGraphSchema,
  RecallSchema,
  VerifySchema,
  type Bible,
  type Chapter,
  type Recall,
} from "./novel-schemas";
import {
  BIBLE_SYSTEM,
  BANNED_STOCK_PHRASES,
  CHAPTER_SYSTEM,
  CONCEPT_GRAPH_SHAPE,
  CONCEPT_GRAPH_SYSTEM,
  RECALL_SHAPE,
  RECALL_SYSTEM,
  TRIM_SYSTEM,
  VERIFY_SHAPE,
  VERIFY_SYSTEM,
  bibleShape,
  buildChapterPrompt,
} from "./novel-prompts";

type Admin = SupabaseClient;
const norm = (s: string) => s.trim().toLowerCase();
const MAX_SOURCE_CHARS = 60_000;

function fail(message: string): never {
  throw new Error(message);
}

export function countWords(ch: Chapter): number {
  return ch.scenes.reduce((acc, s) => acc + s.text.trim().split(/\s+/).filter(Boolean).length, 0);
}

export function sanitizeStoryProse(raw: string): string {
  let s = raw.replace(/```[\s\S]*?```/g, "").replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  // Break into paragraphs and ensure dialogue starts on its own paragraph
  const paragraphs = s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.join("\n\n");
}

function findStockPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of BANNED_STOCK_PHRASES) {
    if (lower.includes(phrase)) {
      found.push(phrase);
    }
  }
  return found;
}

/* ------------------------------------------------------------ 1. analyze */

export async function stageAnalyze(admin: Admin, provider: AIProvider, userId: string, projectId: string) {
  const { data: project } = await admin.from("projects").select("*").eq("id", projectId).eq("user_id", userId).single();
  if (!project) fail("Project not found");

  const settings: StorySettings = parseStorySettings(project.settings);

  const { data: chunks } = await admin
    .from("extracted_content")
    .select("content,location")
    .eq("project_id", projectId)
    .order("chunk_index");
  let source = (chunks ?? []).map((c) => c.content).join("\n\n").slice(0, MAX_SOURCE_CHARS);
  const isTopicOnly = !source;
  if (isTopicOnly) source = `Topic: ${project.subject ?? project.title}`;

  const { data: yt } = await admin
    .from("source_documents")
    .select("url")
    .eq("project_id", projectId)
    .eq("kind", "youtube")
    .not("url", "is", null)
    .limit(1);
  const youtubeUrl = yt?.[0]?.url as string | undefined;
  if (youtubeUrl && isTopicOnly && provider.name !== "gemini")
    fail("YouTube links need a Google Gemini key. Paste the transcript as text, or connect Gemini.");
  if (youtubeUrl && isTopicOnly) source = "Learn from the attached YouTube video.";

  const settingsGuidance = [
    settings.genre !== "auto" ? `Preferred genre: ${settings.genre}.` : "",
    settings.learnerLevel ? `Learner level: ${settings.learnerLevel}.` : "",
    settings.depth ? `Depth: ${settings.depth}.` : "",
    settings.language ? `Language: ${settings.language}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const graph = await provider.generateJson({
    system: CONCEPT_GRAPH_SYSTEM,
    attachments: youtubeUrl && isTopicOnly ? [{ kind: "youtube", url: youtubeUrl }] : undefined,
    prompt: `${settingsGuidance ? `User Preferences: ${settingsGuidance}\n\n` : ""}${isTopicOnly && !youtubeUrl ? source : sourceBlock(source)}\n\n${CONCEPT_GRAPH_SHAPE}`,
    parse: (raw) => ConceptGraphSchema.parse(raw),
    maxOutputTokens: 8000,
    temperature: 0.3,
  });

  // Calculate strict time budget
  const wordCount = isTopicOnly ? undefined : source.split(/\s+/).filter(Boolean).length;
  const budget: TimeBudget = calculateTimeBudget({
    sourceKind: isTopicOnly ? "topic" : "text",
    sourceWordCount: wordCount,
    concepts: graph.concepts.map((c, i) => ({
      name: c.name,
      complexity: c.complexity,
      importance: c.importance ?? i + 1,
    })),
    depth: settings.depth,
    learnerLevel: settings.learnerLevel,
    reductionFactor: settings.reductionFactor,
  });

  // Filter to active concepts that fit within the 12-chapter budget
  const activeNameSet = new Set(budget.activeConcepts.map((c) => norm(c.name)));
  const conceptsToInsert = graph.concepts.filter((c) => activeNameSet.has(norm(c.name)));

  // Validate citations in code (Part 2)
  const rawSources: SourceMapping[] = (project.settings as any)?.sources ?? [
    {
      sourceId: "S1",
      title: project.title ?? "Source document",
      type: isTopicOnly ? "topic" : "text",
      urlOrFilename: isTopicOnly ? "General Knowledge" : "Source Document",
    },
  ];

  const conceptCitations: Record<string, any> = {};
  for (const c of conceptsToInsert) {
    const validated = validateConceptCitations(
      (c as any).citations,
      chunks ?? [],
      rawSources,
      isTopicOnly,
    );
    conceptCitations[c.name] = validated;
  }

  // Re-running replaces previous graph
  await admin.from("concepts").delete().eq("project_id", projectId);
  const { data: inserted, error } = await admin
    .from("concepts")
    .insert(
      conceptsToInsert.map((c, i) => {
        const citationData = conceptCitations[c.name] ?? {
          citations: [],
          isUnsourced: true,
          statusLabel: "unsourced",
        };
        return {
          user_id: userId,
          project_id: projectId,
          name: c.name,
          explanation: c.explanation,
          objective: c.objective,
          kind: c.kind,
          misconceptions: c.misconceptions,
          source_ref: JSON.stringify(citationData),
          position: i,
        };
      }),
    )
    .select("id,name");
  if (error || !inserted) fail("Could not save concepts");

  const idByName = new Map(inserted.map((c) => [norm(c.name), c.id as string]));
  const edges: { user_id: string; project_id: string; from_concept: string; to_concept: string }[] = [];
  for (const c of conceptsToInsert) {
    const to = idByName.get(norm(c.name));
    for (const p of c.prerequisites) {
      const from = idByName.get(norm(p));
      if (from && to && from !== to) edges.push({ user_id: userId, project_id: projectId, from_concept: from, to_concept: to });
    }
  }
  if (edges.length) await admin.from("concept_edges").insert(edges);

  const recommendedGenre = settings.genre !== "auto" ? settings.genre : graph.recommended_genre;

  const updatedSettings = {
    ...settings,
    sources: rawSources,
    conceptCitations,
    budget,
  };

  await admin
    .from("projects")
    .update({
      title: project.title || graph.title,
      genre: recommendedGenre,
      synopsis: graph.summary,
      estimated_chapters: budget.chapterCount,
      settings: updatedSettings,
      status: "analyzed",
    })
    .eq("id", projectId);

  return {
    concepts: inserted.length,
    chapters: budget.chapterCount,
    genre: recommendedGenre,
    budget,
  };
}

/* -------------------------------------------------------------- 2. bible */

export async function stageBible(admin: Admin, provider: AIProvider, userId: string, projectId: string) {
  const { data: project } = await admin.from("projects").select("*").eq("id", projectId).eq("user_id", userId).single();
  if (!project) fail("Project not found");
  const { data: concepts } = await admin
    .from("concepts")
    .select("id,name,explanation,misconceptions")
    .eq("project_id", projectId)
    .order("position");
  if (!concepts?.length) fail("Analyze the material first");

  const settings: StorySettings = parseStorySettings(project.settings);
  const genre = settings.genre !== "auto" ? settings.genre : project.genre ?? "adventure";
  const chapters = project.estimated_chapters ?? 3;

  const bible = await provider.generateJson({
    system: BIBLE_SYSTEM,
    prompt: `CONCEPTS TO TEACH (in dependency order)\n${concepts
      .map((c) => `- ${c.name}: ${c.explanation}`)
      .join("\n")}\n\n${bibleShape(genre, chapters, settings)}`,
    parse: (raw) => BibleSchema.parse(raw),
    maxOutputTokens: 8000,
    temperature: 0.9,
  });

  // If user selected Auto for setting fields, record the chosen values into settings so future chapters stay consistent
  const resolvedSettings = {
    ...settings,
    genre: settings.genre === "auto" ? bible.genre : settings.genre,
  };

  await admin.from("story_bibles").upsert({
    project_id: projectId,
    user_id: userId,
    bible,
    voice: bible.voice,
    rolling_summary: "",
  });

  const idByName = new Map(concepts.map((c) => [norm(c.name), c.id as string]));
  for (const r of bible.rules) {
    const id = idByName.get(norm(r.concept_name));
    if (id) await admin.from("concepts").update({ world_rule: r.rule }).eq("id", id);
  }

  await admin.from("chapters").delete().eq("project_id", projectId);
  await admin.from("chapters").insert(
    bible.chapter_plan.map((c) => ({
      user_id: userId,
      project_id: projectId,
      number: c.number,
      title: c.title,
      summary: c.beat,
      format: "novel",
      status: "outline",
    })),
  );

  await admin
    .from("projects")
    .update({
      title: bible.title,
      synopsis: bible.logline,
      settings: resolvedSettings,
      status: "previewed",
    })
    .eq("id", projectId);

  return { title: bible.title, chapters: bible.chapter_plan.length };
}

/* ------------------------------------------------------------ 3. chapter */

export function validateRecallQuestions(
  recall: Recall,
  chapterProse: string,
  taughtConceptNames: string[],
  futureConceptNames: string[],
): { valid: boolean; reason?: string } {
  const lowerProse = chapterProse.toLowerCase();
  const taughtSet = new Set(taughtConceptNames.map(norm));
  const futureSet = new Set(futureConceptNames.map(norm));

  for (const q of recall.questions) {
    // (a) Must test a concept actually taught in this chapter
    if (!taughtSet.has(norm(q.concept_name))) {
      return { valid: false, reason: `Question tests concept "${q.concept_name}" which is not in this chapter.` };
    }

    // (b) & (c) Evidence check: Must have evidence
    if (!q.evidence || q.evidence.trim().length < 5) {
      return { valid: false, reason: `Question for "${q.concept_name}" has no evidence from the chapter.` };
    }

    // (d) Must not reveal future concept names
    for (const fc of futureSet) {
      if (fc.length > 2) {
        if (q.prompt.toLowerCase().includes(fc) || q.options.some((o) => o.toLowerCase().includes(fc))) {
          return { valid: false, reason: `Question reveals future concept "${fc}".` };
        }
      }
    }
  }

  return { valid: true };
}

export async function stageChapter(
  admin: Admin,
  provider: AIProvider,
  userId: string,
  projectId: string,
  chapterNumber: number,
  now = new Date(),
) {
  const [
    { data: project },
    { data: bibleRow },
    { data: concepts },
    { data: edges },
    { data: learner },
    { data: threads },
    { data: cards },
    { data: chapters },
  ] = await Promise.all([
    admin.from("projects").select("settings").eq("id", projectId).single(),
    admin.from("story_bibles").select("bible,rolling_summary").eq("project_id", projectId).eq("user_id", userId).single(),
    admin.from("concepts").select("id,name,explanation,misconceptions,world_rule,position,source_ref").eq("project_id", projectId).order("position"),
    admin.from("concept_edges").select("from_concept,to_concept").eq("project_id", projectId),
    admin.from("learner_concepts").select("*").eq("project_id", projectId).eq("user_id", userId),
    admin.from("story_threads").select("*").eq("project_id", projectId).eq("status", "open"),
    admin.from("craft_cards").select("slug,name,how_to,avoid"),
    admin.from("chapters").select("id,number").eq("project_id", projectId).eq("user_id", userId),
  ]);

  if (!bibleRow || !concepts || !chapters) fail("Story is not ready: create the story bible first");
  const chapterRow = chapters.find((c) => c.number === chapterNumber);
  if (!chapterRow) fail("Chapter not found");

  const settings: StorySettings = parseStorySettings(project?.settings);

  // Time budget calculation for target words
  const budget: TimeBudget = calculateTimeBudget({
    sourceKind: "topic",
    concepts: concepts.map((c) => ({ name: c.name, complexity: 2 })),
    depth: settings.depth,
    learnerLevel: settings.learnerLevel,
    reductionFactor: settings.reductionFactor,
  });

  const targetWords = budget.wordsPerChapter || 800;

  const memory: Record<string, MemoryState> = {};
  for (const l of learner ?? []) {
    memory[l.concept_id] = {
      stabilityDays: Number(l.stability_days) || 0,
      ease: Number(l.ease) || 2.3,
      lapses: l.lapses ?? 0,
      reps: l.reps ?? 0,
      lastSeenAt: l.last_seen_at ? new Date(l.last_seen_at) : null,
      nextReviewAt: l.next_review_at ? new Date(l.next_review_at) : null,
    };
  }

  const brief: ChapterBrief = planChapter({
    chapterNumber,
    totalChapters: chapters.length,
    concepts: concepts.map((c) => ({ id: c.id, name: c.name, position: c.position, misconceptions: c.misconceptions ?? [] })),
    edges: (edges ?? []).map((e) => ({ from: e.from_concept, to: e.to_concept })),
    memory,
    openThreads: (threads ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      conceptId: t.concept_id,
      plantedIn: t.planted_in,
      dueBy: t.due_by,
    })),
    now,
  });

  const conceptDetails = Object.fromEntries(
    concepts.map((c) => {
      const citations = parseStoredCitations(c.source_ref);
      return [
        c.name,
        {
          explanation: c.explanation ?? "",
          world_rule: c.world_rule,
          misconceptions: c.misconceptions ?? [],
          citations,
        },
      ];
    }),
  );

  const basePrompt = {
    bible: bibleRow.bible as Bible,
    rollingSummary: bibleRow.rolling_summary as string,
    brief,
    craftCards: cards ?? [],
    conceptDetails,
    targetWords,
    settings,
  };
  const required = brief.newConcepts.map((c) => c.name);

  const draft = (fix?: string | null) =>
    provider.generateJson({
      system: CHAPTER_SYSTEM,
      prompt: buildChapterPrompt({ ...basePrompt, fixInstructions: fix }),
      parse: (raw) => ChapterSchema.parse(raw),
      maxOutputTokens: 8000,
      temperature: 0.85,
    });

  const verify = (ch: Chapter) => {
    const fullText = ch.scenes.map((s) => s.text).join("\n\n");
    const stockPhrases = findStockPhrases(fullText);
    const hasInTextCitations = /\[(?:S?\d+|p(?:age)?\.?\s*\d+)\]/i.test(fullText);

    return provider.generateJson({
      system: VERIFY_SYSTEM,
      prompt: `CONCEPT DEFINITIONS AND QUOTED SOURCE TEXT\n${[...brief.newConcepts, ...brief.reviewConcepts]
        .map((c) => {
          const d = conceptDetails[c.name];
          const quotes = (d?.citations ?? []).map((ci: any) => `"${ci.quote}" (${ci.location})`).join("; ");
          return `- ${c.name}: ${d?.explanation ?? ""}${quotes ? ` [Source: ${quotes}]` : ""}`;
        })
        .join("\n")}\n\nNEW CONCEPTS THAT MUST BE ACTED ON: ${required.join(", ") || "none"}\n\nSTORY SO FAR (FOR CONTINUITY)\n${
        bibleRow.rolling_summary || "Chapter 1"
      }\n\nCHAPTER PROSE\n${JSON.stringify(ch)}\n\n${
        stockPhrases.length > 0 ? `BANNED PHRASES FOUND: ${stockPhrases.join(", ")}\n\n` : ""
      }${hasInTextCitations ? "FOUND IN-TEXT CITATIONS IN PROSE (story prose must not contain bracketed citation markers like [1] or [S1]).\n\n" : ""}${VERIFY_SHAPE}`,
      parse: (raw) => {
        const v = VerifySchema.parse(raw);
        if (stockPhrases.length > 0) {
          v.problems.push({
            concept_name: null,
            issue: `Contains banned stock phrases: ${stockPhrases.join(", ")}`,
          });
        }
        if (hasInTextCitations || v.no_in_text_citations === false) {
          v.problems.push({
            concept_name: null,
            issue: `Contains in-text citation markers in story prose. Prose must remain clean.`,
          });
        }
        if (v.fact_boundaries_clean === false && v.unsupported_facts?.length) {
          v.problems.push({
            concept_name: null,
            issue: `Contains technical facts going beyond concept definitions: ${v.unsupported_facts.join(", ")}`,
          });
        }
        return v;
      },
      maxOutputTokens: 2000,
      temperature: 0,
    });
  };

  let chapter = await draft();

  // Part C.3: Format sanitization
  chapter.scenes = chapter.scenes.map((s) => ({
    ...s,
    text: sanitizeStoryProse(s.text),
    teaches: s.teaches && s.teaches.length > 0 ? s.teaches : s.concepts_applied || [],
  }));

  // Part B.9: Trim pass if over 15% above target
  let wordCount = countWords(chapter);
  if (wordCount > targetWords * 1.15) {
    try {
      const trimmed = await provider.generateJson({
        system: TRIM_SYSTEM,
        prompt: `TARGET WORDS: ${targetWords}\nCURRENT WORDS: ${wordCount}\n\nCHAPTER TO TRIM:\n${JSON.stringify(chapter)}\n\n${CHAPTER_SYSTEM}`,
        parse: (raw) => ChapterSchema.parse(raw),
        maxOutputTokens: 8000,
        temperature: 0.3,
      });
      chapter = trimmed;
      chapter.scenes = chapter.scenes.map((s) => ({
        ...s,
        text: sanitizeStoryProse(s.text),
        teaches: s.teaches && s.teaches.length > 0 ? s.teaches : s.concepts_applied || [],
      }));
    } catch {
      // Keep chapter if trim pass fails parse
    }
  }

  // Verifier check (Accuracy, Concept Acted On, Continuity, Fact Boundaries, Stock phrases)
  let check = await verify(chapter);
  let verified =
    check.accurate &&
    check.every_concept_acted_on &&
    (check.continuity_clean ?? true) &&
    (check.fact_boundaries_clean ?? true) &&
    (check.no_in_text_citations ?? true) &&
    check.problems.length === 0;

  if (!verified) {
    // One revision pass with specific fix instructions (Part C.5)
    const fixNotes = check.fix_instructions || check.problems.map((p) => p.issue).join(" | ");
    const revised = await draft(fixNotes);
    revised.scenes = revised.scenes.map((s) => ({
      ...s,
      text: sanitizeStoryProse(s.text),
    }));

    // Check trimmed on revision as well
    if (countWords(revised) > targetWords * 1.15) {
      try {
        const trimmed = await provider.generateJson({
          system: TRIM_SYSTEM,
          prompt: `TARGET WORDS: ${targetWords}\n\nCHAPTER TO TRIM:\n${JSON.stringify(revised)}`,
          parse: (raw) => ChapterSchema.parse(raw),
          maxOutputTokens: 8000,
          temperature: 0.3,
        });
        revised.scenes = trimmed.scenes.map((s) => ({
          ...s,
          text: sanitizeStoryProse(s.text),
        }));
      } catch {}
    }

    const recheck = await verify(revised);
    chapter = revised;
    check = recheck;
    verified = recheck.accurate && recheck.every_concept_acted_on && (recheck.continuity_clean ?? true) && recheck.problems.length === 0;
  }

  // Persist the chapter, story memory and learner state
  await admin
    .from("chapters")
    .update({
      title: chapter.title,
      summary: chapter.summary,
      prose: { scenes: chapter.scenes },
      hook: brief.isFinal ? null : chapter.hook,
      brief,
      verified,
      verify_notes: verified ? null : check.problems.map((p) => p.issue).join(" | ").slice(0, 1000),
      status: "ready",
    })
    .eq("id", chapterRow.id);

  const idByName = new Map(concepts.map((c) => [norm(c.name), c.id as string]));
  if (chapter.new_threads.length) {
    await admin.from("story_threads").insert(
      chapter.new_threads.map((t) => ({
        user_id: userId,
        project_id: projectId,
        label: t.label,
        concept_id: t.concept_name ? idByName.get(norm(t.concept_name)) ?? null : null,
        planted_in: chapterNumber,
        due_by: t.due_by ?? Math.min(chapters.length, chapterNumber + 2),
      })),
    );
  }
  const paid = new Set(chapter.paid_off_threads.map(norm));
  for (const t of threads ?? []) {
    if (paid.has(norm(t.label)) || brief.payoffThreads.some((p) => p.id === t.id)) {
      await admin.from("story_threads").update({ status: "paid_off", paid_off_in: chapterNumber }).eq("id", t.id);
    }
  }
  await admin
    .from("story_bibles")
    .update({ rolling_summary: `${bibleRow.rolling_summary}\nCh ${chapterNumber}: ${chapter.summary}`.trim() })
    .eq("project_id", projectId);

  const fresh = brief.newConcepts.filter((c) => !memory[c.id]);
  if (fresh.length) {
    await admin.from("learner_concepts").upsert(
      fresh.map((c) => ({
        user_id: userId,
        project_id: projectId,
        concept_id: c.id,
        introduced_in: chapterNumber,
      })),
      { ignoreDuplicates: true },
    );
  }

  // Part D: Recall questions generated from finished chapter text
  const chapterFullText = chapter.scenes.map((s) => s.text).join("\n\n");
  const taughtConcepts = [...brief.newConcepts, ...brief.reviewConcepts];
  const taughtNames = taughtConcepts.map((c) => c.name);

  // Future concepts that should NOT be revealed
  const metConceptIds = new Set([...Object.keys(memory), ...brief.newConcepts.map((c) => c.id)]);
  const futureConcepts = concepts.filter((c) => !metConceptIds.has(c.id)).map((c) => c.name);

  const recallPrompt = (notes?: string) => `FINISHED CHAPTER TEXT\n${chapterFullText}\n\nCONCEPTS IN THIS CHAPTER\n${taughtConcepts
    .map(
      (c) =>
        `- ${c.name}: ${conceptDetails[c.name]?.explanation} (common misconceptions: ${(conceptDetails[c.name]?.misconceptions ?? []).join("; ") || "none"})`,
    )
    .join("\n")}\n\nFUTURE CONCEPTS (DO NOT REVEAL OR MENTION THESE)\n${
    futureConcepts.join(", ") || "none"
  }\n\n${notes ? `REVISION NOTES:\n${notes}\n\n` : ""}${RECALL_SHAPE}`;

  let recall = await provider.generateJson({
    system: RECALL_SYSTEM,
    prompt: recallPrompt(),
    parse: (raw) => RecallSchema.parse(raw),
    maxOutputTokens: 4000,
    temperature: 0.3,
  });

  // Validate questions have evidence and only test taught concepts (Part D.3)
  const validation = validateRecallQuestions(recall, chapterFullText, taughtNames, futureConcepts);
  if (!validation.valid) {
    // Regenerate once with feedback
    recall = await provider.generateJson({
      system: RECALL_SYSTEM,
      prompt: recallPrompt(`PREVIOUS QUESTIONS REJECTED: ${validation.reason}. Every question MUST include valid evidence directly from the chapter text and test only concepts in this chapter.`),
      parse: (raw) => RecallSchema.parse(raw),
      maxOutputTokens: 4000,
      temperature: 0.2,
    });
  }

  // Attach concept source quote and chapter evidence to questions
  const questionsWithSources = recall.questions.map((q) => {
    const cDetails = conceptDetails[q.concept_name];
    const sourceQuote = q.source_quote || cDetails?.citations?.[0]?.quote || undefined;
    return {
      ...q,
      source_quote: sourceQuote,
    };
  });

  await admin.from("quizzes").upsert(
    { user_id: userId, chapter_id: chapterRow.id, questions: questionsWithSources },
    { onConflict: "chapter_id" },
  );

  return { chapterId: chapterRow.id, verified, newConcepts: required, reviews: brief.reviewConcepts.map((c) => c.name) };
}

/* ------------------------------------------------------------- 4. recall */

export interface RecallResult {
  score: number;
  total: number;
  concepts: { name: string; correct: boolean; level: number; nextReviewAt: string | null }[];
  review: { correct: boolean; correctIndex: number; explanation: string; evidence?: string; sourceQuote?: string }[];
}

/** Grades answers on the server so the correct index is never trusted from the client. */
export async function recordRecall(
  admin: Admin,
  userId: string,
  chapterId: string,
  answers: number[],
  now = new Date(),
): Promise<RecallResult> {
  const { data: quiz } = await admin
    .from("quizzes")
    .select("id,questions,chapter_id")
    .eq("chapter_id", chapterId)
    .eq("user_id", userId)
    .single();
  const { data: chapter } = await admin.from("chapters").select("project_id").eq("id", chapterId).eq("user_id", userId).single();
  if (!quiz || !chapter) fail("Quiz not found");

  const questions = quiz.questions as {
    correct_index: number;
    explanation?: string;
    concept_name?: string;
    evidence?: string;
  }[];
  const { data: concepts } = await admin.from("concepts").select("id,name").eq("project_id", chapter.project_id);
  const idByName = new Map((concepts ?? []).map((c) => [norm(c.name), c.id as string]));

  const perConcept = new Map<string, { name: string; correct: boolean }>();
  let score = 0;
  questions.forEach((q, i) => {
    const ok = answers[i] === q.correct_index;
    if (ok) score++;
    const id = q.concept_name ? idByName.get(norm(q.concept_name)) : undefined;
    if (id) {
      const prev = perConcept.get(id);
      perConcept.set(id, { name: q.concept_name!, correct: (prev?.correct ?? true) && ok });
    }
  });

  await admin.from("quiz_attempts").insert({
    user_id: userId,
    quiz_id: quiz.id,
    chapter_id: chapterId,
    answers,
    score,
    total: questions.length,
  });

  const ids = [...perConcept.keys()];
  const { data: rows } = ids.length
    ? await admin.from("learner_concepts").select("*").eq("user_id", userId).in("concept_id", ids)
    : { data: [] as never[] };
  const out: RecallResult["concepts"] = [];
  for (const [id, r] of perConcept) {
    const row = rows?.find((x) => x.concept_id === id);
    const state: MemoryState = row
      ? {
          stabilityDays: Number(row.stability_days) || 0,
          ease: Number(row.ease) || 2.3,
          lapses: row.lapses ?? 0,
          reps: row.reps ?? 0,
          lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
          nextReviewAt: row.next_review_at ? new Date(row.next_review_at) : null,
        }
      : NEW_STATE;
    const next = applyReview(state, r.correct, now);
    const level = levelFor(next.stabilityDays);
    await admin.from("learner_concepts").upsert({
      user_id: userId,
      concept_id: id,
      project_id: chapter.project_id,
      level,
      stability_days: next.stabilityDays,
      ease: next.ease,
      lapses: next.lapses,
      reps: next.reps,
      last_seen_at: now.toISOString(),
      next_review_at: next.nextReviewAt?.toISOString() ?? null,
      introduced_in: row?.introduced_in ?? null,
      updated_at: now.toISOString(),
    });
    await admin.from("review_events").insert({
      user_id: userId,
      project_id: chapter.project_id,
      concept_id: id,
      chapter_id: chapterId,
      correct: r.correct,
      kind: "chapter_end",
    });
    out.push({ name: r.name, correct: r.correct, level, nextReviewAt: next.nextReviewAt?.toISOString() ?? null });
  }
  const review = questions.map((q, i) => ({
    correct: answers[i] === q.correct_index,
    correctIndex: q.correct_index,
    explanation: q.explanation ?? "",
    evidence: (q as any).evidence ?? "",
    sourceQuote: (q as any).source_quote ?? "",
  }));
  return { score, total: questions.length, concepts: out, review };
}
