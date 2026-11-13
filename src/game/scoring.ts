/**
 * SCORING
 * -------
 * Points are calculated here, and the result is written authoritatively by the
 * database. No phone ever decides its own score.
 *
 * STANDARD MODE (from the specification)
 *   Regular player
 *     +1 for voting for an imposter
 *     +1 when the group catches an imposter
 *   Imposter
 *     +3 for avoiding elimination
 *     +2 if caught but the final spoken word guess is correct
 *
 * MULTIPLE IMPOSTERS - VERSION 1 RULE
 *   Only the ELIMINATED imposter gets the final-guess opportunity.
 *   A correct guess awards the +2 to that eliminated imposter alone.
 *   Imposters who were NOT eliminated still receive their +3 for surviving.
 *
 * DOUBLE AGENT MODE
 *   Scored by a separate function into a separate ledger, so its numbers can
 *   never be added to standard-mode totals.
 */

import type { PlayerId, Role, VoteTarget } from './types';
import { judgeDoubleAgentVotes } from './modes/doubleAgent';

export const POINTS = {
  /** Regular player voted for someone who really was an imposter. */
  REGULAR_CORRECT_VOTE: 1,
  /** Every regular player shares the win when an imposter is caught. */
  REGULAR_GROUP_CAUGHT_IMPOSTER: 1,
  /** Imposter was not eliminated this round. */
  IMPOSTER_SURVIVED: 3,
  /** Eliminated imposter guessed the secret word correctly. */
  IMPOSTER_CORRECT_FINAL_GUESS: 2,
} as const;

/** Double Agent Mode points, kept in a separate namespace on purpose. */
export const DOUBLE_AGENT_POINTS = {
  /** Correctly identified the imposter, or correctly said there was none. */
  CORRECT_READ: 2,
  /** Imposter was not identified by the other player. */
  IMPOSTER_SURVIVED: 3,
} as const;

export interface ScoringPlayer {
  id: PlayerId;
  role: Role;
}

export interface RoundScoringInput {
  players: readonly ScoringPlayer[];
  /** Every locked vote: voter -> target. */
  votes: ReadonlyMap<PlayerId, VoteTarget>;
  /** Who the vote eliminated, or null if nobody. */
  eliminatedPlayerId: PlayerId | null;
  /**
   * The host's judgement of the eliminated imposter's spoken guess.
   * `null` when no guess took place.
   */
  finalGuessCorrect: boolean | null;
}

export interface ScoreLine {
  playerId: PlayerId;
  points: number;
  /** Plain-language breakdown shown on the round result screen. */
  reasons: string[];
}

export interface RoundScoringResult {
  lines: ScoreLine[];
  /** Did the group eliminate an imposter this round? */
  imposterCaught: boolean;
  /** The eliminated player's role, or null if nobody was eliminated. */
  eliminatedRole: Role | null;
}

/**
 * Calculates every player's points for one STANDARD round.
 *
 * Pure and deterministic: identical input always yields identical output,
 * which is what makes it safe to re-run during a reconnect.
 */
export function scoreStandardRound(input: RoundScoringInput): RoundScoringResult {
  const roleById = new Map<PlayerId, Role>(input.players.map((p) => [p.id, p.role]));

  const eliminatedRole = input.eliminatedPlayerId
    ? (roleById.get(input.eliminatedPlayerId) ?? null)
    : null;

  const imposterCaught = eliminatedRole === 'imposter';

  const lines: ScoreLine[] = input.players.map((player) => ({
    playerId: player.id,
    points: 0,
    reasons: [],
  }));
  const lineById = new Map(lines.map((line) => [line.playerId, line]));

  for (const player of input.players) {
    const line = lineById.get(player.id)!;

    if (player.role === 'regular') {
      // +1 for personally voting for an imposter.
      const vote = input.votes.get(player.id);
      if (vote && vote.kind === 'player' && roleById.get(vote.playerId) === 'imposter') {
        line.points += POINTS.REGULAR_CORRECT_VOTE;
        line.reasons.push('Voted for an imposter');
      }

      // +1 shared by the whole group when an imposter is caught.
      if (imposterCaught) {
        line.points += POINTS.REGULAR_GROUP_CAUGHT_IMPOSTER;
        line.reasons.push('The group caught an imposter');
      }
      continue;
    }

    // Imposter.
    const wasEliminated = player.id === input.eliminatedPlayerId;

    if (!wasEliminated) {
      line.points += POINTS.IMPOSTER_SURVIVED;
      line.reasons.push('Avoided elimination');
      continue;
    }

    // Only the eliminated imposter is offered the final guess.
    if (input.finalGuessCorrect === true) {
      line.points += POINTS.IMPOSTER_CORRECT_FINAL_GUESS;
      line.reasons.push('Caught, but guessed the secret word correctly');
    }
  }

  return { lines, imposterCaught, eliminatedRole };
}

// ---------------------------------------------------------------------------
// Double Agent Mode — SEPARATE LEDGER
// ---------------------------------------------------------------------------

export interface DoubleAgentScoringInput {
  playerIds: readonly [PlayerId, PlayerId];
  /** The imposter, or null when this round had none. */
  imposterId: PlayerId | null;
  votes: ReadonlyMap<PlayerId, VoteTarget>;
}

/**
 * Scores one Double Agent round.
 *
 * The returned lines must be written to the experimental ledger, never added
 * to standard-mode scores.
 */
export function scoreDoubleAgentRound(input: DoubleAgentScoringInput): RoundScoringResult {
  const outcome = judgeDoubleAgentVotes(input.imposterId, input.votes);

  const lines: ScoreLine[] = input.playerIds.map((playerId) => {
    const line: ScoreLine = { playerId, points: 0, reasons: [] };

    if (outcome.correctByPlayer[playerId]) {
      line.points += DOUBLE_AGENT_POINTS.CORRECT_READ;
      line.reasons.push(
        input.imposterId === null
          ? 'Correctly judged that there was no imposter'
          : 'Correctly identified the imposter',
      );
    }

    if (input.imposterId === playerId) {
      const other = input.playerIds.find((id) => id !== playerId)!;
      if (!outcome.correctByPlayer[other]) {
        line.points += DOUBLE_AGENT_POINTS.IMPOSTER_SURVIVED;
        line.reasons.push('Went undetected as the imposter');
      }
    }

    return line;
  });

  const caught =
    input.imposterId !== null &&
    Object.entries(outcome.correctByPlayer).some(
      ([voterId, correct]) => correct && voterId !== input.imposterId,
    );

  return {
    lines,
    imposterCaught: caught,
    eliminatedRole: null,
  };
}

// ---------------------------------------------------------------------------
// Match totals
// ---------------------------------------------------------------------------

export interface MatchEndCondition {
  mode: 'fixed_rounds' | 'target_score' | 'host_manual';
  fixedRounds: number;
  targetScore: number;
}

/**
 * Has the match finished?
 *
 * `host_manual` always returns false: only the host's explicit End Match
 * action finishes that kind of game.
 */
export function isMatchComplete(
  condition: MatchEndCondition,
  state: { roundsPlayed: number; highestScore: number },
): boolean {
  switch (condition.mode) {
    case 'fixed_rounds':
      return state.roundsPlayed >= condition.fixedRounds;
    case 'target_score':
      return state.highestScore >= condition.targetScore;
    case 'host_manual':
      return false;
  }
}

export interface Standing {
  playerId: PlayerId;
  score: number;
  /** 1-based. Players on equal points share a rank. */
  rank: number;
  isTiedForRank: boolean;
}

/** Sorts final scores into ranks, handling shared places correctly. */
export function buildStandings(
  scores: ReadonlyMap<PlayerId, number>,
): Standing[] {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  const standings: Standing[] = [];
  let currentRank = 0;
  let previousScore: number | null = null;

  sorted.forEach(([playerId, score], index) => {
    if (score !== previousScore) {
      currentRank = index + 1;
      previousScore = score;
    }
    standings.push({ playerId, score, rank: currentRank, isTiedForRank: false });
  });

  // Mark shared ranks after the fact so every member of a tie is flagged.
  const rankCounts = new Map<number, number>();
  for (const standing of standings) {
    rankCounts.set(standing.rank, (rankCounts.get(standing.rank) ?? 0) + 1);
  }
  for (const standing of standings) {
    standing.isTiedForRank = (rankCounts.get(standing.rank) ?? 0) > 1;
  }

  return standings;
}
