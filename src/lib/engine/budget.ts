/**
 * Time budget calculator for Inkpath.
 *
 * PRODUCT RULE:
 * Inkpath must never take longer than studying the same material directly.
 * Time is a hard budget, never a target to grow into.
 */

export interface BudgetConcept {
  id?: string;
  name: string;
  complexity?: 1 | 2 | 3; // 1 = simple (3m), 2 = moderate (6m), 3 = hard (10m)
  importance?: number; // lower number or higher rank = more important
}

export interface BudgetInput {
  sourceKind: "topic" | "text" | "pdf" | "docx" | "txt" | "youtube";
  sourceWordCount?: number;
  videoDurationMinutes?: number;
  concepts?: BudgetConcept[];
  depth?: "quick" | "standard" | "deep";
  learnerLevel?: "beginner" | "intermediate" | "advanced";
  reductionFactor?: number; // e.g. 0.8 if user clicked "Too long?"
  studyMinutesOverride?: number; // allows explicit direct study time (e.g. for testing)
}

export interface ChapterAllocation {
  chapterNumber: number;
  targetWords: number;
  questionCount: number;
  conceptNames: string[];
  isHardChapter: boolean;
}

export interface TimeBudget {
  studyMinutes: number;
  depthFactor: number;
  sessionBudget: number;
  totalSessionMinutes: number;
  totalReadingMinutes: number;
  totalRecallMinutes: number;
  chapterCount: number;
  wordsPerChapter: number;
  isMicroChapter: boolean;
  chapters: ChapterAllocation[];
  activeConcepts: BudgetConcept[];
  omittedConcepts: { name: string; reason: string }[];
  comparisonText: string;
}

const COMPLEXITY_MINUTES: Record<1 | 2 | 3, number> = {
  1: 3,
  2: 6,
  3: 10,
};

const DEPTH_FACTORS: Record<"quick" | "standard" | "deep", number> = {
  quick: 0.5,
  standard: 0.8,
  deep: 1.0,
};

/**
 * Calculates direct study time in minutes.
 */
export function calculateDirectStudyMinutes(input: {
  sourceKind: BudgetInput["sourceKind"];
  sourceWordCount?: number;
  videoDurationMinutes?: number;
  concepts?: BudgetConcept[];
  studyMinutesOverride?: number;
}): number {
  if (typeof input.studyMinutesOverride === "number" && input.studyMinutesOverride > 0) {
    return Math.round(input.studyMinutesOverride * 10) / 10;
  }

  if (input.sourceKind === "youtube" && typeof input.videoDurationMinutes === "number" && input.videoDurationMinutes > 0) {
    return Math.round(input.videoDurationMinutes * 10) / 10;
  }

  if (
    (input.sourceKind === "pdf" ||
      input.sourceKind === "docx" ||
      input.sourceKind === "txt" ||
      input.sourceKind === "text") &&
    typeof input.sourceWordCount === "number" &&
    input.sourceWordCount > 0
  ) {
    // source words / 200 * 1.3
    const direct = (input.sourceWordCount / 200) * 1.3;
    return Math.max(1, Math.round(direct * 10) / 10);
  }

  // Topic only: sum over concepts of 3 min (simple), 6 min (moderate), 10 min (hard)
  const concepts = input.concepts && input.concepts.length > 0 ? input.concepts : [];
  if (concepts.length > 0) {
    const sum = concepts.reduce((acc, c) => {
      const comp = (c.complexity ?? 2) as 1 | 2 | 3;
      return acc + (COMPLEXITY_MINUTES[comp] ?? 6);
    }, 0);
    return Math.max(1, Math.round(sum * 10) / 10);
  }

  // Default fallback if no concepts or word count yet:
  return 14;
}

/**
 * Pure function that calculates the strict time budget and chapter allocations.
 */
export function calculateTimeBudget(input: BudgetInput): TimeBudget {
  const depth = input.depth ?? "standard";
  const depthFactor = DEPTH_FACTORS[depth] ?? 0.8;
  const userReduction = typeof input.reductionFactor === "number" && input.reductionFactor > 0 ? input.reductionFactor : 1;

  const studyMinutes = calculateDirectStudyMinutes({
    sourceKind: input.sourceKind,
    sourceWordCount: input.sourceWordCount,
    videoDurationMinutes: input.videoDurationMinutes,
    concepts: input.concepts,
    studyMinutesOverride: input.studyMinutesOverride,
  });

  // Session budget = study_minutes * factor (0.5 for quick, 0.8 for standard, 1.0 for deep)
  let sessionBudget = Math.round(studyMinutes * depthFactor * 10) / 10;

  // PRODUCT RULE: Inkpath must never exceed direct study time
  if (sessionBudget > studyMinutes) {
    sessionBudget = studyMinutes;
  }

  // Rule 6: If session budget is 4 minutes or less, produce 1 micro-chapter of at most 600 words with 2 questions.
  if (sessionBudget <= 4) {
    const questionCount = 2;
    const recallMinutes = questionCount * 0.5; // 1 min
    const maxReadingMinutes = Math.max(0.5, sessionBudget - recallMinutes);
    // 200 wpm
    let targetWords = Math.min(600, Math.max(200, Math.round(maxReadingMinutes * 200)));
    if (userReduction < 1) {
      targetWords = Math.max(200, Math.round(targetWords * userReduction));
    }
    const readingMinutes = Math.round((targetWords / 200) * 10) / 10;
    const totalSessionMinutes = Math.round((readingMinutes + recallMinutes) * 10) / 10;

    const concepts = input.concepts ?? [];
    return {
      studyMinutes,
      depthFactor,
      sessionBudget,
      totalSessionMinutes: Math.min(sessionBudget, totalSessionMinutes),
      totalReadingMinutes: readingMinutes,
      totalRecallMinutes: recallMinutes,
      chapterCount: 1,
      wordsPerChapter: targetWords,
      isMicroChapter: true,
      chapters: [
        {
          chapterNumber: 1,
          targetWords,
          questionCount,
          conceptNames: concepts.map((c) => c.name),
          isHardChapter: concepts.some((c) => c.complexity === 3),
        },
      ],
      activeConcepts: concepts,
      omittedConcepts: [],
      comparisonText: `Studying this directly: about ${formatMinutes(studyMinutes)}. Inkpath story plus recall: about ${formatMinutes(totalSessionMinutes)}.`,
    };
  }

  // Rule 5: Chapter count = max(1, round(session budget / 9)), capped at 12.
  const rawChapterCount = Math.max(1, Math.round(sessionBudget / 9));
  const chapterCount = Math.min(12, rawChapterCount);

  // Concept distribution and pruning (Rule 7 & Rule 8)
  const allConcepts = [...(input.concepts ?? [])];
  // Sort concepts by importance if provided, else keep order
  allConcepts.sort((a, b) => (a.importance ?? 0) - (b.importance ?? 0));

  // Max concepts that can fit in chapterCount chapters:
  // Hard concepts take ~1 per chapter, moderate ~2, simple ~3. Capping at 3 concepts per chapter on average.
  const maxTeachableConcepts = Math.min(30, chapterCount * 3);
  let activeConcepts = allConcepts;
  const omittedConcepts: { name: string; reason: string }[] = [];

  if (allConcepts.length > maxTeachableConcepts && chapterCount === 12) {
    activeConcepts = allConcepts.slice(0, maxTeachableConcepts);
    const omitted = allConcepts.slice(maxTeachableConcepts);
    for (const om of omitted) {
      omittedConcepts.push({
        name: om.name,
        reason: "Excluded to stay within the maximum 12-chapter time budget. Can be added as a sequel later.",
      });
    }
  }

  // Group concepts into chapters by complexity weight (Rule 8)
  // Complexity weights: 3 = hard (weight 3), 2 = moderate (weight 2), 1 = simple (weight 1)
  const chapters: ChapterAllocation[] = [];
  const conceptBuckets: BudgetConcept[][] = Array.from({ length: chapterCount }, () => []);

  if (activeConcepts.length > 0) {
    let currentChapter = 0;
    let currentWeight = 0;
    const targetWeightPerChapter = Math.max(
      2,
      Math.ceil(activeConcepts.reduce((acc, c) => acc + (c.complexity ?? 2), 0) / chapterCount),
    );

    for (const c of activeConcepts) {
      const w = c.complexity ?? 2;
      if (currentWeight + w > targetWeightPerChapter && currentChapter < chapterCount - 1) {
        currentChapter++;
        currentWeight = 0;
      }
      conceptBuckets[currentChapter].push(c);
      currentWeight += w;
    }
  }

  // Rule 3: Recall time = 0.5 minute per question.
  // Questions per chapter: 3, or 4 to 5 for a hard-concept chapter.
  let totalQuestions = 0;
  const chapterQuestions: number[] = [];
  const isHardFlags: boolean[] = [];

  for (let i = 0; i < chapterCount; i++) {
    const bucket = conceptBuckets[i];
    const isHard = bucket.some((c) => c.complexity === 3);
    const qCount = isHard ? 4 : 3;
    chapterQuestions.push(qCount);
    isHardFlags.push(isHard);
    totalQuestions += qCount;
  }

  const totalRecallMinutes = totalQuestions * 0.5;

  // Rule 4: Reading minutes = session budget minus total recall minutes.
  // Words available = reading minutes * 200.
  let readingMinutes = Math.max(chapterCount * 2, sessionBudget - totalRecallMinutes);
  let wordsAvailable = readingMinutes * 200;

  // Rule 5: Words per chapter = words available / chapter count, between 400 and 1800.
  let wordsPerChapter = Math.round(wordsAvailable / chapterCount);
  wordsPerChapter = Math.max(400, Math.min(1800, wordsPerChapter));

  // Apply user reduction factor if user clicked "Too long?" (Rule 12: reduce future target by 20%, min 400 words)
  if (userReduction < 1) {
    wordsPerChapter = Math.max(400, Math.round(wordsPerChapter * userReduction));
  }

  // Ensure total time does NOT exceed sessionBudget, and strictly never exceeds studyMinutes (PRODUCT RULE & Rule 10)
  let totalSessionMinutes = Math.round(((chapterCount * wordsPerChapter) / 200 + totalRecallMinutes) * 10) / 10;
  if (totalSessionMinutes > sessionBudget) {
    const maxReadingTotal = sessionBudget - totalRecallMinutes;
    if (maxReadingTotal > 0) {
      wordsPerChapter = Math.max(400, Math.min(wordsPerChapter, Math.floor((maxReadingTotal / chapterCount) * 200)));
      totalSessionMinutes = Math.round(((chapterCount * wordsPerChapter) / 200 + totalRecallMinutes) * 10) / 10;
    }
  }

  // Final sanity check: Total session minutes must never exceed direct study minutes
  if (totalSessionMinutes > studyMinutes) {
    const allowableReading = Math.max(0, studyMinutes - totalRecallMinutes);
    wordsPerChapter = Math.max(300, Math.floor((allowableReading / chapterCount) * 200));
    totalSessionMinutes = Math.round(((chapterCount * wordsPerChapter) / 200 + totalRecallMinutes) * 10) / 10;
  }

  for (let i = 0; i < chapterCount; i++) {
    chapters.push({
      chapterNumber: i + 1,
      targetWords: wordsPerChapter,
      questionCount: chapterQuestions[i],
      conceptNames: conceptBuckets[i].map((c) => c.name),
      isHardChapter: isHardFlags[i],
    });
  }

  const actualReadingMinutes = Math.round(((chapterCount * wordsPerChapter) / 200) * 10) / 10;

  return {
    studyMinutes,
    depthFactor,
    sessionBudget,
    totalSessionMinutes,
    totalReadingMinutes: actualReadingMinutes,
    totalRecallMinutes,
    chapterCount,
    wordsPerChapter,
    isMicroChapter: false,
    chapters,
    activeConcepts,
    omittedConcepts,
    comparisonText: `Studying this directly: about ${formatMinutes(studyMinutes)}. Inkpath story plus recall: about ${formatMinutes(totalSessionMinutes)}.`,
  };
}

function formatMinutes(m: number): string {
  const rounded = Math.round(m * 10) / 10;
  return `${rounded} min`;
}
