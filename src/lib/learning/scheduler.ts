/**
 * Spaced-repetition scheduler. Pure functions, no I/O, no AI: predictable and cheap.
 * The "System window" level is derived from stability, so it only rises when the
 * learner actually keeps recalling a concept over longer gaps.
 */

export interface MemoryState {
  stabilityDays: number;
  ease: number;
  lapses: number;
  reps: number;
  lastSeenAt: Date | null;
  nextReviewAt: Date | null;
}

export const NEW_STATE: MemoryState = {
  stabilityDays: 0,
  ease: 2.3,
  lapses: 0,
  reps: 0,
  lastSeenAt: null,
  nextReviewAt: null,
};

const DAY = 86_400_000;
const MAX_STABILITY = 180;
const LEVEL_THRESHOLDS = [1, 3, 7, 14, 30, 60, 90, 120, 150, 180];

export function levelFor(stabilityDays: number): number {
  return LEVEL_THRESHOLDS.filter((t) => stabilityDays >= t).length;
}

export function applyReview(state: MemoryState, correct: boolean, now: Date): MemoryState {
  if (!correct) {
    return {
      stabilityDays: 1,
      ease: Math.max(1.3, state.ease - 0.2),
      lapses: state.lapses + 1,
      reps: state.reps,
      lastSeenAt: now,
      nextReviewAt: new Date(now.getTime() + DAY),
    };
  }
  const stability =
    state.reps === 0 || state.stabilityDays < 1
      ? 1
      : Math.min(MAX_STABILITY, Math.round(state.stabilityDays * state.ease * 10) / 10);
  return {
    stabilityDays: stability,
    ease: Math.min(2.8, state.ease + 0.05),
    lapses: state.lapses,
    reps: state.reps + 1,
    lastSeenAt: now,
    nextReviewAt: new Date(now.getTime() + stability * DAY),
  };
}

export function isDue(state: MemoryState, now: Date): boolean {
  return !!state.nextReviewAt && state.nextReviewAt.getTime() <= now.getTime();
}

/** How overdue a concept is, in days (0 if not due). Used to rank reviews. */
export function overdueDays(state: MemoryState, now: Date): number {
  if (!state.nextReviewAt) return 0;
  return Math.max(0, (now.getTime() - state.nextReviewAt.getTime()) / DAY);
}
