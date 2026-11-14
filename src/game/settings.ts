/**
 * HOST SETTINGS AND DEFAULTS
 * --------------------------
 * Defaults come straight from the specification:
 *   1 round, automatic imposter count, a random category each round,
 *   Category Hint for the imposter,
 *   medium difficulty, Family age group,
 *   Global region, 30-second guidance timer, imposter allowed to start,
 *   Dark Spy theme.
 */

import { DEFAULT_THEME_ID } from '../config/themes';
import type { ClueTimerSeconds, FixedRoundCount, HostSettings } from './types';
import { allowedImposterCounts, recommendedImposterCount } from './imposterCount';

export const FIXED_ROUND_CHOICES: readonly FixedRoundCount[] = [1, 2, 3, 4, 5];
export const CLUE_TIMER_CHOICES: readonly (ClueTimerSeconds | null)[] = [
  null,
  15,
  20,
  30,
  45,
  60,
];
export const WORD_CATEGORIES = ['Animals', 'Food', 'Places', 'Objects', 'Jobs'] as const;

export const DEFAULT_TARGET_SCORE = 15;

/**
 * Builds the default settings for a room.
 *
 * The imposter always gets the word's category as a clue.
 */
export function defaultHostSettings(playerCount: number): HostSettings {
  return {
    matchEndMode: 'fixed_rounds',
    fixedRounds: 1,
    targetScore: DEFAULT_TARGET_SCORE,

    imposterCountMode: 'automatic',
    manualImposterCount: playerCount >= 3 ? recommendedImposterCount(playerCount) : 1,

    imposterInfo: 'category_hint',

    category: 'random',
    difficulty: 'medium',
    region: 'global',
    ageGroup: 'family',

    themeId: DEFAULT_THEME_ID,

    clueTimerSeconds: 30,

    allowImposterFirst: true,
    allowVoteReveal: true,
  };
}

/**
 * Re-checks settings after the player count changed (someone joined or left)
 * and repairs anything that became impossible.
 *
 * Returns the corrected settings plus plain-language notes for the host.
 */
export function reconcileSettings(
  settings: HostSettings,
  playerCount: number,
): { settings: HostSettings; notes: string[] } {
  const notes: string[] = [];
  const next: HostSettings = { ...settings };

  if (playerCount >= 3) {
    const allowed = allowedImposterCounts(playerCount);
    if (
      next.imposterCountMode === 'manual' &&
      !allowed.includes(next.manualImposterCount)
    ) {
      const repaired = recommendedImposterCount(playerCount);
      notes.push(
        `The imposter count was changed to ${repaired}, because ${next.manualImposterCount} is not possible with ${playerCount} players.`,
      );
      next.manualImposterCount = repaired;
    }
  }

  return { settings: next, notes };
}
