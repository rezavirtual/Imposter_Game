import { describe, it, expect } from 'vitest';
import {
  scoreStandardRound,
  scoreDoubleAgentRound,
  isMatchComplete,
  buildStandings,
  POINTS,
  DOUBLE_AGENT_POINTS,
  type ScoringPlayer,
} from './scoring';
import type { PlayerId, VoteTarget } from './types';

function votesFor(entries: Record<PlayerId, PlayerId>): Map<PlayerId, VoteTarget> {
  return new Map(
    Object.entries(entries).map(([voter, target]) => [
      voter,
      { kind: 'player', playerId: target } as VoteTarget,
    ]),
  );
}

function pointsOf(result: ReturnType<typeof scoreStandardRound>, id: PlayerId): number {
  return result.lines.find((l) => l.playerId === id)?.points ?? 0;
}

const FIVE_PLAYERS: ScoringPlayer[] = [
  { id: 'a', role: 'regular' },
  { id: 'b', role: 'regular' },
  { id: 'c', role: 'regular' },
  { id: 'd', role: 'regular' },
  { id: 'imp', role: 'imposter' },
];

describe('standard scoring: imposter is caught', () => {
  const result = scoreStandardRound({
    players: FIVE_PLAYERS,
    votes: votesFor({ a: 'imp', b: 'imp', c: 'imp', d: 'b', imp: 'a' }),
    eliminatedPlayerId: 'imp',
    finalGuessCorrect: false,
  });

  it('reports the catch', () => {
    expect(result.imposterCaught).toBe(true);
    expect(result.eliminatedRole).toBe('imposter');
  });

  it('gives correct voters both the vote point and the group point', () => {
    expect(pointsOf(result, 'a')).toBe(
      POINTS.REGULAR_CORRECT_VOTE + POINTS.REGULAR_GROUP_CAUGHT_IMPOSTER,
    );
  });

  it('gives a wrong voter only the group point', () => {
    expect(pointsOf(result, 'd')).toBe(POINTS.REGULAR_GROUP_CAUGHT_IMPOSTER);
  });

  it('gives the caught imposter nothing when the guess was wrong', () => {
    expect(pointsOf(result, 'imp')).toBe(0);
  });
});

describe('standard scoring: caught imposter guesses the word correctly', () => {
  it('awards exactly the final-guess points', () => {
    const result = scoreStandardRound({
      players: FIVE_PLAYERS,
      votes: votesFor({ a: 'imp', b: 'imp', c: 'imp', d: 'imp', imp: 'a' }),
      eliminatedPlayerId: 'imp',
      finalGuessCorrect: true,
    });
    expect(pointsOf(result, 'imp')).toBe(POINTS.IMPOSTER_CORRECT_FINAL_GUESS);
  });
});

describe('standard scoring: imposter survives', () => {
  const result = scoreStandardRound({
    players: FIVE_PLAYERS,
    votes: votesFor({ a: 'b', b: 'a', c: 'a', d: 'a', imp: 'a' }),
    eliminatedPlayerId: 'a',
    finalGuessCorrect: null,
  });

  it('awards the survival points', () => {
    expect(pointsOf(result, 'imp')).toBe(POINTS.IMPOSTER_SURVIVED);
  });

  it('gives no group point when an innocent was eliminated', () => {
    expect(result.imposterCaught).toBe(false);
    expect(pointsOf(result, 'b')).toBe(0);
    expect(pointsOf(result, 'c')).toBe(0);
  });
});

describe('standard scoring: nobody eliminated after a double tie', () => {
  it('still awards the imposter survival points', () => {
    const result = scoreStandardRound({
      players: FIVE_PLAYERS,
      votes: votesFor({ a: 'b', b: 'a', c: 'd', d: 'c', imp: 'a' }),
      eliminatedPlayerId: null,
      finalGuessCorrect: null,
    });
    expect(pointsOf(result, 'imp')).toBe(POINTS.IMPOSTER_SURVIVED);
    expect(result.imposterCaught).toBe(false);
  });
});

describe('multiple imposters: Version 1 rule', () => {
  const players: ScoringPlayer[] = [
    { id: 'a', role: 'regular' },
    { id: 'b', role: 'regular' },
    { id: 'c', role: 'regular' },
    { id: 'imp1', role: 'imposter' },
    { id: 'imp2', role: 'imposter' },
  ];

  const result = scoreStandardRound({
    players,
    votes: votesFor({ a: 'imp1', b: 'imp1', c: 'imp2', imp1: 'a', imp2: 'a' }),
    eliminatedPlayerId: 'imp1',
    finalGuessCorrect: true,
  });

  it('awards the guess points ONLY to the eliminated imposter', () => {
    expect(pointsOf(result, 'imp1')).toBe(POINTS.IMPOSTER_CORRECT_FINAL_GUESS);
  });

  it('still awards survival points to the imposter who was not eliminated', () => {
    expect(pointsOf(result, 'imp2')).toBe(POINTS.IMPOSTER_SURVIVED);
  });

  it('rewards voting for EITHER imposter', () => {
    expect(pointsOf(result, 'c')).toBe(
      POINTS.REGULAR_CORRECT_VOTE + POINTS.REGULAR_GROUP_CAUGHT_IMPOSTER,
    );
  });
});

describe('scoring never rewards an imposter for voting', () => {
  it('ignores an imposter voting for another imposter', () => {
    const players: ScoringPlayer[] = [
      { id: 'a', role: 'regular' },
      { id: 'imp1', role: 'imposter' },
      { id: 'imp2', role: 'imposter' },
    ];
    const result = scoreStandardRound({
      players,
      votes: votesFor({ a: 'imp1', imp1: 'imp2', imp2: 'imp1' }),
      eliminatedPlayerId: null,
      finalGuessCorrect: null,
    });
    // Survival only, no vote point.
    expect(pointsOf(result, 'imp1')).toBe(POINTS.IMPOSTER_SURVIVED);
    expect(pointsOf(result, 'imp2')).toBe(POINTS.IMPOSTER_SURVIVED);
  });
});

describe('scoring is deterministic', () => {
  it('produces identical results when re-run, so a reconnect is safe', () => {
    const input = {
      players: FIVE_PLAYERS,
      votes: votesFor({ a: 'imp', b: 'imp', c: 'd', d: 'imp', imp: 'a' }),
      eliminatedPlayerId: 'imp',
      finalGuessCorrect: false as boolean | null,
    };
    expect(scoreStandardRound(input)).toEqual(scoreStandardRound(input));
  });
});

describe('Double Agent Mode scoring', () => {
  const ids: [PlayerId, PlayerId] = ['p1', 'p2'];

  it('rewards correctly identifying the imposter', () => {
    const result = scoreDoubleAgentRound({
      playerIds: ids,
      imposterId: 'p2',
      votes: new Map<PlayerId, VoteTarget>([
        ['p1', { kind: 'player', playerId: 'p2' }],
        ['p2', { kind: 'player', playerId: 'p1' }],
      ]),
    });
    const p1 = result.lines.find((l) => l.playerId === 'p1')!;
    expect(p1.points).toBe(DOUBLE_AGENT_POINTS.CORRECT_READ);
    expect(result.imposterCaught).toBe(true);
  });

  it('rewards an undetected imposter', () => {
    const result = scoreDoubleAgentRound({
      playerIds: ids,
      imposterId: 'p2',
      votes: new Map<PlayerId, VoteTarget>([
        ['p1', { kind: 'no_imposter' }],
        ['p2', { kind: 'player', playerId: 'p1' }],
      ]),
    });
    const p2 = result.lines.find((l) => l.playerId === 'p2')!;
    expect(p2.points).toBe(DOUBLE_AGENT_POINTS.IMPOSTER_SURVIVED);
    expect(result.imposterCaught).toBe(false);
  });

  it('rewards correctly judging that there was no imposter at all', () => {
    const result = scoreDoubleAgentRound({
      playerIds: ids,
      imposterId: null,
      votes: new Map<PlayerId, VoteTarget>([
        ['p1', { kind: 'no_imposter' }],
        ['p2', { kind: 'player', playerId: 'p1' }],
      ]),
    });
    expect(result.lines.find((l) => l.playerId === 'p1')!.points).toBe(
      DOUBLE_AGENT_POINTS.CORRECT_READ,
    );
    expect(result.lines.find((l) => l.playerId === 'p2')!.points).toBe(0);
  });

  it('uses a different points table from standard mode, keeping ledgers separate', () => {
    expect(DOUBLE_AGENT_POINTS).not.toBe(POINTS);
    expect(DOUBLE_AGENT_POINTS.CORRECT_READ).not.toBe(POINTS.REGULAR_CORRECT_VOTE);
  });
});

describe('match end conditions', () => {
  it('ends after the fixed number of rounds', () => {
    const c = { mode: 'fixed_rounds' as const, fixedRounds: 5, targetScore: 0 };
    expect(isMatchComplete(c, { roundsPlayed: 4, highestScore: 99 })).toBe(false);
    expect(isMatchComplete(c, { roundsPlayed: 5, highestScore: 0 })).toBe(true);
  });

  it('ends when the target score is reached', () => {
    const c = { mode: 'target_score' as const, fixedRounds: 0, targetScore: 10 };
    expect(isMatchComplete(c, { roundsPlayed: 2, highestScore: 9 })).toBe(false);
    expect(isMatchComplete(c, { roundsPlayed: 2, highestScore: 10 })).toBe(true);
  });

  it('never ends on its own in host-manual mode', () => {
    const c = { mode: 'host_manual' as const, fixedRounds: 3, targetScore: 5 };
    expect(isMatchComplete(c, { roundsPlayed: 99, highestScore: 99 })).toBe(false);
  });
});

describe('standings', () => {
  it('ranks by score, highest first', () => {
    const standings = buildStandings(new Map([['a', 3], ['b', 7], ['c', 5]]));
    expect(standings.map((s) => s.playerId)).toEqual(['b', 'c', 'a']);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it('shares a rank on equal points and flags the tie', () => {
    const standings = buildStandings(new Map([['a', 5], ['b', 5], ['c', 2]]));
    expect(standings[0]!.rank).toBe(1);
    expect(standings[1]!.rank).toBe(1);
    expect(standings[0]!.isTiedForRank).toBe(true);
    expect(standings[1]!.isTiedForRank).toBe(true);
    // Next distinct score takes the rank its position implies.
    expect(standings[2]!.rank).toBe(3);
    expect(standings[2]!.isTiedForRank).toBe(false);
  });
});
