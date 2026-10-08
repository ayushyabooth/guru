/**
 * Where a recap journey is, for the Journey Stages list on the Recap screen.
 *
 * The server's `stage_progress` is the stage the user is ON (stage_2 gives 2),
 * not the number of stages finished. The list used to read it as "stages done",
 * so it ran one stage ahead: on Reflect it ticked Reflect, offered "Continue
 * Exploring", and a tap landed back on Reflect. These helpers read the journey's
 * status instead. Pure functions, so they test without rendering.
 */

// The list's four stages. Commitment closes Explore, so it counts as stage 3.
const STAGE_FOR_STATUS: Record<string, number> = {
  not_started: 1,
  stage_1: 1,
  stage_2: 2,
  stage_3: 3,
  commitment: 3,
  stage_4: 4,
  completed: 4,
};

// The statuses in which finishing a stage moves the journey on.
const ADVANCES_FROM: Record<number, string[]> = {
  1: ['not_started', 'stage_1'],
  2: ['stage_2'],
  3: ['stage_3'],
};

/** The stage (1-4) a journey with this status is on; 0 with no journey yet. */
export function stageForStatus(status?: string | null): number {
  return status ? STAGE_FOR_STATUS[status] ?? 0 : 0;
}

/** How many of the four stages are finished. */
export function completedStageCount(status?: string | null, recapCompleted = false): number {
  if (recapCompleted || status === 'completed') return 4;
  return Math.max(0, stageForStatus(status) - 1);
}

/**
 * What a tap on a stage does: reopen a finished stage for review, which never
 * moves the journey, or resume the stage the journey is on. A stage not reached
 * yet does nothing (the list keeps it locked).
 */
export function stageTapAction(
  status: string | null | undefined,
  stageNum: number,
): 'review' | 'resume' | 'none' {
  const on = stageForStatus(status);
  if (status === 'completed' || on === 0) return 'resume';
  if (stageNum < on) return 'review';
  if (stageNum === on) return 'resume';
  return 'none';
}

/**
 * Whether finishing this stage should advance the journey on the server. Only
 * the stage the journey is on advances; finishing a reviewed stage just moves
 * the review along.
 */
export function finishingAdvances(status: string | null | undefined, stageNum: number): boolean {
  return !!status && (ADVANCES_FROM[stageNum] ?? []).includes(status);
}
