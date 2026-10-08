/**
 * The Journey Stages list on the Recap screen: which stages read as done, what a
 * tap does, and when finishing a stage moves the journey. Pure helpers, so
 * nothing renders.
 */
import { describe, expect, it } from '@jest/globals';
import {
  completedStageCount,
  finishingAdvances,
  stageForStatus,
  stageTapAction,
} from '../../components/Recap/recapStages';

describe('stageForStatus', () => {
  it('reads the stage the journey is on, with commitment closing Explore', () => {
    expect(stageForStatus('not_started')).toBe(1);
    expect(stageForStatus('stage_1')).toBe(1);
    expect(stageForStatus('stage_2')).toBe(2);
    expect(stageForStatus('stage_3')).toBe(3);
    expect(stageForStatus('commitment')).toBe(3);
    expect(stageForStatus('stage_4')).toBe(4);
    expect(stageForStatus(undefined)).toBe(0);
  });
});

describe('completedStageCount', () => {
  it('on Reflect, only Your Reading is done (the list used to tick Reflect too)', () => {
    expect(completedStageCount('stage_2')).toBe(1);
  });

  it('counts the stages before the one the journey is on', () => {
    expect(completedStageCount('stage_1')).toBe(0);
    expect(completedStageCount('stage_3')).toBe(2);
    expect(completedStageCount('commitment')).toBe(2);
    expect(completedStageCount('stage_4')).toBe(3);
  });

  it('a finished recap has all four done, and no journey has none', () => {
    expect(completedStageCount('completed')).toBe(4);
    expect(completedStageCount(undefined, true)).toBe(4);
    expect(completedStageCount(undefined)).toBe(0);
  });
});

describe('stageTapAction', () => {
  it('a finished stage opens for review, so it never moves the journey', () => {
    expect(stageTapAction('stage_2', 1)).toBe('review');
    expect(stageTapAction('stage_3', 1)).toBe('review');
    expect(stageTapAction('stage_3', 2)).toBe('review');
  });

  it('the stage the journey is on resumes where it is', () => {
    expect(stageTapAction('stage_2', 2)).toBe('resume');
    expect(stageTapAction('commitment', 3)).toBe('resume');
  });

  it('a stage not reached yet does nothing', () => {
    expect(stageTapAction('stage_2', 3)).toBe('none');
    expect(stageTapAction('stage_2', 4)).toBe('none');
  });

  it('a finished recap, or no known status, resumes', () => {
    expect(stageTapAction('completed', 2)).toBe('resume');
    expect(stageTapAction(undefined, 1)).toBe('resume');
  });
});

describe('finishingAdvances', () => {
  it('only the stage the journey is on advances it', () => {
    expect(finishingAdvances('stage_1', 1)).toBe(true);
    expect(finishingAdvances('not_started', 1)).toBe(true);
    expect(finishingAdvances('stage_2', 2)).toBe(true);
    expect(finishingAdvances('stage_3', 3)).toBe(true);
  });

  it('finishing a reviewed stage leaves the journey where it is', () => {
    expect(finishingAdvances('stage_3', 1)).toBe(false);
    expect(finishingAdvances('stage_3', 2)).toBe(false);
    expect(finishingAdvances('stage_4', 3)).toBe(false);
    expect(finishingAdvances('commitment', 3)).toBe(false);
    expect(finishingAdvances(undefined, 1)).toBe(false);
  });
});
