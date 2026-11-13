/**
 * VOTING
 * ------
 * Private and simultaneous. The hard requirements from the specification:
 *   - nobody votes for themselves
 *   - only active, eligible, non-eliminated players vote
 *   - one vote each, final once locked in
 *   - interim totals are never shown
 *   - other players' choices never appear in any network payload
 *   - the room sees HOW MANY have locked, never WHO they picked
 *
 * Tie handling:
 *   1. highest total tied -> private revote
 *   2. only the tied players are selectable
 *   3. still no self-voting
 *   4. tied again -> nobody is eliminated; the imposter survives
 */

import type { PlayerId, PublicPlayer, VoteProgress, VoteTally, VoteTarget } from './types';

export function sameTarget(a: VoteTarget, b: VoteTarget): boolean {
  if (a.kind === 'no_imposter' && b.kind === 'no_imposter') return true;
  if (a.kind === 'player' && b.kind === 'player') return a.playerId === b.playerId;
  return false;
}

/** Stable string form of a target, used as a tally key. */
export function targetKey(target: VoteTarget): string {
  return target.kind === 'no_imposter' ? 'no_imposter' : `player:${target.playerId}`;
}

/**
 * A player may vote if they are still in the round and reachable.
 *
 * A 'reconnecting' player stays eligible: they are inside the two-minute
 * recovery window and may still come back and vote.
 */
export function isEligibleVoter(player: PublicPlayer): boolean {
  if (player.isEliminated) return false;
  return player.connection === 'connected' || player.connection === 'reconnecting';
}

export type VoteRejection =
  | 'not_eligible'
  | 'self_vote'
  | 'already_locked'
  | 'target_not_eligible'
  | 'target_not_in_revote'
  | 'target_unknown'
  | 'wrong_phase';

export type VoteCheck = { ok: true } | { ok: false; reason: VoteRejection; message: string };

export interface VoteContext {
  voterId: PlayerId;
  target: VoteTarget;
  players: readonly PublicPlayer[];
  /** Players who have already locked a vote this round. */
  lockedVoterIds: ReadonlySet<PlayerId>;
  /**
   * During a tied revote, the only selectable players.
   * `null` during a normal first vote.
   */
  revoteCandidates: readonly PlayerId[] | null;
  /** Is "No Imposter" a legal choice? Only in Double Agent Mode. */
  allowNoImposter: boolean;
}

/**
 * Validates a vote before it is locked.
 *
 * These checks are repeated authoritatively in the database; doing them here
 * as well means the player gets an instant, clear message instead of a
 * silent failure.
 */
export function checkVote(context: VoteContext): VoteCheck {
  const voter = context.players.find((p) => p.id === context.voterId);

  if (!voter || !isEligibleVoter(voter)) {
    return {
      ok: false,
      reason: 'not_eligible',
      message: 'You are not able to vote in this round.',
    };
  }

  if (context.lockedVoterIds.has(context.voterId)) {
    return {
      ok: false,
      reason: 'already_locked',
      message: 'Your vote is already locked in and cannot be changed.',
    };
  }

  if (context.target.kind === 'no_imposter') {
    if (!context.allowNoImposter) {
      return {
        ok: false,
        reason: 'target_unknown',
        message: '"No Imposter" is not an option in this game mode.',
      };
    }
    return { ok: true };
  }

  const targetId = context.target.playerId;

  if (targetId === context.voterId) {
    return { ok: false, reason: 'self_vote', message: 'You cannot vote for yourself.' };
  }

  const target = context.players.find((p) => p.id === targetId);
  if (!target) {
    return { ok: false, reason: 'target_unknown', message: 'That player is not in this room.' };
  }

  if (context.revoteCandidates !== null) {
    if (!context.revoteCandidates.includes(targetId)) {
      return {
        ok: false,
        reason: 'target_not_in_revote',
        message: 'In a revote you can only choose one of the tied players.',
      };
    }
    return { ok: true };
  }

  if (target.isEliminated) {
    return {
      ok: false,
      reason: 'target_not_eligible',
      message: 'That player is already out of this round.',
    };
  }

  return { ok: true };
}

/** Who a given voter is allowed to select. */
export function selectableTargets(context: Omit<VoteContext, 'target'>): VoteTarget[] {
  const targets: VoteTarget[] = [];

  for (const player of context.players) {
    if (player.id === context.voterId) continue;
    if (context.revoteCandidates !== null) {
      if (context.revoteCandidates.includes(player.id)) {
        targets.push({ kind: 'player', playerId: player.id });
      }
      continue;
    }
    if (player.isEliminated) continue;
    targets.push({ kind: 'player', playerId: player.id });
  }

  if (context.allowNoImposter && context.revoteCandidates === null) {
    targets.push({ kind: 'no_imposter' });
  }

  return targets;
}

/**
 * The ONLY vote information that may be broadcast while voting is open.
 * Counts only. No identities, no targets.
 */
export function voteProgress(
  players: readonly PublicPlayer[],
  lockedVoterIds: ReadonlySet<PlayerId>,
): VoteProgress {
  const eligible = players.filter(isEligibleVoter);
  return {
    lockedCount: eligible.filter((p) => lockedVoterIds.has(p.id)).length,
    eligibleCount: eligible.length,
  };
}

export function isVotingComplete(
  players: readonly PublicPlayer[],
  lockedVoterIds: ReadonlySet<PlayerId>,
): boolean {
  const progress = voteProgress(players, lockedVoterIds);
  return progress.eligibleCount > 0 && progress.lockedCount >= progress.eligibleCount;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface VoteResolution {
  tallies: VoteTally[];
  /** The player eliminated, or null if nobody was. */
  eliminatedPlayerId: PlayerId | null;
  /** True when the highest total is shared and a revote is required. */
  isTied: boolean;
  /** The tied players, when isTied is true. */
  tiedPlayerIds: PlayerId[];
  /** True when "No Imposter" won outright (Double Agent Mode). */
  noImposterWon: boolean;
}

/**
 * Counts the votes.
 *
 * `isRevote` changes only ONE thing: a tie in a revote eliminates nobody,
 * rather than triggering a further revote.
 */
export function resolveVotes(
  votes: ReadonlyMap<PlayerId, VoteTarget>,
  options: { isRevote: boolean },
): VoteResolution {
  const counts = new Map<string, { target: VoteTarget; count: number }>();

  for (const target of votes.values()) {
    const key = targetKey(target);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { target, count: 1 });
  }

  const tallies: VoteTally[] = [...counts.values()].sort((a, b) => b.count - a.count);

  if (tallies.length === 0) {
    return {
      tallies,
      eliminatedPlayerId: null,
      isTied: false,
      tiedPlayerIds: [],
      noImposterWon: false,
    };
  }

  const highest = tallies[0]!.count;
  const leaders = tallies.filter((t) => t.count === highest);

  if (leaders.length === 1) {
    const winner = leaders[0]!.target;
    if (winner.kind === 'no_imposter') {
      return {
        tallies,
        eliminatedPlayerId: null,
        isTied: false,
        tiedPlayerIds: [],
        noImposterWon: true,
      };
    }
    return {
      tallies,
      eliminatedPlayerId: winner.playerId,
      isTied: false,
      tiedPlayerIds: [],
      noImposterWon: false,
    };
  }

  // Tied at the top.
  const tiedPlayerIds = leaders
    .filter((t): t is { target: Extract<VoteTarget, { kind: 'player' }>; count: number } =>
      t.target.kind === 'player',
    )
    .map((t) => t.target.playerId);

  if (options.isRevote) {
    // Spec: tied again means nobody is eliminated and the imposter survives.
    return {
      tallies,
      eliminatedPlayerId: null,
      isTied: false,
      tiedPlayerIds: [],
      noImposterWon: false,
    };
  }

  return {
    tallies,
    eliminatedPlayerId: null,
    isTied: true,
    tiedPlayerIds,
    noImposterWon: false,
  };
}
