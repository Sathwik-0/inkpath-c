import { describe, expect, it } from "vitest";
import { calculateTimeBudget, calculateDirectStudyMinutes } from "@/lib/engine/budget";

describe("Time Budget (Part B)", () => {
  it("a topic with study_minutes 14 at Standard gives a budget of 11.2 minutes and 1 chapter with about 1,800 words or fewer, with recall included", () => {
    const budget = calculateTimeBudget({
      sourceKind: "topic",
      studyMinutesOverride: 14,
      depth: "standard",
    });

    expect(budget.studyMinutes).toBe(14);
    expect(budget.sessionBudget).toBe(11.2);
    expect(budget.chapterCount).toBe(1);
    expect(budget.wordsPerChapter).toBeLessThanOrEqual(1800);
    expect(budget.wordsPerChapter).toBeGreaterThanOrEqual(400);
    expect(budget.totalSessionMinutes).toBeLessThanOrEqual(11.2);
    expect(budget.totalSessionMinutes).toBeLessThanOrEqual(budget.studyMinutes);
    expect(budget.totalRecallMinutes).toBeGreaterThan(0);
  });

  it("a topic with study_minutes 3 gives a single micro-chapter of at most 600 words", () => {
    const budget = calculateTimeBudget({
      sourceKind: "topic",
      studyMinutesOverride: 3,
      depth: "standard",
    });

    expect(budget.isMicroChapter).toBe(true);
    expect(budget.chapterCount).toBe(1);
    expect(budget.wordsPerChapter).toBeLessThanOrEqual(600);
    expect(budget.chapters[0].questionCount).toBe(2);
    expect(budget.totalSessionMinutes).toBeLessThanOrEqual(3);
  });

  it("a 60-page PDF at Standard never produces more than 12 chapters and never exceeds 0.8 x its study_minutes in total", () => {
    // 60 pages ~ 30,000 words
    const sourceWordCount = 30_000;
    const directStudy = calculateDirectStudyMinutes({
      sourceKind: "pdf",
      sourceWordCount,
    });
    expect(directStudy).toBe((30_000 / 200) * 1.3); // 195 minutes

    const budget = calculateTimeBudget({
      sourceKind: "pdf",
      sourceWordCount,
      depth: "standard",
    });

    expect(budget.chapterCount).toBeLessThanOrEqual(12);
    expect(budget.chapterCount).toBe(12);
    expect(budget.totalSessionMinutes).toBeLessThanOrEqual(0.8 * directStudy);
    expect(budget.totalSessionMinutes).toBeLessThanOrEqual(directStudy);
  });

  it("no input ever produces a total session time above its study_minutes", () => {
    const testCases: { sourceKind: any; words?: number; override?: number; depth: any }[] = [
      { sourceKind: "topic", override: 2, depth: "quick" },
      { sourceKind: "topic", override: 5, depth: "standard" },
      { sourceKind: "topic", override: 14, depth: "deep" },
      { sourceKind: "topic", override: 30, depth: "standard" },
      { sourceKind: "text", words: 800, depth: "quick" },
      { sourceKind: "pdf", words: 5000, depth: "standard" },
      { sourceKind: "pdf", words: 50000, depth: "deep" },
    ];

    for (const tc of testCases) {
      const budget = calculateTimeBudget({
        sourceKind: tc.sourceKind,
        sourceWordCount: tc.words,
        studyMinutesOverride: tc.override,
        depth: tc.depth,
      });

      expect(budget.totalSessionMinutes).toBeLessThanOrEqual(budget.studyMinutes);
      expect(budget.chapterCount).toBeLessThanOrEqual(12);
      expect(budget.chapterCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("reduces future chapter word targets by 20% on user feedback (minimum 400 words)", () => {
    const normal = calculateTimeBudget({
      sourceKind: "topic",
      studyMinutesOverride: 40,
      depth: "standard",
    });

    const reduced = calculateTimeBudget({
      sourceKind: "topic",
      studyMinutesOverride: 40,
      depth: "standard",
      reductionFactor: 0.8,
    });

    expect(reduced.wordsPerChapter).toBeLessThan(normal.wordsPerChapter);
    expect(reduced.wordsPerChapter).toBeGreaterThanOrEqual(400);
    expect(reduced.wordsPerChapter).toBe(Math.max(400, Math.round(normal.wordsPerChapter * 0.8)));
  });

  it("omits concepts beyond the 12-chapter budget and informs the user", () => {
    const concepts = Array.from({ length: 45 }, (_, i) => ({
      name: `Concept ${i + 1}`,
      complexity: (i % 3 === 0 ? 3 : 2) as 1 | 2 | 3,
      importance: i + 1,
    }));

    const budget = calculateTimeBudget({
      sourceKind: "topic",
      concepts,
      depth: "deep",
    });

    expect(budget.chapterCount).toBe(12);
    expect(budget.omittedConcepts.length).toBeGreaterThan(0);
    expect(budget.omittedConcepts[0].reason).toContain("12-chapter time budget");
  });
});

