import { describe, it, expect } from 'vitest';
import {
  allowedImposterCounts,
  recommendedImposterCount,
  checkImposterCount,
  resolveImposterCount,
  describeBalance,
  gameModeForPlayerCount,
  isSupportedPlayerCount,
} from './imposterCount';
import { rollDoubleAgentImposterCount } from './modes/doubleAgent';

describe('supported player counts', () => {
  it('accepts 2 through 10 and nothing else', () => {
    for (let n = 2; n <= 10; n += 1) expect(isSupportedPlayerCount(n)).toBe(true);
    for (const n of [0, 1, 11, 50, -3, 4.5, NaN]) {
      expect(isSupportedPlayerCount(n)).toBe(false);
    }
  });
});

describe('game mode selection', () => {
  it('maps player counts to the right mode', () => {
    expect(gameModeForPlayerCount(2)).toBe('double_agent');
    expect(gameModeForPlayerCount(3)).toBe('three_player');
    for (let n = 4; n <= 10; n += 1) {
      expect(gameModeForPlayerCount(n)).toBe('standard');
    }
  });
});

describe('allowed and recommended counts match the specification', () => {
  const table = [
    { players: 3, allowed: [1], recommended: 1 },
    { players: 4, allowed: [1], recommended: 1 },
    { players: 5, allowed: [1], recommended: 1 },
    { players: 6, allowed: [1, 2], recommended: 1 },
    { players: 7, allowed: [1, 2], recommended: 1 },
    { players: 8, allowed: [1, 2], recommended: 1 },
    { players: 9, allowed: [1, 2, 3], recommended: 2 },
    { players: 10, allowed: [1, 2, 3], recommended: 2 },
  ];

  for (const row of table) {
    it(`${row.players} players: allows ${row.allowed.join('/')}, recommends ${row.recommended}`, () => {
      expect(allowedImposterCounts(row.players)).toEqual(row.allowed);
      expect(recommendedImposterCount(row.players)).toBe(row.recommended);
    });
  }

  it('never recommends more imposters than regular players', () => {
    for (let n = 3; n <= 10; n += 1) {
      expect(recommendedImposterCount(n)).toBeLessThan(n - recommendedImposterCount(n) + 1);
    }
  });
});

describe('manual selection', () => {
  it('accepts an allowed count', () => {
    const result = checkImposterCount(8, 2);
    expect(result.ok).toBe(true);
  });

  it('rejects a count outside the allowed list', () => {
    const result = checkImposterCount(5, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_an_allowed_count');
  });

  it('tells the host to use Double Agent Mode for 2 players', () => {
    const result = checkImposterCount(2, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('double_agent_is_random');
  });

  it('warns but still allows an unbalanced valid choice', () => {
    const result = checkImposterCount(9, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.advice.severity).toBe('warning');
      expect(result.advice.message).toMatch(/recommended/i);
    }
  });

  it('is silent when the host picks the recommendation', () => {
    const result = checkImposterCount(7, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.advice.severity).toBe('none');
  });
});

describe('three-player advice', () => {
  it('recommends Category Hint and warns it is easier', () => {
    const advice = describeBalance(3, 1);
    expect(advice.severity).toBe('notice');
    expect(advice.message).toMatch(/category hint/i);
    expect(advice.message).toMatch(/easier/i);
  });
});

describe('resolveImposterCount', () => {
  it('uses the recommendation on automatic', () => {
    expect(resolveImposterCount(10, 'automatic', 99)).toBe(2);
  });

  it('honours a valid manual count', () => {
    expect(resolveImposterCount(10, 'manual', 3)).toBe(3);
  });

  it('falls back to the recommendation when players left and the manual count became invalid', () => {
    // Host picked 3 with 9 players, then 4 players left.
    expect(resolveImposterCount(5, 'manual', 3)).toBe(1);
  });

  it('refuses to handle the 2-player case', () => {
    expect(() => resolveImposterCount(2, 'automatic', 1)).toThrow(/Double Agent/i);
  });
});

describe('Double Agent imposter roll', () => {
  it('only ever returns 0 or 1', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect([0, 1]).toContain(rollDoubleAgentImposterCount());
    }
  });

  it('is close to an even split over many rounds', () => {
    let withImposter = 0;
    const trials = 20_000;
    for (let i = 0; i < trials; i += 1) {
      withImposter += rollDoubleAgentImposterCount();
    }
    const share = withImposter / trials;
    expect(share).toBeGreaterThan(0.47);
    expect(share).toBeLessThan(0.53);
  });
});
