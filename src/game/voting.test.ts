import { describe, it, expect } from 'vitest';
import {
  checkVote,
  selectableTargets,
  voteProgress,
  isVotingComplete,
  resolveVotes,
  isEligibleVoter,
} from './voting';
import type { PlayerId, PublicPlayer, VoteTarget } from './types';

function player(id: string, overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id,
    nickname: id.toUpperCase(),
    isHost: false,
    connection: 'connected',
    score: 0,
    joinedAt: '2026-01-01T00:00:00.000Z',
    hasLockedVote: false,
    isEliminated: false,
    ...overrides,
  };
}

const PLAYERS = [player('a'), player('b'), player('c'), player('d')];

function baseContext(overrides: Partial<Parameters<typeof checkVote>[0]> = {}) {
  return {
    voterId: 'a',
    target: { kind: 'player', playerId: 'b' } as VoteTarget,
    players: PLAYERS,
    lockedVoterIds: new Set<PlayerId>(),
    revoteCandidates: null,
    allowNoImposter: false,
    ...overrides,
  };
}

describe('voter eligibility', () => {
  it('allows a connected player', () => {
    expect(isEligibleVoter(player('a'))).toBe(true);
  });

  it('keeps a reconnecting player eligible during their recovery window', () => {
    expect(isEligibleVoter(player('a', { connection: 'reconnecting' }))).toBe(true);
  });

  it('excludes a fully disconnected player', () => {
    expect(isEligibleVoter(player('a', { connection: 'disconnected' }))).toBe(false);
  });

  it('excludes an eliminated player', () => {
    expect(isEligibleVoter(player('a', { isEliminated: true }))).toBe(false);
  });
});

describe('vote validation', () => {
  it('accepts a normal vote', () => {
    expect(checkVote(baseContext()).ok).toBe(true);
  });

  it('refuses a self-vote', () => {
    const result = checkVote(
      baseContext({ target: { kind: 'player', playerId: 'a' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('self_vote');
      expect(result.message).toMatch(/yourself/i);
    }
  });

  it('refuses a second vote once locked', () => {
    const result = checkVote(baseContext({ lockedVoterIds: new Set(['a']) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_locked');
  });

  it('refuses a vote from a disconnected player', () => {
    const players = [player('a', { connection: 'disconnected' }), player('b')];
    const result = checkVote(baseContext({ players }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_eligible');
  });

  it('refuses a vote for an already eliminated player', () => {
    const players = [player('a'), player('b', { isEliminated: true })];
    const result = checkVote(baseContext({ players }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('target_not_eligible');
  });

  it('refuses a vote for somebody who is not in the room', () => {
    const result = checkVote(
      baseContext({ target: { kind: 'player', playerId: 'ghost' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('target_unknown');
  });

  it('refuses No Imposter outside Double Agent Mode', () => {
    const result = checkVote(baseContext({ target: { kind: 'no_imposter' } }));
    expect(result.ok).toBe(false);
  });

  it('accepts No Imposter in Double Agent Mode', () => {
    const result = checkVote(
      baseContext({ target: { kind: 'no_imposter' }, allowNoImposter: true }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('revote restrictions', () => {
  it('only allows the tied players as targets', () => {
    const ok = checkVote(
      baseContext({ target: { kind: 'player', playerId: 'b' }, revoteCandidates: ['b', 'c'] }),
    );
    expect(ok.ok).toBe(true);

    const bad = checkVote(
      baseContext({ target: { kind: 'player', playerId: 'd' }, revoteCandidates: ['b', 'c'] }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('target_not_in_revote');
  });

  it('still blocks self-voting even if you are one of the tied players', () => {
    const result = checkVote(
      baseContext({
        voterId: 'b',
        target: { kind: 'player', playerId: 'b' },
        revoteCandidates: ['b', 'c'],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('self_vote');
  });
});

describe('selectable targets', () => {
  it('never includes yourself', () => {
    const targets = selectableTargets(baseContext());
    expect(targets).not.toContainEqual({ kind: 'player', playerId: 'a' });
    expect(targets).toHaveLength(3);
  });

  it('is limited to tied players during a revote', () => {
    const targets = selectableTargets(baseContext({ voterId: 'a', revoteCandidates: ['b', 'c'] }));
    expect(targets).toEqual([
      { kind: 'player', playerId: 'b' },
      { kind: 'player', playerId: 'c' },
    ]);
  });

  it('adds No Imposter only in Double Agent Mode', () => {
    const targets = selectableTargets(baseContext({ allowNoImposter: true }));
    expect(targets).toContainEqual({ kind: 'no_imposter' });
  });
});

describe('vote progress is count-only', () => {
  it('reports how many have locked, and nothing about who they chose', () => {
    const progress = voteProgress(PLAYERS, new Set(['a', 'c']));
    expect(progress).toEqual({ lockedCount: 2, eligibleCount: 4 });
    // The shape itself must not carry identities.
    expect(Object.keys(progress).sort()).toEqual(['eligibleCount', 'lockedCount']);
  });

  it('excludes ineligible players from the denominator', () => {
    const players = [player('a'), player('b', { connection: 'disconnected' }), player('c')];
    expect(voteProgress(players, new Set(['a'])).eligibleCount).toBe(2);
  });

  it('detects completion', () => {
    expect(isVotingComplete(PLAYERS, new Set(['a', 'b', 'c']))).toBe(false);
    expect(isVotingComplete(PLAYERS, new Set(['a', 'b', 'c', 'd']))).toBe(true);
  });
});

function votes(entries: Record<string, string>): Map<PlayerId, VoteTarget> {
  return new Map(
    Object.entries(entries).map(([voter, target]) => [
      voter,
      target === 'no_imposter'
        ? ({ kind: 'no_imposter' } as VoteTarget)
        : ({ kind: 'player', playerId: target } as VoteTarget),
    ]),
  );
}

describe('resolving votes', () => {
  it('eliminates the clear leader', () => {
    const result = resolveVotes(votes({ a: 'b', c: 'b', d: 'a' }), { isRevote: false });
    expect(result.eliminatedPlayerId).toBe('b');
    expect(result.isTied).toBe(false);
  });

  it('declares a tie instead of picking a winner', () => {
    const result = resolveVotes(votes({ a: 'b', b: 'a', c: 'd', d: 'c' }), { isRevote: false });
    expect(result.isTied).toBe(true);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(result.tiedPlayerIds.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('eliminates nobody when a REVOTE ties again, so the imposter survives', () => {
    const result = resolveVotes(votes({ a: 'b', c: 'b', b: 'c', d: 'c' }), { isRevote: true });
    expect(result.isTied).toBe(false);
    expect(result.eliminatedPlayerId).toBeNull();
  });

  it('resolves a revote that produces a clear leader', () => {
    const result = resolveVotes(votes({ a: 'b', c: 'b', d: 'c' }), { isRevote: true });
    expect(result.eliminatedPlayerId).toBe('b');
  });

  it('handles No Imposter winning in Double Agent Mode', () => {
    const result = resolveVotes(
      votes({ p1: 'no_imposter', p2: 'no_imposter' }),
      { isRevote: false },
    );
    expect(result.noImposterWon).toBe(true);
    expect(result.eliminatedPlayerId).toBeNull();
  });

  it('handles an empty vote map without crashing', () => {
    const result = resolveVotes(new Map(), { isRevote: false });
    expect(result.eliminatedPlayerId).toBeNull();
    expect(result.tallies).toEqual([]);
  });
});
