import { isDue, overdueDays, type MemoryState } from "./scheduler";

/**
 * Chapter planner. Deterministic code decides WHAT the next chapter must teach,
 * review and pay off. The model only decides how to dramatise it.
 */

export interface PlannerConcept {
  id: string;
  name: string;
  position: number;
  misconceptions: string[];
}
export interface PlannerEdge {
  from: string; // prerequisite
  to: string;
}
export interface PlannerThread {
  id: string;
  label: string;
  conceptId: string | null;
  plantedIn: number | null;
  dueBy: number | null;
}

export interface PlannerInput {
  chapterNumber: number;
  totalChapters: number;
  concepts: PlannerConcept[];
  edges: PlannerEdge[];
  /** Concepts the learner has met, keyed by concept id. */
  memory: Record<string, MemoryState>;
  openThreads: PlannerThread[];
  now: Date;
  maxReviews?: number;
}

export interface ChapterBrief {
  chapterNumber: number;
  isFinal: boolean;
  newConcepts: PlannerConcept[];
  reviewConcepts: PlannerConcept[];
  payoffThreads: PlannerThread[];
  plantForLater: PlannerConcept[];
  craftCards: string[];
}

export function planChapter(input: PlannerInput): ChapterBrief {
  const { chapterNumber, totalChapters, concepts, edges, memory, openThreads, now } = input;
  const maxReviews = input.maxReviews ?? 2;
  const isFinal = chapterNumber >= totalChapters;

  const introduced = new Set(Object.keys(memory));
  const unmet = concepts.filter((c) => !introduced.has(c.id)).sort((a, b) => a.position - b.position);

  // Even pacing: spread what is left over the chapters that are left.
  const chaptersLeft = Math.max(1, totalChapters - chapterNumber + 1);
  const quota = isFinal ? unmet.length : Math.max(1, Math.ceil(unmet.length / chaptersLeft));

  // A concept is teachable once all its prerequisites are met or chosen earlier in this chapter.
  const prereqs = new Map<string, string[]>();
  for (const e of edges) prereqs.set(e.to, [...(prereqs.get(e.to) ?? []), e.from]);
  const chosen: PlannerConcept[] = [];
  const known = new Set(introduced);
  let progressed = true;
  while (chosen.length < quota && progressed) {
    progressed = false;
    for (const c of unmet) {
      if (chosen.length >= quota) break;
      if (known.has(c.id)) continue;
      if ((prereqs.get(c.id) ?? []).every((p) => known.has(p))) {
        chosen.push(c);
        known.add(c.id);
        progressed = true;
      }
    }
  }
  // Cycles or bad edges must never stall the story: fall back to document order.
  if (chosen.length === 0 && unmet.length > 0) chosen.push(...unmet.slice(0, quota));

  // Reviews: due concepts, most overdue and most lapsed first.
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const reviewConcepts = Object.entries(memory)
    .filter(([id, s]) => byId.has(id) && isDue(s, now))
    .sort(
      ([, a], [, b]) =>
        b.lapses - a.lapses || overdueDays(b, now) - overdueDays(a, now),
    )
    .slice(0, maxReviews)
    .map(([id]) => byId.get(id)!);

  const payoffThreads = openThreads.filter(
    (t) => t.dueBy !== null && t.dueBy <= chapterNumber,
  );

  // Concepts for later chapters can be planted now as small puzzles.
  const plantForLater = isFinal
    ? []
    : unmet.filter((c) => !known.has(c.id)).slice(0, 1);

  const craftCards: string[] = [];
  if (chosen.length) craftCards.push("rule-trap");
  if (chosen.some((c) => c.misconceptions.length)) craftCards.push("misconception-villain");
  if (reviewConcepts.length) craftCards.push("callback");
  if (payoffThreads.length) craftCards.push("plant-payoff");
  if (plantForLater.length) craftCards.push("plant-payoff");
  if (chapterNumber > 1) craftCards.push("stakes-escalation");
  craftCards.push(isFinal ? "show-dont-tell" : "information-gap");

  return {
    chapterNumber,
    isFinal,
    newConcepts: chosen,
    reviewConcepts,
    payoffThreads,
    plantForLater,
    craftCards: [...new Set(craftCards)].slice(0, 4),
  };
}
