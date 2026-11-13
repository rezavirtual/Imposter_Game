/**
 * HOST SETTINGS AND DEFAULTS
 * --------------------------
 * Defaults come straight from the specification:
 *   5 rounds, automatic imposter count, Category Hint for three players,
 *   No Word for four or more, medium difficulty, Family age group,
 *   Global region, 30-second guidance timer, imposter allowed to start,
 *   Dark Spy theme.
 */

import { DEFAULT_THEME_ID } from '../config/themes';
import type {
  ClueTimerSeconds,
  FixedRoundCount,
  HostSettings,
  ImposterInfoMode,
} from './types';
import { allowedImposterCounts, recommendedImposterCount } from './imposterCount';

export const FIXED_ROUND_CHOICES: readonly FixedRoundCount[] = [3, 5, 7, 10];
export const CLUE_TIMER_CHOICES: readonly (ClueTimerSeconds | null)[] = [
  null,
  15,
  20,
  30,
  45,
  60,
];

export const DEFAULT_TARGET_SCORE = 15;

/**
 * Builds the default settings for a room.
 *
 * Imposter information depends on the player count: three-player games get
 * Category Hint to stay fair, larger games get No Word.
 */
export function defaultHostSettings(playerCount: number): HostSettings {
  const imposterInfo: ImposterInfoMode = playerCount <= 3 ? 'category_hint' : 'no_word';

  return {
    matchEndMode: 'fixed_rounds',
    fixedRounds: 5,
    targetScore: DEFAULT_TARGET_SCORE,

    imposterCountMode: 'automatic',
    manualImposterCount: playerCount >= 3 ? recommendedImposterCount(playerCount) : 1,

    imposterInfo,

    category: 'any',
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

  if (playerCount <= 3 && next.imposterInfo === 'no_word') {
    notes.push(
      'With three players, Category Hint is recommended so the imposter is not too easy to spot. You can still switch it off.',
    );
  }

  return { settings: next, notes };
}
