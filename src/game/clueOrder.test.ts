import { describe, it, expect } from 'vitest';
import {
  buildClueOrder,
  imposterFirstProbability,
  advanceClueTurn,
  activePlayerId,
  turnPosition,
  REGULAR_START_WEIGHT,
  IMPOSTER_START_WEIGHT,
  type ClueOrderCandidate,
} from './clueOrder';

function makeCandidates(regulars: number, imposters: number): ClueOrderCandidate[] {
  const list: ClueOrderCandidate[] = [];
  for (let i = 0; i < regulars; i += 1) list.push({ playerId: `r${i}`, role: 'regular' });
  for (let i = 0; i < imposters; i += 1) list.push({ playerId: `i${i}`, role: 'imposter' });
  return list;
}

describe('clue order integrity', () => {
  it('includes every player exactly once', () => {
    for (let trial = 0; trial < 500; trial += 1) {
      const candidates = makeCandidates(7, 2);
      const order = buildClueOrder(candidates, { allowImposterFirst: true });
      expect(order).toHaveLength(9);
      expect(new Set(order).size).toBe(9);
      for (const c of candidates) expect(order).toContain(c.playerId);
    }
  });

  it('handles a single player without crashing', () => {
    expect(buildClueOrder(makeCandidates(1, 0), { allowImposterFirst: true })).toEqual(['r0']);
  });

  it('returns an empty order for no players', () => {
    expect(buildClueOrder([], { allowImposterFirst: true })).toEqual([]);
  });
});

describe('imposter-first weighting', () => {
  it('uses the documented Version 1 weights', () => {
    expect(REGULAR_START_WEIGHT).toBe(1.0);
    expect(IMPOSTER_START_WEIGHT).toBe(0.35);
  });

  it('computes the documented 5-player probability', () => {
    // 0.35 / (4 * 1.0 + 0.35) = 0.0805...
    expect(imposterFirstProbability(4, 1, true)).toBeCloseTo(0.0805, 4);
  });

  it('gives the imposter a LOWER chance than a regular player, but never zero', () => {
    const regulars = 4;
    const imposters = 1;
    const pImposter = imposterFirstProbability(regulars, imposters, true);
    const pEachRegular = (1 - pImposter) / regulars;

    expect(pImposter).toBeGreaterThan(0);
    expect(pImposter).toBeLessThan(pEachRegular);
  });

  it('matches the measured frequency over many rounds', () => {
    const candidates = makeCandidates(4, 1);
    const trials = 40_000;
    let imposterFirst = 0;

    for (let i = 0; i < trials; i += 1) {
      const order = buildClueOrder(candidates, { allowImposterFirst: true });
      if (order[0]!.startsWith('i')) imposterFirst += 1;
    }

    const measured = imposterFirst / trials;
    const expected = imposterFirstProbability(4, 1, true);

    // Tolerance is generous enough to never flake, tight enough to catch a
    // genuinely wrong weighting (for example an accidental uniform draw at 20%).
    expect(measured).toBeGreaterThan(expected - 0.015);
    expect(measured).toBeLessThan(expected + 0.015);
  });

  it('scales correctly with two imposters in a 9-player room', () => {
    const candidates = makeCandidates(7, 2);
    const trials = 40_000;
    let imposterFirst = 0;

    for (let i = 0; i < trials; i += 1) {
      const order = buildClueOrder(candidates, { allowImposterFirst: true });
      if (order[0]!.startsWith('i')) imposterFirst += 1;
    }

    const measured = imposterFirst / trials;
    const expected = imposterFirstProbability(7, 2, true);
    expect(expected).toBeCloseTo(0.7 / 7.7, 4);
    expect(measured).toBeGreaterThan(expected - 0.015);
    expect(measured).toBeLessThan(expected + 0.015);
  });

  it('never lets an imposter open when the host disabled it', () => {
    const candidates = makeCandidates(4, 1);
    expect(imposterFirstProbability(4, 1, false)).toBe(0);

    for (let i = 0; i < 5000; i += 1) {
      const order = buildClueOrder(candidates, { allowImposterFirst: false });
      expect(order[0]!.startsWith('r')).toBe(true);
    }
  });

  it('still shuffles everyone else when imposter-first is disabled', () => {
    const candidates = makeCandidates(4, 1);
    const secondSpeakers = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const order = buildClueOrder(candidates, { allowImposterFirst: false });
      secondSpeakers.add(order[1]!);
    }
    // The imposter must be able to appear anywhere after the first slot.
    expect(secondSpeakers.has('i0')).toBe(true);
    expect(secondSpeakers.size).toBeGreaterThan(1);
  });
});

describe('order randomness beyond the first speaker', () => {
  it('does not always produce the same sequence', () => {
    const candidates = makeCandidates(5, 1);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(buildClueOrder(candidates, { allowImposterFirst: true }).join(','));
    }
    expect(seen.size).toBeGreaterThan(100);
  });
});

describe('advancing a turn', () => {
  const order = ['a', 'b', 'c'];

  it('advances exactly one place for the active player', () => {
    const result = advanceClueTurn({ order, currentIndex: 0 }, {
      requesterId: 'a',
      expectedIndex: 0,
      byHost: false,
    });
    expect(result).toEqual({ ok: true, nextIndex: 1, isComplete: false });
  });

  it('rejects a player who is not the active player', () => {
    const result = advanceClueTurn({ order, currentIndex: 0 }, {
      requesterId: 'c',
      expectedIndex: 0,
      byHost: false,
    });
    expect(result).toEqual({ ok: false, reason: 'not_active_player' });
  });

  it('rejects a double tap, so two turns are never skipped', () => {
    const state = { order, currentIndex: 0 };
    const first = advanceClueTurn(state, { requesterId: 'a', expectedIndex: 0, byHost: false });
    expect(first.ok).toBe(true);

    // The second tap carries the SAME stale index the screen still showed.
    const movedState = { order, currentIndex: 1 };
    const second = advanceClueTurn(movedState, {
      requesterId: 'a',
      expectedIndex: 0,
      byHost: false,
    });
    expect(second).toEqual({ ok: false, reason: 'stale_turn_index' });
  });

  it('lets the host advance a stuck or disconnected player', () => {
    const result = advanceClueTurn({ order, currentIndex: 1 }, {
      requesterId: 'host-who-is-not-b',
      expectedIndex: 1,
      byHost: true,
    });
    expect(result).toEqual({ ok: true, nextIndex: 2, isComplete: false });
  });

  it('still rejects a stale host tap', () => {
    const result = advanceClueTurn({ order, currentIndex: 2 }, {
      requesterId: 'host',
      expectedIndex: 1,
      byHost: true,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_turn_index' });
  });

  it('reports completion after the last clue', () => {
    const result = advanceClueTurn({ order, currentIndex: 2 }, {
      requesterId: 'c',
      expectedIndex: 2,
      byHost: false,
    });
    expect(result).toEqual({ ok: true, nextIndex: 3, isComplete: true });
  });

  it('rejects any further advance once complete', () => {
    const result = advanceClueTurn({ order, currentIndex: 3 }, {
      requesterId: 'c',
      expectedIndex: 3,
      byHost: true,
    });
    expect(result).toEqual({ ok: false, reason: 'order_already_complete' });
  });
});

describe('turn display helpers', () => {
  const order = ['a', 'b', 'c'];

  it('reports the active player', () => {
    expect(activePlayerId({ order, currentIndex: 1 })).toBe('b');
  });

  it('reports null once everyone has spoken', () => {
    expect(activePlayerId({ order, currentIndex: 3 })).toBeNull();
  });

  it('shows a 1-based position for players', () => {
    expect(turnPosition({ order, currentIndex: 0 })).toEqual({ position: 1, total: 3 });
    expect(turnPosition({ order, currentIndex: 2 })).toEqual({ position: 3, total: 3 });
  });
});
