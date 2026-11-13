/**
 * IMPOSTER COUNT RULES
 * --------------------
 * From the specification:
 *   2 players  -> Double Agent Mode: randomly ZERO or ONE imposter
 *   3 players  -> exactly 1
 *   4-5        -> allow 1, recommend 1
 *   6-8        -> allow 1 or 2, recommend 1
 *   9-10       -> allow 1 to 3, recommend 2
 *
 * A host may choose any ALLOWED value. Unbalanced choices produce a warning,
 * never a block.
 */

import { MAX_PLAYERS, MIN_PLAYERS, type GameMode } from './types';

export interface ImposterRule {
  minPlayers: number;
  maxPlayers: number;
  /** Every count the host is permitted to select. */
  allowed: readonly number[];
  /** The count used when the host leaves it on Automatic. */
  recommended: number;
}

export const IMPOSTER_RULES: readonly ImposterRule[] = [
  // 2 players is special-cased: see rollDoubleAgentImposterCount().
  { minPlayers: 3, maxPlayers: 3, allowed: [1], recommended: 1 },
  { minPlayers: 4, maxPlayers: 5, allowed: [1], recommended: 1 },
  { minPlayers: 6, maxPlayers: 8, allowed: [1, 2], recommended: 1 },
  { minPlayers: 9, maxPlayers: 10, allowed: [1, 2, 3], recommended: 2 },
];

export function gameModeForPlayerCount(playerCount: number): GameMode {
  if (playerCount === 2) return 'double_agent';
  if (playerCount === 3) return 'three_player';
  return 'standard';
}

export function isSupportedPlayerCount(playerCount: number): boolean {
  return (
    Number.isInteger(playerCount) && playerCount >= MIN_PLAYERS && playerCount <= MAX_PLAYERS
  );
}

function ruleFor(playerCount: number): ImposterRule {
  const rule = IMPOSTER_RULES.find(
    (r) => playerCount >= r.minPlayers && playerCount <= r.maxPlayers,
  );
  if (!rule) {
    throw new Error(
      `No imposter rule for ${playerCount} players. Double Agent Mode (2 players) is handled separately.`,
    );
  }
  return rule;
}

/** Counts the host may pick. Empty for 2 players, which is decided randomly. */
export function allowedImposterCounts(playerCount: number): readonly number[] {
  if (playerCount === 2) return [];
  if (!isSupportedPlayerCount(playerCount)) return [];
  return ruleFor(playerCount).allowed;
}

/** The Automatic setting's choice. */
export function recommendedImposterCount(playerCount: number): number {
  if (playerCount === 2) {
    throw new Error('Double Agent Mode decides its imposter count randomly, not by recommendation.');
  }
  return ruleFor(playerCount).recommended;
}

export type BalanceSeverity = 'none' | 'notice' | 'warning';

export interface BalanceAdvice {
  severity: BalanceSeverity;
  /** Plain-language message for the host. Empty when severity is 'none'. */
  message: string;
}

/**
 * Advice shown next to the host's selection.
 * This never prevents a valid selection — it only informs.
 */
export function describeBalance(playerCount: number, imposterCount: number): BalanceAdvice {
  if (playerCount === 2) {
    return {
      severity: 'warning',
      message:
        'Double Agent Mode is experimental. There may be one imposter or none at all, and its scores are kept separate from normal matches.',
    };
  }

  if (playerCount === 3) {
    return {
      severity: 'notice',
      message:
        'With 3 players the imposter is easier to spot. Category Hint is recommended to keep it fair.',
    };
  }

  const recommended = recommendedImposterCount(playerCount);
  if (imposterCount === recommended) return { severity: 'none', message: '' };

  // Integer comparison rather than a float ratio: at one imposter per three
  // players the game is already hard to win, and a decimal threshold would let
  // the exact 3-in-9 case slip through by a rounding error.
  if (imposterCount * 3 >= playerCount) {
    return {
      severity: 'warning',
      message: `${imposterCount} imposters out of ${playerCount} players is a very high ratio. The imposters will find it easy to hide. ${recommended} is recommended.`,
    };
  }

  return {
    severity: 'notice',
    message: `${recommended} imposter${recommended === 1 ? '' : 's'} is recommended for ${playerCount} players, but ${imposterCount} is allowed.`,
  };
}

export type ImposterCountRejection =
  | 'unsupported_player_count'
  | 'not_an_allowed_count'
  | 'double_agent_is_random';

export type ImposterCountCheck =
  | { ok: true; count: number; advice: BalanceAdvice }
  | { ok: false; reason: ImposterCountRejection; message: string };

/**
 * Validates a MANUAL imposter count chosen by the host.
 */
export function checkImposterCount(
  playerCount: number,
  imposterCount: number,
): ImposterCountCheck {
  if (!isSupportedPlayerCount(playerCount)) {
    return {
      ok: false,
      reason: 'unsupported_player_count',
      message: `This game supports ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`,
    };
  }

  if (playerCount === 2) {
    return {
      ok: false,
      reason: 'double_agent_is_random',
      message: 'In Double Agent Mode the number of imposters is decided randomly each round.',
    };
  }

  const allowed = allowedImposterCounts(playerCount);
  if (!allowed.includes(imposterCount)) {
    return {
      ok: false,
      reason: 'not_an_allowed_count',
      message: `With ${playerCount} players you can choose ${allowed.join(' or ')} imposter${allowed.length === 1 && allowed[0] === 1 ? '' : 's'}.`,
    };
  }

  return { ok: true, count: imposterCount, advice: describeBalance(playerCount, imposterCount) };
}

/**
 * Resolves the final imposter count for a round, honouring the host's
 * automatic / manual choice.
 *
 * Throws for 2 players, which must go through rollDoubleAgentImposterCount().
 */
export function resolveImposterCount(
  playerCount: number,
  mode: 'automatic' | 'manual',
  manualCount: number,
): number {
  if (playerCount === 2) {
    throw new Error('Use rollDoubleAgentImposterCount() for Double Agent Mode.');
  }
  if (!isSupportedPlayerCount(playerCount)) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }

  if (mode === 'automatic') return recommendedImposterCount(playerCount);

  const check = checkImposterCount(playerCount, manualCount);
  if (!check.ok) {
    // A manual value that became invalid (players left the room) falls back to
    // the recommendation rather than refusing to start the match.
    return recommendedImposterCount(playerCount);
  }
  return check.count;
}
