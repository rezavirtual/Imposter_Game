/**
 * CLUE ORDER
 * ----------
 * Who speaks first, and in what order afterwards.
 *
 * WHY THE FIRST SPEAKER IS WEIGHTED
 * Going first is hard for an imposter: they have heard no clues yet, so they
 * must invent one blind. If the imposter went first as often as anyone else,
 * players would learn to read hesitation on the opening clue. If the imposter
 * could NEVER go first, then "spoke first" would be a guaranteed proof of
 * innocence — far worse.
 *
 * So the imposter keeps a real but reduced chance of opening.
 *
 * THE VERSION 1 RULE
 *   regular player start weight = 1.00
 *   imposter      start weight = 0.35
 *   first speaker = weighted random draw across all eligible players
 *   everyone else = uniform shuffle, appended after the first speaker
 *
 * Worked example, 5 players with 1 imposter:
 *   total weight = 4 x 1.00 + 1 x 0.35 = 4.35
 *   P(imposter first) = 0.35 / 4.35 = 8.05%
 *   P(a given regular player first) = 1.00 / 4.35 = 22.99%
 * Compared with an unweighted 20% each, the imposter opens roughly 2.5x less
 * often, but still opens about one round in twelve.
 *
 * ONCE COMMITTED, THE ORDER IS FROZEN. It is written with the round and never
 * recalculated, so a reconnecting phone always sees the same sequence.
 */

import { shuffle, weightedPick, type RandomSource, cryptoRandom } from './random';
import type { PlayerId, Role } from './types';

/** Start weight of a regular player. */
export const REGULAR_START_WEIGHT = 1.0;

/** Start weight of an imposter. Lower, but deliberately never zero. */
export const IMPOSTER_START_WEIGHT = 0.35;

export interface ClueOrderCandidate {
  playerId: PlayerId;
  role: Role;
}

export interface BuildClueOrderOptions {
  /** Host setting: may an imposter be drawn as the first speaker? */
  allowImposterFirst: boolean;
  random?: RandomSource;
}

/**
 * Produces the frozen clue order for a round.
 *
 * The returned array is the authoritative sequence: index 0 speaks first.
 */
export function buildClueOrder(
  candidates: readonly ClueOrderCandidate[],
  options: BuildClueOrderOptions,
): PlayerId[] {
  const random = options.random ?? cryptoRandom;

  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [candidates[0]!.playerId];

  const regulars = candidates.filter((c) => c.role === 'regular');

  // Decide who opens.
  let first: ClueOrderCandidate;

  if (options.allowImposterFirst) {
    first = weightedPick(
      candidates.map((candidate) => ({
        item: candidate,
        weight:
          candidate.role === 'imposter' ? IMPOSTER_START_WEIGHT : REGULAR_START_WEIGHT,
      })),
      random,
    );
  } else if (regulars.length > 0) {
    // Imposter-first disabled: draw the opener from regular players only,
    // uniformly, since the weighting no longer has anything to balance.
    first = regulars[Math.min(regulars.length - 1, Math.floor(random() * regulars.length))]!;
  } else {
    // Every player is an imposter (only reachable in odd test setups).
    first = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!;
  }

  const rest = candidates.filter((c) => c.playerId !== first.playerId);
  return [first.playerId, ...shuffle(rest, random).map((c) => c.playerId)];
}

/**
 * The exact probability that an imposter opens, given the Version 1 weights.
 * Exported so the user interface and the tests can state the same number.
 */
export function imposterFirstProbability(
  regularCount: number,
  imposterCount: number,
  allowImposterFirst: boolean,
): number {
  if (!allowImposterFirst) return 0;
  if (imposterCount === 0) return 0;

  const total =
    regularCount * REGULAR_START_WEIGHT + imposterCount * IMPOSTER_START_WEIGHT;
  if (total === 0) return 0;

  return (imposterCount * IMPOSTER_START_WEIGHT) / total;
}

// ---------------------------------------------------------------------------
// Turn progression
// ---------------------------------------------------------------------------

export interface ClueTurnState {
  /** The frozen order from buildClueOrder(). */
  order: readonly PlayerId[];
  /** Index of the player currently expected to speak. */
  currentIndex: number;
}

export type AdvanceTurnRejection =
  | 'not_active_player'
  | 'stale_turn_index'
  | 'order_already_complete';

export type AdvanceTurnResult =
  | { ok: true; nextIndex: number; isComplete: boolean }
  | { ok: false; reason: AdvanceTurnRejection };

/**
 * Advances exactly one turn.
 *
 * Two independent guards stop a double tap from skipping a player:
 *   1. the requester must be the current active player (or the host)
 *   2. the turn index the client believed in must still be current
 *
 * The same checks are repeated authoritatively in the database.
 */
export function advanceClueTurn(
  state: ClueTurnState,
  request: {
    requesterId: PlayerId;
    /** The index the client had on screen when the button was tapped. */
    expectedIndex: number;
    /** Host override for a disconnected or unresponsive player. */
    byHost: boolean;
  },
): AdvanceTurnResult {
  if (state.currentIndex >= state.order.length) {
    return { ok: false, reason: 'order_already_complete' };
  }

  if (request.expectedIndex !== state.currentIndex) {
    return { ok: false, reason: 'stale_turn_index' };
  }

  if (!request.byHost && state.order[state.currentIndex] !== request.requesterId) {
    return { ok: false, reason: 'not_active_player' };
  }

  const nextIndex = state.currentIndex + 1;
  return { ok: true, nextIndex, isComplete: nextIndex >= state.order.length };
}

/** The player whose turn it is, or null once every clue has been given. */
export function activePlayerId(state: ClueTurnState): PlayerId | null {
  return state.order[state.currentIndex] ?? null;
}

/** Human-friendly position, e.g. "3 of 6". */
export function turnPosition(state: ClueTurnState): { position: number; total: number } {
  return {
    position: Math.min(state.currentIndex + 1, state.order.length),
    total: state.order.length,
  };
}
