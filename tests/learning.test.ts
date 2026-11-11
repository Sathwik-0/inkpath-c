import { describe, expect, it } from "vitest";
import { NEW_STATE, applyReview, isDue, levelFor } from "@/lib/learning/scheduler";
import { planChapter, type PlannerConcept } from "@/lib/learning/planner";

const t0 = new Date("2026-11-10T00:00:00Z");
const day = (n: number) => new Date(t0.getTime() + n * 86_400_000);

describe("scheduler", () => {
  it("first correct answer schedules a review in one day", () => {
    const s = applyReview(NEW_STATE, true, t0);
    expect(s.stabilityDays).toBe(1);
    expect(s.nextReviewAt).toEqual(day(1));
    expect(isDue(s, day(1))).toBe(true);
    expect(isDue(s, day(0.5))).toBe(false);
  });

  it("intervals grow with consecutive correct answers", () => {
    let s = applyReview(NEW_STATE, true, t0);
    s = applyReview(s, true, day(1));
    s = applyReview(s, true, day(3));
    expect(s.stabilityDays).toBeGreaterThan(4);
    expect(s.reps).toBe(3);
  });

  it("a wrong answer resets the interval, counts a lapse and lowers the level", () => {
    let s = applyReview(NEW_STATE, true, t0);
    for (let i = 1; i < 5; i++) s = applyReview(s, true, day(i * 10));
    const before = levelFor(s.stabilityDays);
    const lapsed = applyReview(s, false, day(60));
    expect(lapsed.stabilityDays).toBe(1);
    expect(lapsed.lapses).toBe(1);
    expect(levelFor(lapsed.stabilityDays)).toBeLessThan(before);
  });

  it("level is capped at 10 and stability at 180 days", () => {
    let s = applyReview(NEW_STATE, true, t0);
    for (let i = 0; i < 30; i++) s = applyReview(s, true, day(i));
    expect(s.stabilityDays).toBeLessThanOrEqual(180);
    expect(levelFor(1000)).toBe(10);
  });
});

const c = (id: string, position: number, misconceptions: string[] = []): PlannerConcept => ({
  id, name: id, position, misconceptions,
});

describe("planner", () => {
  const concepts = [c("a", 0), c("b", 1), c("c", 2, ["wrong idea"]), c("d", 3)];

  it("respects prerequisites and spreads concepts over chapters", () => {
    const brief = planChapter({
      chapterNumber: 1, totalChapters: 2, concepts,
      edges: [{ from: "a", to: "c" }, { from: "c", to: "b" }],
      memory: {}, openThreads: [], now: t0,
    });
    // quota 2: a first, then b is blocked by c (blocked by a, which is chosen), so c then b is not allowed in the same pass order
    expect(brief.newConcepts.map((x) => x.id)).toEqual(["a", "c"]);
    expect(brief.isFinal).toBe(false);
    expect(brief.craftCards).toContain("rule-trap");
    expect(brief.craftCards).toContain("misconception-villain");
  });

  it("final chapter teaches everything left and cannot stall on a cycle", () => {
    const brief = planChapter({
      chapterNumber: 2, totalChapters: 2, concepts: [c("x", 0), c("y", 1)],
      edges: [{ from: "x", to: "y" }, { from: "y", to: "x" }],
      memory: {}, openThreads: [], now: t0,
    });
    expect(brief.newConcepts.length).toBe(2);
    expect(brief.isFinal).toBe(true);
  });

  it("brings due concepts back, most lapsed first, and queues due payoffs", () => {
    let weak = applyReview(NEW_STATE, true, t0);
    weak = applyReview(weak, false, day(1));
    const ok = applyReview(NEW_STATE, true, t0);
    const brief = planChapter({
      chapterNumber: 3, totalChapters: 5, concepts,
      edges: [],
      memory: { a: ok, b: weak },
      openThreads: [
        { id: "t1", label: "locked door", conceptId: "a", plantedIn: 1, dueBy: 3 },
        { id: "t2", label: "later", conceptId: "b", plantedIn: 1, dueBy: 5 },
      ],
      now: day(10),
    });
    expect(brief.reviewConcepts[0].id).toBe("b");
    expect(brief.payoffThreads.map((t) => t.id)).toEqual(["t1"]);
    expect(brief.craftCards).toContain("callback");
  });
});
