/**
 * DOUBLE AGENT MODE (2 players, experimental)
 * -------------------------------------------
 * Deliberately isolated in its own file so its unusual rules can never leak
 * into the standard game. The standard state machine stays untouched; only the
 * few decisions that genuinely differ live here.
 *
 * Rules from the specification:
 *   - randomly select either ZERO or ONE imposter
 *   - both players give clues
 *   - each player votes for the other player, or selects "No Imposter"
 *   - clearly labelled experimental
 *   - scores are NOT mixed with standard-mode scores
 */

import { randomInt, type RandomSource, cryptoRandom } from '../random';
import type { PlayerId, VoteTarget } from '../types';

export const DOUBLE_AGENT_PLAYER_COUNT = 2;

/** Shown wherever this mode appears in the interface. */
export const DOUBLE_AGENT_LABEL = 'Double Agent Mode (experimental)';

export const DOUBLE_AGENT_EXPLANATION =
  'With two players there may be one imposter, or none at all. Give your clues, then decide: is the other player the imposter, or is nobody?';

/**
 * Decides how many imposters this round has: 0 or 1, with equal probability.
 *
 * The honest 50/50 split is what makes "No Imposter" a real choice rather than
 * a trap, so it is fixed rather than configurable.
 */
export function rollDoubleAgentImposterCount(random: RandomSource = cryptoRandom): 0 | 1 {
  return randomInt(2, random) === 0 ? 0 : 1;
}

/**
 * The vote options one player sees. Always exactly two: the other player, or
 * "no imposter". Voting for yourself is impossible by construction.
 */
export function doubleAgentVoteOptions(
  voterId: PlayerId,
  bothPlayerIds: readonly [PlayerId, PlayerId],
): VoteTarget[] {
  const other = bothPlayerIds.find((id) => id !== voterId);
  if (!other) {
    throw new Error('Double Agent Mode requires two distinct players.');
  }
  return [
    { kind: 'player', playerId: other },
    { kind: 'no_imposter' },
  ];
}

export interface DoubleAgentOutcome {
  /** Was there actually an imposter this round? */
  hadImposter: boolean;
  /** Did this player identify the truth correctly? */
  correctByPlayer: Record<PlayerId, boolean>;
}

/**
 * Judges both players' votes against the truth.
 *
 * Correct means:
 *   - there WAS an imposter and you voted for that player, or
 *   - there was NO imposter and you selected "No Imposter".
 */
export function judgeDoubleAgentVotes(
  imposterId: PlayerId | null,
  votes: ReadonlyMap<PlayerId, VoteTarget>,
): DoubleAgentOutcome {
  const correctByPlayer: Record<PlayerId, boolean> = {};

  for (const [voterId, target] of votes) {
    if (imposterId === null) {
      correctByPlayer[voterId] = target.kind === 'no_imposter';
    } else {
      correctByPlayer[voterId] =
        target.kind === 'player' && target.playerId === imposterId;
    }
  }

  return { hadImposter: imposterId !== null, correctByPlayer };
}
